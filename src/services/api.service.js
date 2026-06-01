import { API_CONFIG } from '../config/api.config.js';

class ApiService {
  /**
   * 通用请求方法
   */
  async request(url, options = {}) {
    // Debug: 打印请求地址，确保它指向正确的地方
    console.log(`[ApiService] Requesting: ${url}`);
    
    const headers = { ...options.headers };
    
    // 如果 body 不是 FormData，默认使用 application/json
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(url, {
        mode: 'cors', // 确保启用 CORS
        headers: headers,
        ...options
      });
      
      // 尝试解析 JSON 响应，即使 HTTP 状态码表示错误
      let data;
      try {
          data = await response.json();
      } catch (e) {
          data = null; 
      }
      
      if (!response.ok) {
        // 优先使用后端返回的错误信息
        const errorMessage = data && data.message ? data.message : `HTTP error! status: ${response.status}`;
        const error = new Error(errorMessage);
        error.status = response.status;
        error.data = data;
        throw error;
      }
      
      return data;
    } catch (error) {
      // console.error('API request failed:', error); // Optional: avoid cluttering console for expected errors
      throw error;
    }
  }
  
  // ==================== 状态查询 ====================
  
  async getFullStatus() {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.status}`);
  }

  // ==================== 环境检测与对话 ====================

  /**
   * 发送环境检测指令
   */
  async scanEnvironment() {
      // 环境检测现在统一使用 chat 接口，发送固定指令
      return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.chat}`, {
        method: 'POST',
        body: JSON.stringify({ message: "请描述当前环境中有哪些物体？例如：地面上有一个玩偶，一把椅子，正前方是一个桌子等。" })
    });
  }

  /**
   * 发送聊天消息
   */
  async sendChatMessage(message) {
      return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.chat}`, {
          method: 'POST',
          body: JSON.stringify({ message })
      });
  }

  async getBatteryStatus() {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.battery}`);
  }
  
  async getVelocity() {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.velocity}`);
  }
  
  async getCpuUsage() {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.cpu}`);
  }
  
  async getNetworkLatency() {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.latency}`);
  }
  
  async getDistance() {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.distance}`);
  }
  
  // ==================== 任务操作 ====================
  
  async createTask(taskData) {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.addTask}`, {
      method: 'POST',
      body: JSON.stringify(taskData)
    });
  }

  async rateTask(data) {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_taskRate}`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
  
  async getAllTasks() {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_getAllTasks}`);
  }

  async getMyTasks(username) {
    const query = encodeURIComponent(username || '');
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_getAllTasks}?creator=${query}`);
  }

  async getPendingTasks() {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_getPendingTasks}`);
  }

  async getCurrentTasks() {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_getCurrentTasks}`);
  }

  async getHistoryTasks() {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_getHistoryTasks}`);
  }

  async getTaskDetail(taskId) {
    const tasks = await this.getAllTasks();
    const taskList = Array.isArray(tasks) ? tasks : (tasks && tasks.data ? tasks.data : []);
    return taskList.find(task => String(task.id) === String(taskId)) || null;
  }

  async getPendingConfirmTasks() {
    return this.request(`${API_CONFIG.confirmServerUrl}${API_CONFIG.endpoints.robotConfirmPending}?t=${Date.now()}`, {
      cache: 'no-store'
    });
  }

  getTaskConfirmStreamUrl() {
    return `${API_CONFIG.confirmServerUrl}${API_CONFIG.endpoints.robotConfirmStream}?t=${Date.now()}`;
  }

  async submitTaskConfirmation(taskId, action) {
    return this.request(`${API_CONFIG.confirmServerUrl}${API_CONFIG.endpoints.robotConfirm}`, {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId, action })
    });
  }

  // ==================== 认证 ====================

  async login(username, password, role) {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_login}`, {
        method: 'POST',
        body: JSON.stringify({ username, password, role })
    });
  }

  async register(username, password, role, identity) {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_register}`, {
        method: 'POST',
        body: JSON.stringify({ username, password, role, identity })
    });
  }

  async sendPresenceHeartbeat(sessionData) {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_heartbeat}`, {
        method: 'POST',
        body: JSON.stringify(sessionData)
    });
  }

  async logoutSession(sessionId, username) {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_logout}`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, username })
    });
  }

  async getOnlineUsers() {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_onlineUsers}?t=${Date.now()}`, {
      cache: 'no-store'
    });
  }

  async getTaskFormLockConfig() {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_taskFormLock}?t=${Date.now()}`, {
      cache: 'no-store'
    });
  }

  async updateTaskFormLockConfig(enabled, updatedBy = '') {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_taskFormLock}`, {
      method: 'POST',
      body: JSON.stringify({ enabled, updated_by: updatedBy })
    });
  }

  async registerFace(username, imageBlob) {
    const formData = new FormData();
    formData.append('username', username);
    formData.append('file', imageBlob, 'face.jpg');

    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.faceRegister}`, {
        method: 'POST',
        body: formData
    });
  }

  async recognizeFace() {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.faceRecognize}`, {
        method: 'POST'
    });
  }
  
  async getTaskStatus(taskId) {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.taskStatus}${taskId}`);
  }
  
  async controlTask(taskId, action) {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.taskControl}${taskId}`, {
      method: 'POST',
      body: JSON.stringify({ action })
    });
  }

  async updateRobotTaskStatus(taskId, status) {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.updateTaskStatus}`, {
      method: 'POST',
      body: JSON.stringify({ id: taskId, status })
    });
  }
  
  async deleteTaskInRobot(taskId) {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.taskDelete}${taskId}`, {
      method: 'DELETE'
    });
  }

  async deleteTaskInDb(taskId) {
  return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_taskDelete}${taskId}`, {
    method: 'DELETE'
  });
  }
  
  async persistTask(taskData) {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_persistTask}`, {
      method: 'POST',
      body: JSON.stringify(taskData)
    });
  }

  async updateTaskStatus(taskId, status) {
    return this.request(`${API_CONFIG.dbUrl}${API_CONFIG.endpoints.db_updateTaskStatus}`, {
      method: 'POST',
      body: JSON.stringify({ id: taskId, status })
    });
  }
  
  // ==================== 机器人控制 ====================
  
  async executeGrasp(x, y, is_grasp = true, horizontal = true) {
    return this.request(`${API_CONFIG.robotUrl}${API_CONFIG.endpoints.grasp}`, {
      method: 'POST',
      body: JSON.stringify({ x, y, is_grasp, horizontal })
    });
  }
}

export default new ApiService();
