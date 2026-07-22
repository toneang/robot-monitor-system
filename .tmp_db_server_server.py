# server.py (SQLite 版)
from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import os
from datetime import datetime, timedelta
import uuid

app = Flask(__name__)
# 允许跨域请求，方便前端调试
CORS(app)

# === 数据库配置 ===
# 指向和脚本同目录下的 robot.db 文件
DB_PATH = os.path.join(os.path.dirname(__file__), 'robot.db')

def get_db_connection():
    # check_same_thread=False 是 Flask 等多线程 Web 框架必须的设置
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    # 让查询结果像字典一样可以按键名访问 (类似 MySQL 的 DictCursor)
    conn.row_factory = sqlite3.Row
    # 开启 WAL 模式，极大提升 SQLite 的并发读写性能
    conn.execute('PRAGMA journal_mode=WAL;')
    return conn

# === 工具函数：生成 UUID ===
def generate_task_id():
    return str(uuid.uuid4())

ONLINE_TIMEOUT_SECONDS = 45

def get_current_time_str():
    return datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

def get_online_threshold_str():
    return (datetime.utcnow() - timedelta(seconds=ONLINE_TIMEOUT_SECONDS)).strftime('%Y-%m-%d %H:%M:%S')

def normalize_use_memory_flag(value):
    normalized = str(value).strip().lower()
    return normalized in ('1', 'true', 'yes', 'on')

def resolve_task_model(task_type, use_memory):
    if normalize_use_memory_flag(use_memory):
        return 'memory'

    normalized_type = str(task_type or '').strip().lower()
    if normalized_type == 'rule':
        return 'rule'

    return 'vlm'

def resolve_task_model_selection(model_selection, task_type, use_memory):
    normalized_selection = str(model_selection or '').strip().lower()

    if normalized_selection == 'rule':
        return 'rule'
    if normalized_selection == 'vlm':
        return 'vlm'
    if normalized_selection in ('vlm+mem', 'vlm-mem'):
        return 'vlm+mem'

    if normalize_use_memory_flag(use_memory):
        return 'vlm+mem'

    normalized_type = str(task_type or '').strip().lower()
    if normalized_type == 'rule':
        return 'rule'

    return 'vlm'

def ensure_presence_schema(connection):
    cursor = connection.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    has_users_table = cursor.fetchone() is not None

    if has_users_table:
        cursor.execute("PRAGMA table_info(users)")
        user_columns = [column[1] for column in cursor.fetchall()]

        if 'identity' not in user_columns:
            cursor.execute("ALTER TABLE users ADD COLUMN identity TEXT DEFAULT 'student'")

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS user_sessions (
            session_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            identity TEXT DEFAULT 'student',
            login_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            logged_out_at TEXT,
            is_online INTEGER DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_user_sessions_username
        ON user_sessions(username);

        CREATE INDEX IF NOT EXISTS idx_user_sessions_online
        ON user_sessions(is_online, last_seen_at);
    """)
    connection.commit()

def ensure_task_schema(connection):
    cursor = connection.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
    has_tasks_table = cursor.fetchone() is not None

    if not has_tasks_table:
        return

    cursor.execute("PRAGMA table_info(tasks)")
    task_columns = [column[1] for column in cursor.fetchall()]

    if 'model' not in task_columns:
        cursor.execute("ALTER TABLE tasks ADD COLUMN model TEXT DEFAULT 'vlm'")
    if 'model_selection' not in task_columns:
        cursor.execute("ALTER TABLE tasks ADD COLUMN model_selection TEXT DEFAULT 'vlm'")

    cursor.execute(
        """
        UPDATE tasks
        SET model = CASE
            WHEN COALESCE(CAST(use_memory AS INTEGER), 0) = 1 THEN 'memory'
            WHEN LOWER(TRIM(COALESCE(type, ''))) = 'rule' THEN 'rule'
            ELSE 'vlm'
        END
        """
    )
    cursor.execute(
        """
        UPDATE tasks
        SET model_selection = CASE
            WHEN COALESCE(CAST(use_memory AS INTEGER), 0) = 1 THEN 'vlm+mem'
            WHEN LOWER(TRIM(COALESCE(type, ''))) = 'rule' THEN 'rule'
            ELSE 'vlm'
        END
        """
    )
    connection.commit()

def ensure_system_settings_schema(connection):
    cursor = connection.cursor()
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS system_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            updated_by TEXT DEFAULT ''
        );
    """)
    cursor.execute(
        """
        INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(setting_key) DO NOTHING
        """,
        ('task_form_lock', '1', get_current_time_str(), 'system')
    )
    connection.commit()

def normalize_boolean_flag(value, default=True):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')

def serialize_task_form_lock(row):
    if not row:
        return {
            "enabled": True,
            "updated_at": "",
            "updated_by": ""
        }

    row_dict = dict(row)
    return {
        "enabled": normalize_boolean_flag(row_dict.get('setting_value'), True),
        "updated_at": row_dict.get('updated_at') or '',
        "updated_by": row_dict.get('updated_by') or ''
    }

def mark_stale_sessions_offline(connection):
    threshold = get_online_threshold_str()
    cursor = connection.cursor()
    cursor.execute(
        """
        UPDATE user_sessions
        SET is_online = 0,
            logged_out_at = COALESCE(logged_out_at, ?)
        WHERE is_online = 1
          AND last_seen_at < ?
        """,
        (get_current_time_str(), threshold)
    )
    connection.commit()

def get_user_record(connection, username):
    cursor = connection.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    row = cursor.fetchone()
    return dict(row) if row else None

def resolve_presence_identity(user_data):
    identity = (user_data or {}).get('identity')
    if identity:
        return identity
    role = (user_data or {}).get('role')
    if role == 'admin':
        return 'administrative_staff'
    return 'student'

def create_presence_session(connection, user_data, session_id=None):
    resolved_session_id = session_id or str(uuid.uuid4())
    now_str = get_current_time_str()
    cursor = connection.cursor()
    cursor.execute(
        """
        INSERT INTO user_sessions (
            session_id, username, role, identity, login_at, last_seen_at, logged_out_at, is_online
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1)
        """,
        (
            resolved_session_id,
            user_data.get('username', 'Unknown'),
            user_data.get('role', 'user'),
            resolve_presence_identity(user_data),
            now_str,
            now_str
        )
    )
    connection.commit()
    return resolved_session_id

def refresh_presence_session(connection, user_data, session_id):
    cursor = connection.cursor()
    now_str = get_current_time_str()
    cursor.execute("SELECT session_id FROM user_sessions WHERE session_id = ?", (session_id,))
    existing = cursor.fetchone()

    if existing:
        cursor.execute(
            """
            UPDATE user_sessions
            SET username = ?,
                role = ?,
                identity = ?,
                last_seen_at = ?,
                logged_out_at = NULL,
                is_online = 1
            WHERE session_id = ?
            """,
            (
                user_data.get('username', 'Unknown'),
                user_data.get('role', 'user'),
                resolve_presence_identity(user_data),
                now_str,
                session_id
            )
        )
        connection.commit()
        return session_id

    return create_presence_session(connection, user_data, session_id=session_id)

def serialize_task_rows(rows):
    tasks = []
    for row in rows:
        row_dict = dict(row)
        task_obj = {k: v for k, v in row_dict.items() if not k.startswith('r_')}

        has_rating = any(row_dict.get(f'r_{field}') is not None for field in [
            'personalization_level', 'score_functional_correctness',
            'score_personalized_correctness', 'score_intent_understanding',
            'score_auto_completion', 'score_robot_improvement'
        ])

        if has_rating:
            task_obj['rating'] = {
                'personalization_level': row_dict.get('r_personalization_level'),
                'score_functional_correctness': row_dict.get('r_score_functional_correctness'),
                'score_personalized_correctness': row_dict.get('r_score_personalized_correctness'),
                'score_intent_understanding': row_dict.get('r_score_intent_understanding'),
                'score_auto_completion': row_dict.get('r_score_auto_completion'),
                'score_robot_improvement': row_dict.get('r_score_robot_improvement'),
                'comment': row_dict.get('r_comment'),
                'expectation': row_dict.get('r_expectation'),
                'submittedBy': row_dict.get('r_submitted_by'),
                'submittedAt': row_dict.get('r_submitted_at')
            }
        else:
            task_obj['rating'] = None

        tasks.append(task_obj)

    return tasks

# === API: Register User (POST /api/auth/register) ===
@app.route('/api/auth/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        role = data.get('role', 'user')
        identity = data.get('identity', 'student')

        if not username or not password:
            return jsonify({"code": 400, "message": "Username and password are required"}), 400

        connection = get_db_connection()
        cursor = connection.cursor()

        # Check if username exists (使用 SQLite 的 ? 占位符)
        cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
        if cursor.fetchone():
            connection.close()
            return jsonify({"code": 409, "message": "Username already exists"}), 409

        sql = "INSERT INTO users (username, password, role, identity, created_at) VALUES (?, ?, ?, ?, ?)"
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        cursor.execute(sql, (username, password, role, identity, now_str))
        connection.commit()
            
        connection.close()
        return jsonify({"code": 200, "message": "User registered successfully"}), 201

    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500

# === API: Login User (POST /api/auth/login) ===
@app.route('/api/auth/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')

        if not username or not password:
            return jsonify({"code": 400, "message": "Username and password are required"}), 400

        connection = get_db_connection()
        ensure_presence_schema(connection)
        mark_stale_sessions_offline(connection)
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
        user_row = cursor.fetchone()

        if user_row:
            user = dict(user_row) # 将 sqlite3.Row 转换为普通字典
            if user['password'] == password: 
                user.pop('password', None)
                session_id = create_presence_session(connection, user)
                user['session_id'] = session_id
                connection.close()
                print("====== User logged in:", user)  
                return jsonify({"code": 200, "message": "Login successful", "data": user, "session_id": session_id}), 200

        connection.close()
            
        return jsonify({"code": 401, "message": "Invalid credentials"}), 401

    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500

# === API: Refresh Online Session (POST /api/auth/heartbeat) ===
@app.route('/api/auth/heartbeat', methods=['POST'])
def heartbeat():
    try:
        data = request.get_json(silent=True) or {}
        session_id = data.get('session_id')
        username = data.get('username')

        if not username:
            return jsonify({"code": 400, "message": "username is required"}), 400

        connection = get_db_connection()
        ensure_presence_schema(connection)
        mark_stale_sessions_offline(connection)

        user_record = get_user_record(connection, username)
        resolved_user = user_record or {
            'username': username,
            'role': data.get('role', 'user'),
            'identity': data.get('identity', 'student')
        }

        resolved_session_id = refresh_presence_session(connection, resolved_user, session_id or str(uuid.uuid4()))
        connection.close()

        return jsonify({
            "code": 200,
            "message": "Heartbeat received",
            "session_id": resolved_session_id
        }), 200
    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500

# === API: Logout Session (POST /api/auth/logout) ===
@app.route('/api/auth/logout', methods=['POST'])
def logout():
    try:
        data = request.get_json(silent=True) or {}
        session_id = data.get('session_id')
        username = data.get('username')

        if not session_id and not username:
            return jsonify({"code": 400, "message": "session_id or username is required"}), 400

        connection = get_db_connection()
        ensure_presence_schema(connection)
        cursor = connection.cursor()
        now_str = get_current_time_str()

        if session_id:
            cursor.execute(
                """
                UPDATE user_sessions
                SET is_online = 0,
                    logged_out_at = ?
                WHERE session_id = ?
                """,
                (now_str, session_id)
            )
        else:
            cursor.execute(
                """
                UPDATE user_sessions
                SET is_online = 0,
                    logged_out_at = ?
                WHERE username = ?
                  AND is_online = 1
                """,
                (now_str, username)
            )

        connection.commit()
        connection.close()

        return jsonify({"code": 200, "message": "Logout successful"}), 200
    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500

# === API: Get Online Users (GET /api/auth/online-users) ===
@app.route('/api/auth/online-users', methods=['GET'])
def get_online_users():
    try:
        connection = get_db_connection()
        ensure_presence_schema(connection)
        mark_stale_sessions_offline(connection)
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT
                username,
                MAX(role) AS role,
                MAX(identity) AS identity,
                MAX(last_seen_at) AS last_seen_at,
                COUNT(*) AS session_count
            FROM user_sessions
            WHERE is_online = 1
              AND last_seen_at >= ?
            GROUP BY username
            ORDER BY MAX(last_seen_at) DESC, username ASC
            """,
            (get_online_threshold_str(),)
        )
        rows = cursor.fetchall()
        connection.close()

        users = []
        for row in rows:
            row_dict = dict(row)
            users.append({
                "username": row_dict.get('username'),
                "role": row_dict.get('role', 'user'),
                "identity": row_dict.get('identity') or 'student',
                "last_seen_at": row_dict.get('last_seen_at'),
                "session_count": row_dict.get('session_count', 1)
            })

        return jsonify({
            "code": 200,
            "count": len(users),
            "data": users,
            "timeout_seconds": ONLINE_TIMEOUT_SECONDS
        }), 200
    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500

# === API: Get/Update Task Form Lock (GET/POST /api/system/task-form-lock) ===
@app.route('/api/system/task-form-lock', methods=['GET', 'POST'])
def task_form_lock():
    try:
        connection = get_db_connection()
        ensure_system_settings_schema(connection)
        cursor = connection.cursor()

        if request.method == 'POST':
            data = request.get_json(silent=True) or {}
            if 'enabled' not in data:
                connection.close()
                return jsonify({"code": 400, "message": "enabled is required"}), 400

            enabled = '1' if normalize_boolean_flag(data.get('enabled'), True) else '0'
            updated_by = (data.get('updated_by') or data.get('updatedBy') or '').strip()
            updated_at = get_current_time_str()

            cursor.execute(
                """
                INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_at = excluded.updated_at,
                    updated_by = excluded.updated_by
                """,
                ('task_form_lock', enabled, updated_at, updated_by)
            )
            connection.commit()

        cursor.execute(
            "SELECT setting_value, updated_at, updated_by FROM system_settings WHERE setting_key = ?",
            ('task_form_lock',)
        )
        row = cursor.fetchone()
        state = serialize_task_form_lock(row)
        connection.close()

        return jsonify({"code": 200, "data": state}), 200
    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500

# === API: Create New Task (POST /api/task/persist) ===
@app.route('/api/task/persist', methods=['POST'])
def create_task():
    try:
        data = request.get_json()
        print("====== Received persist data:", data)  

        task_id = data.get('id') or generate_task_id()
        task_type = data.get('type', 'custom')
        description = data.get('description')
        location = data.get('location')
        priority = data.get('priority', 'low')
        status = data.get('status', 'pending')
        create_time = data.get('create_time')
        execution_time = data.get('execute_time') or create_time
        updated_time = data.get('updated_time') or create_time
        creator = data.get('creator', 'User')
        use_memory = data.get('use_memory', 0)
        task_model = resolve_task_model(task_type, use_memory)
        task_model_selection = resolve_task_model_selection(data.get('model_selection'), task_type, use_memory)

        if not task_id:
            return jsonify({"error": "id is required"}), 400

        connection = get_db_connection()
        ensure_task_schema(connection)
        cursor = connection.cursor()

        # 使用 SQLite 专属的 UPSERT 语法 (ON CONFLICT) 替代 MySQL 的 ON DUPLICATE KEY
        sql = """
        INSERT INTO tasks (
            id, type, description, location, priority, status,
            execute_time, create_time, updated_time, creator, use_memory, model, model_selection
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            type = excluded.type,
            status = excluded.status,
            updated_time = excluded.updated_time,
            description = excluded.description,
            location = excluded.location,
            priority = excluded.priority,
            use_memory = excluded.use_memory,
            model = excluded.model,
            model_selection = excluded.model_selection
        """
        cursor.execute(sql, (
            task_id, task_type, description, location, priority, status,
            execution_time, create_time, updated_time, creator, use_memory, task_model, task_model_selection
        ))
        connection.commit()
        connection.close()

        return jsonify({"code": 200, "message": "Task persisted", "id": task_id}), 201

    except Exception as e:
        print("Error persisting task:", e)
        return jsonify({"code": 500, "message": str(e)}), 500

# === API: 获取所有任务 (GET /api/task/list) ===
@app.route('/api/task/list', methods=['GET'])
def get_all_tasks():
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        creator = (request.args.get('creator') or request.args.get('username') or '').strip()
        sql = """
            SELECT t.*,
                   r.personalization_level as r_personalization_level,
                   r.score_functional_correctness as r_score_functional_correctness,
                   r.score_personalized_correctness as r_score_personalized_correctness,
                   r.score_intent_understanding as r_score_intent_understanding,
                   r.score_auto_completion as r_score_auto_completion,
                   r.score_robot_improvement as r_score_robot_improvement,
                   r.comment as r_comment,
                   r.expectation as r_expectation,
                   r.submitted_by as r_submitted_by,
                   r.submitted_at as r_submitted_at
            FROM tasks t
            LEFT JOIN task_ratings r ON t.id = r.task_id
        """
        params = []
        if creator:
            sql += """
            WHERE LOWER(TRIM(t.creator)) = LOWER(TRIM(?))
            """
            params.append(creator)

        sql += """
            ORDER BY t.create_time DESC
        """
        cursor.execute(sql, params)
        rows = cursor.fetchall()
        tasks = serialize_task_rows(rows)

        connection.close()
        return jsonify({"code": 200, "data": tasks}), 200
    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500

# === API: Get Pending Tasks (GET /api/task/pending) ===
@app.route('/api/task/pending', methods=['GET'])
def get_pending_tasks():
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM tasks WHERE status = 'pending' ORDER BY create_time DESC")
        tasks = [dict(row) for row in cursor.fetchall()]
        connection.close()
        return jsonify({"code": 200, "data": tasks}), 200
    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500

# === API: Get Current Executing Tasks (GET /api/task/current) ===
@app.route('/api/task/current', methods=['GET'])
def get_current_tasks():
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM tasks WHERE status IN ('executing', 'processing', 'paused') ORDER BY updated_time DESC")
        tasks = [dict(row) for row in cursor.fetchall()]
        connection.close()
        return jsonify({"code": 200, "data": tasks}), 200
    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500

# === API: Get History Tasks (GET /api/task/history) ===
@app.route('/api/task/history', methods=['GET'])
def get_history_tasks():
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        sql = """
            SELECT t.*,
                   r.personalization_level as r_personalization_level,
                   r.score_functional_correctness as r_score_functional_correctness,
                   r.score_personalized_correctness as r_score_personalized_correctness,
                   r.score_intent_understanding as r_score_intent_understanding,
                   r.score_auto_completion as r_score_auto_completion,
                   r.score_robot_improvement as r_score_robot_improvement,
                   r.comment as r_comment,
                   r.expectation as r_expectation,
                   r.submitted_by as r_submitted_by,
                   r.submitted_at as r_submitted_at
            FROM tasks t
            LEFT JOIN task_ratings r ON t.id = r.task_id
            WHERE t.status IN ('completed', 'finished', 'failed', 'finish')
            ORDER BY t.updated_time DESC
        """
        cursor.execute(sql)
        rows = cursor.fetchall()
        tasks = serialize_task_rows(rows)

        connection.close()
        return jsonify({"code": 200, "data": tasks}), 200
    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500
    
# === API: Update Task Status (POST /api/task/update_status) ===
@app.route('/api/task/update_status', methods=['POST'])
def update_task_status():
    try:
        data = request.get_json()
        task_id = data.get('id')
        new_status = data.get('status')
        
        if not task_id or not new_status:
             return jsonify({"code": 400, "message": "Task ID and status are required"}), 400

        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        connection = get_db_connection()
        cursor = connection.cursor()
        
        cursor.execute("SELECT status FROM tasks WHERE id = ?", (task_id,))
        result = cursor.fetchone()
        if not result:
            connection.close()
            return jsonify({"code": 404, "message": "Task not found"}), 404

        if new_status == 'executing':
            sql = "UPDATE tasks SET status = ?, updated_time = ?, execute_time = ? WHERE id = ?"
            cursor.execute(sql, (new_status, now_str, now_str, task_id))
        
        elif new_status in ['finished', 'completed', 'failed']:
            sql = "UPDATE tasks SET status = ?, updated_time = ?, finished_time = ? WHERE id = ?"
            cursor.execute(sql, (new_status, now_str, now_str, task_id))
        
        else:
            sql = "UPDATE tasks SET status = ?, updated_time = ? WHERE id = ?"
            cursor.execute(sql, (new_status, now_str, task_id))

        connection.commit()
        connection.close()
        return jsonify({"code": 200, "message": f"Task status updated to {new_status}"}), 200

    except Exception as e:
        print("Error updating task status:", e)
        return jsonify({"code": 500, "message": str(e)}), 500

# === API: Delete Task (DELETE /api/task/delete/<task_id>) ===
@app.route('/api/task/delete/<task_id>', methods=['DELETE'])
def delete_task(task_id):
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        
        cursor.execute("SELECT id FROM tasks WHERE id = ?", (task_id,))
        if not cursor.fetchone():
            connection.close()
            return jsonify({"code": 404, "message": "Task not found"}), 404

        # SQLite 虽然支持外键级联，但手动先删除子表数据更稳妥
        cursor.execute("DELETE FROM task_ratings WHERE task_id = ?", (task_id,))
        cursor.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        
        connection.commit()
        connection.close()

        return jsonify({"code": 200, "message": "Task deleted"}), 200

    except Exception as e:
        return jsonify({"code": 500, "message": str(e)}), 500

# === API: Rate Task (POST /api/task/rate) ===
@app.route('/api/task/rate', methods=['POST'])
def rate_task():
    try:
        data = request.get_json()
        print("====== Received rating data:", data)

        task_id = data.get('taskId')

        # 提取各个评分字段
        personalization_level = data.get('personalization_level')
        score_functional_correctness = data.get('score_functional_correctness')
        score_personalized_correctness = data.get('score_personalized_correctness')
        score_intent_understanding = data.get('score_intent_understanding')
        score_auto_completion = data.get('score_auto_completion')
        score_robot_improvement = data.get('score_robot_improvement')
        comment = data.get('comment')
        expectation = data.get('expectation')
        submitted_by = data.get('submitted_by') or data.get('submittedBy')
        submitted_at = data.get('submitted_at') or data.get('submittedAt')

        # 至少需要一个评分字段
        if not task_id or not any([personalization_level, score_functional_correctness,
                                   score_personalized_correctness, score_intent_understanding,
                                   score_auto_completion, score_robot_improvement]):
            return jsonify({"code": 400, "message": "Task ID and at least one rating field are required"}), 400

        formatted_date = None
        if submitted_at:
             formatted_date = submitted_at.replace('T', ' ').replace('Z', '').split('.')[0]

        connection = get_db_connection()
        cursor = connection.cursor()

        # 检查是否已有评分记录
        cursor.execute("SELECT id FROM task_ratings WHERE task_id = ?", (task_id,))
        existing = cursor.fetchone()

        if existing:
            # 更新已有记录
            update_sql = """
                UPDATE task_ratings
                SET personalization_level = ?,
                    score_functional_correctness = ?,
                    score_personalized_correctness = ?,
                    score_intent_understanding = ?,
                    score_auto_completion = ?,
                    score_robot_improvement = ?,
                    comment = ?,
                    expectation = ?,
                    submitted_by = ?,
                    submitted_at = ?
                WHERE task_id = ?
            """
            cursor.execute(update_sql, (
                personalization_level, score_functional_correctness,
                score_personalized_correctness, score_intent_understanding,
                score_auto_completion, score_robot_improvement,
                comment, expectation, submitted_by, formatted_date, task_id
            ))
        else:
            # 插入新记录
            insert_sql = """
                INSERT INTO task_ratings (
                    task_id, personalization_level, score_functional_correctness,
                    score_personalized_correctness, score_intent_understanding,
                    score_auto_completion, score_robot_improvement,
                    comment, expectation, submitted_by, submitted_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            cursor.execute(insert_sql, (
                task_id, personalization_level, score_functional_correctness,
                score_personalized_correctness, score_intent_understanding,
                score_auto_completion, score_robot_improvement,
                comment, expectation, submitted_by, formatted_date
            ))

        connection.commit()
        connection.close()

        return jsonify({"code": 200, "message": "Rating submitted successfully"}), 200

    except Exception as e:
        print("Error submitting rating:", e)
        return jsonify({"code": 500, "message": str(e)}), 500

# === 安全检查建表逻辑 (防止误删或移动导致的数据库缺失) ===
def init_db_if_missing():
    conn = get_db_connection()
    ensure_presence_schema(conn)
    ensure_system_settings_schema(conn)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            identity TEXT DEFAULT 'student',
            created_at TEXT
        );
        
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            type TEXT,
            description TEXT,
            location TEXT DEFAULT 'unspecified',
            priority TEXT DEFAULT 'low',
            execute_time TEXT,
            status TEXT DEFAULT 'pending',
            create_time TEXT,
            creator TEXT DEFAULT 'Unknown',
            updated_time TEXT,
            finished_time TEXT,
            use_memory INTEGER DEFAULT 0,
            model TEXT DEFAULT 'vlm',
            model_selection TEXT DEFAULT 'vlm'
        );
        
        CREATE TABLE IF NOT EXISTS task_ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            personalization_level INTEGER CHECK(personalization_level BETWEEN 1 AND 5),
            score_functional_correctness INTEGER CHECK(score_functional_correctness BETWEEN 1 AND 5),
            score_personalized_correctness INTEGER CHECK(score_personalized_correctness BETWEEN 1 AND 5),
            score_intent_understanding INTEGER CHECK(score_intent_understanding BETWEEN 1 AND 5),
            score_auto_completion INTEGER CHECK(score_auto_completion BETWEEN 1 AND 5),
            score_robot_improvement INTEGER CHECK(score_robot_improvement BETWEEN 1 AND 5),
            comment TEXT,
            expectation TEXT,
            submitted_by TEXT,
            submitted_at TEXT,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_creator_create_time
        ON tasks(creator, create_time);
    """)
    ensure_task_schema(conn)
    conn.commit()
    conn.close()

# === 启动服务器 ===
if __name__ == '__main__':
    # 启动时做个基础检查，如果 robot.db 存在就不会覆盖里面的数据
    init_db_if_missing() 
    app.run(host='0.0.0.0', port=8888, debug=True)
