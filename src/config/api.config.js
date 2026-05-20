import { SHARED_CONFIG } from "../../public/static/shared-config.js";

// API 配置文件
export const API_CONFIG = {
  // 后端服务基础地址
  robotUrl: SHARED_CONFIG.robotUrl,
  dbUrl: 'https://10.208.40.25:18080',
  confirmServerUrl: '/confirm',
  memoryGraphUrl: 'https://10.208.40.25:18080', // Assumed port for the new FastAPI service

  // Polling Configuration
  polling: {
    statusInterval: 5000, // System status polling interval (ms)
    interval: 3000        // Task status polling interval (ms)
  },

  // API 接口端点
  endpoints: {
    // 机器人状态
    status: '/api/status',
    battery: '/api/status/battery',
    position: '/api/status/position',
    velocity: '/api/status/velocity',
    latency: '/api/status/latency',
    cpu: '/api/status/cpu',
    distance: '/api/status/distance',
    //机器人相机
    camera: '/api/video/navigation',
    realsenseCamera: '/api/video/realsense',
    gripperCamera: '/api/video/gripper',
    // 点击抓取任务
    grasp: '/api/robot/grasp',

    // 任务相关
    addTask: '/api/task/add',
    taskStatus: '/api/task/status/', // Added status endpoint
    taskControl: '/api/task/control/',
    taskDelete: '/api/task/delete/',
    taskRate: '/api/task/rate',
    // 数据库相关
    persistTask: '/api/task/persist',// add
    updateTaskStatus: '/api/task/update_status', // 仅更新状态
    getAllTasks: '/api/task/list',
    getPendingTasks: '/api/task/pending',
    getCurrentTasks: '/api/task/current',
    getHistoryTasks: '/api/task/history',
    // 认证相关
    login: '/api/auth/login',
    register: '/api/auth/register',
    // === 任务相关 (数据库版本) ===
    db_addTask: '/db/task/add',
    db_taskStatus: '/db/task/status/',
    db_taskControl: '/db/task/control/',
    db_taskDelete: '/db/task/delete/',
    db_taskRate: '/db/task/rate',

    // === 数据库持久化与查询 ===
    db_persistTask: '/db/task/persist',
    db_updateTaskStatus: '/db/task/update_status',
    db_getAllTasks: '/db/task/list',
    db_getPendingTasks: '/db/task/pending',
    db_getCurrentTasks: '/db/task/current',
    db_getHistoryTasks: '/db/task/history',

    // === 认证相关 (数据库版本) ===
    db_login: '/db/auth/login',
    db_register: '/db/auth/register',
    db_logout: '/db/auth/logout',
    db_heartbeat: '/db/auth/heartbeat',
    db_onlineUsers: '/db/auth/online-users',
    faceRegister: '/api/auth/face_register',
    faceRecognize: '/api/video/recognize_face',

    // 环境检测与对话
    chat: '/api/robot/chat',
    // 管理员确认（机器人阻塞等待前端确认）
    robotConfirm: '/api/robot/confirm',
    robotConfirmPending: '/api/robot/confirm/pending',
    robotConfirmStream: '/api/robot/confirm/stream',
    // 环境检查
    envCheck: '/api/check_envs',
    // 知识图谱与用户画像
    graph: '/graph',
    userProfileTags: '/profile/${userId}/tags',
    userProfileMarkdown: '/profile/${userId}/markdown',

  }
};
