import apiService from './api.service.js';
import storageService from './storage.service.js';
import eventBus from '../core/event-bus.js';
import { API_CONFIG } from '../config/api.config.js';
import { authService } from './auth.service.js';

/**
 * 任务服务类
 * 负责任务的增删改查和状态轮询
 */
class TaskService {
  constructor() {
    this.activePolls = {}; // 存储活跃的轮询定时器
    this.republishTimer = null;
    this.republishInFlight = false;
    this.republishIntervalMs = 10 * 60 * 1000;
    this._polledStatusCache = new Map(); // 内存中记录轮询状态，替代 localStorage 缓存
    this._taskListCache = []; // 当前任务列表的内存缓存，供 detail 面板使用
  }

  normalizeStatus(status) {
    return String(status || '').toLowerCase().trim();
  }

  isTerminalStatus(status) {
    return ['completed', 'finish', 'finished', 'success', 'failed', 'fail'].includes(this.normalizeStatus(status));
  }

  isSubmitState(status) {
    return ['submitting', 'submiting'].includes(this.normalizeStatus(status));
  }

  isCurrentTaskStatus(status) {
    return ['executing', 'processing', 'running', 'paused'].includes(this.normalizeStatus(status));
  }

  isPendingTaskStatus(status) {
    return ['pending', 'submitting', 'submiting'].includes(this.normalizeStatus(status));
  }

  isHistoryTaskStatus(status) {
    return this.isTerminalStatus(status);
  }

  isPollingStatus(status) {
    return ['pending', 'executing', 'processing', 'running'].includes(this.normalizeStatus(status));
  }


  isCurrentTaskStatus(status) {
    return ['executing', 'processing', 'running', 'paused'].includes(this.normalizeStatus(status));
  }

  isPendingTaskStatus(status) {
    return ['pending', 'submitting', 'submiting'].includes(this.normalizeStatus(status));
  }

  isHistoryTaskStatus(status) {
    return this.isTerminalStatus(status);
  }

  filterTasksByBucket(tasks = [], bucket) {
    switch (bucket) {
      case 'current':
        return (tasks || []).filter(task => this.isCurrentTaskStatus(task?.status));
      case 'pending':
        return (tasks || []).filter(task => this.isPendingTaskStatus(task?.status));
      case 'history':
        return (tasks || []).filter(task => this.isHistoryTaskStatus(task?.status));
      default:
        return tasks || [];
    }
  }

  extractTaskList(response) {
    if (Array.isArray(response)) {
      return response;
    }

    return Array.isArray(response?.data) ? response.data : [];
  }

  getRepublishCandidates(tasks = [], username = '') {
    const normalizedUsername = this.normalizeUsername(username);
    return (tasks || []).filter(task => {
      if (!this.isSubmitState(task?.status)) return false;
      if (!normalizedUsername) return false;
      return this.matchesCreator(task, normalizedUsername);
    });
  }

  startRepublishTimer() {
    if (this.republishTimer) return;

    this.republishTimer = setInterval(() => {
      this.republishSubmittingTasks();
    }, this.republishIntervalMs);
  }

  stopRepublishTimer() {
    if (this.republishTimer) {
      clearInterval(this.republishTimer);
      this.republishTimer = null;
    }
    this.republishInFlight = false;
  }

  async republishSubmittingTasks() {
    if (this.republishInFlight || !authService.isAuthenticated()) {
      return [];
    }

    const currentUser = authService.getUser();
    const username = currentUser?.username || '';
    if (!username) {
      return [];
    }

    this.republishInFlight = true;

    try {
      const tasks = await this.getMyTasks(username);
      const candidates = this.getRepublishCandidates(tasks, username);

      if (!candidates.length) {
        return [];
      }

      const republishedTasks = [];

      for (const task of candidates) {
        try {
          const payload = { ...task, status: 'submitting' };
          const result = await apiService.createTask(payload);

          if (result?.code === 200) {
            republishedTasks.push(task);
            this._polledStatusCache.set(task.id, { status: 'submitting', message: null });
            this.startPolling(task.id);
          }
        } catch (error) {
          console.warn(`[TaskService] Failed to republish task ${task.id}:`, error);
        }
      }

      if (republishedTasks.length) {
        eventBus.emit('task:republished', {
          username,
          count: republishedTasks.length,
          taskIds: republishedTasks.map(task => task.id)
        });
      }

      return republishedTasks;
    } finally {
      this.republishInFlight = false;
    }
  }

  isManualStatusLocked(taskId) {
    const prefs = storageService.getTaskUiPref(taskId);
    return !!prefs?.manualStatusLocked;
  }

  setLocalTaskState(taskId, { status, message, manualStatusLocked } = {}) {
    // 状态不再写入 localStorage 的任务列表，仅写入 UI 偏好存储
    const prefUpdates = {};

    if (manualStatusLocked !== undefined) {
      prefUpdates.manualStatusLocked = manualStatusLocked;
      prefUpdates.manualStatusUpdatedAt = manualStatusLocked ? new Date().toISOString() : null;
    }

    // manualStatusLocked 场景下，status 和 message 作为锁定值写入 UI 偏好
    if (manualStatusLocked === true) {
      if (status !== undefined) {
        prefUpdates.status = status;
      }
      if (message !== undefined) {
        prefUpdates.message = message;
      }
    }

    if (Object.keys(prefUpdates).length > 0) {
      storageService.setTaskUiPref(taskId, prefUpdates);
    }

    // 更新内存中的轮询缓存
    if (status !== undefined) {
      this._polledStatusCache.set(taskId, { status, message });
    }
  }

  emitTaskStatusUpdate(taskId, status, message, source) {
    eventBus.emit('task:status-update', { taskId, status, message, source });
  }

  syncTaskStateToFrontend(taskId, status, message, options = {}) {
    const cached = this._polledStatusCache.get(taskId) || {};
    const resolvedStatus = status !== undefined ? status : cached.status;
    const resolvedMessage = message !== undefined ? message : cached.message;

    // 仅在 manualStatusLocked 场景下写入 UI 偏好存储
    if (options.manualStatusLocked !== undefined) {
      this.setLocalTaskState(taskId, {
        status: resolvedStatus,
        message,
        manualStatusLocked: options.manualStatusLocked
      });
    }

    // 更新内存缓存
    if (status !== undefined) {
      this._polledStatusCache.set(taskId, { status, message });
    }

    if (options.stopPolling || !this.isPollingStatus(resolvedStatus)) {
      this.stopPolling(taskId);
    } else if (this.isPollingStatus(resolvedStatus)) {
      this.startPolling(taskId);
    }

    const statusChanged = resolvedStatus !== cached.status;
    const messageChanged = message !== undefined && resolvedMessage !== cached.message;
    const lockChanged = options.manualStatusLocked !== undefined;

    if (statusChanged || messageChanged || lockChanged || options.forceEmit) {
      this.emitTaskStatusUpdate(taskId, resolvedStatus, resolvedMessage, options.source);
    }
  }

  applyManualStatusLock(taskId, status, message) {
    // 仅写入 UI 偏好存储，不写入任务状态缓存
    storageService.setTaskUiPref(taskId, {
      status,
      message,
      manualStatusLocked: true,
      manualStatusUpdatedAt: new Date().toISOString()
    });
    this.stopPolling(taskId);
  }

  releaseManualStatusLock(taskId) {
    storageService.setTaskUiPref(taskId, {
      manualStatusLocked: false
    });
  }

  mergeLocalTaskMetadata(tasks) {
    const uiPrefs = storageService.getUiPrefs();

    return (tasks || []).map(task => {
      const taskPrefs = uiPrefs[task.id];
      if (!taskPrefs) {
        return task;
      }

      const mergedTask = { ...task };

      // UI 偏好字段：本地优先
      if (taskPrefs.display_type) {
        mergedTask.display_type = taskPrefs.display_type;
      }

      if (taskPrefs.model_selection) {
        mergedTask.model_selection = taskPrefs.model_selection;
      }

      if (taskPrefs.model) {
        mergedTask.model = taskPrefs.model;
      }

      // status/message: DB 优先，仅 manualStatusLocked 时使用本地锁定值
      if (taskPrefs.manualStatusLocked) {
        mergedTask.status = taskPrefs.status || task.status;
        mergedTask.message = taskPrefs.message !== undefined ? taskPrefs.message : task.message;
        mergedTask.manualStatusLocked = true;
        mergedTask.manualStatusUpdatedAt = taskPrefs.manualStatusUpdatedAt || null;
      }

      return mergedTask;
    });
  }

  normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
  }

  matchesCreator(task, username) {
    const normalizedUsername = this.normalizeUsername(username);
    if (!normalizedUsername) return false;
    return this.normalizeUsername(task?.creator) === normalizedUsername;
  }

  filterExpiredSubmittingTasks(tasks) {
    const now = Date.now();
    const maxAgeMs = 30 * 1000; // 30 秒超时
    return (tasks || []).filter(task => {
      if (!this.isSubmitState(task?.status)) return true;
      try {
        const createdTime = new Date(task.create_time || task.timestamp || 0).getTime();
        return (now - createdTime) < maxAgeMs;
      } catch {
        return false;
      }
    });
  }

  getLocalInFlightTasks(serverTaskIds = new Set(), predicate = null) {
    const maxAgeMs = 30 * 1000; // 30 秒内的本地任务才参与 in-flight 合并
    const localTasks = this.filterExpiredSubmittingTasks(storageService.getTasks() || []);
    const now = Date.now();

    return localTasks.filter(task => {
      if (serverTaskIds.has(String(task.id))) return false;
      const isInFlight = this.isPendingTaskStatus(task?.status)
        || this.isCurrentTaskStatus(task?.status)
        || this.isPollingStatus(task?.status);
      if (!isInFlight) return false;
      // 时间阈值守卫：超过 30 秒的本地孤儿任务丢弃
      try {
        const createdTime = new Date(task.create_time || task.timestamp || 0).getTime();
        if ((now - createdTime) > maxAgeMs) return false;
      } catch {
        return false;
      }
      if (typeof predicate === 'function' && !predicate(task)) return false;
      return true;
    });
  }

  sortTasksByCreateTime(tasks) {
    return (tasks || []).sort((a, b) => {
      const tA = new Date(a.create_time || a.timestamp || 0);
      const tB = new Date(b.create_time || b.timestamp || 0);
      return tB - tA;
    });
  }

  getCachedTasksByBucket(bucket) {
    const cachedTasks = this.filterExpiredSubmittingTasks(this._taskListCache);
    return this.sortTasksByCreateTime(this.filterTasksByBucket(cachedTasks, bucket));
  }

  /**
   * 获取所有任务
   */
  async getAllTasks(options = {}) {
      const includeLocalInFlight = options.includeLocalInFlight !== false;
      try {
        const response = await apiService.getAllTasks();
        // 兼容 response 直接为数组 或 { data: [...] } 的情况
        const tasks = this.extractTaskList(response);
        const tasksWithLocalOverrides = this.mergeLocalTaskMetadata(tasks);

        let mergedTasks = tasksWithLocalOverrides;
        if (includeLocalInFlight) {
          // 远端部署后可能出现接口返回延迟：保护本地刚创建、尚未被服务端返回的任务不被覆盖
          const serverTaskIds = new Set(tasksWithLocalOverrides.map(task => String(task.id)));
          const localInFlightTasks = this.getLocalInFlightTasks(serverTaskIds);
          mergedTasks = tasksWithLocalOverrides.concat(localInFlightTasks);
          console.log(`[TaskService] Fetched ${tasks.length} tasks from API, merged ${localInFlightTasks.length} local in-flight task(s)`);
        } else {
          console.log(`[TaskService] Fetched ${tasks.length} tasks from API without local in-flight merge`);
        }

        // 按创建时间倒序排序
        this.sortTasksByCreateTime(mergedTasks);

        // 仅缓存到内存，不再写入 localStorage（DB 是唯一权威数据源）
        this._taskListCache = mergedTasks;

        return mergedTasks;
      } catch (error) {
        console.error('Failed to fetch all tasks:', error);
        // API 不可用时，返回内存缓存，但过滤掉超时的 submitting 任务
        return this.filterExpiredSubmittingTasks(this._taskListCache);
      }
    }


  async getMyTasks(username) {
    const normalizedUsername = String(username || '').trim();
    if (!normalizedUsername) {
      return [];
    }

    try {
      const response = await apiService.getMyTasks(normalizedUsername);
      const tasks = Array.isArray(response) ? response : (response && response.data ? response.data : []);
      const tasksWithLocalOverrides = this.mergeLocalTaskMetadata(tasks);
      const serverTaskIds = new Set(tasksWithLocalOverrides.map(task => String(task.id)));
      const localInFlightTasks = this.getLocalInFlightTasks(
        serverTaskIds,
        task => this.matchesCreator(task, normalizedUsername)
      );
      const mergedTasks = tasksWithLocalOverrides.concat(localInFlightTasks);

      this.sortTasksByCreateTime(mergedTasks);
      return mergedTasks;
    } catch (error) {
      console.error('Failed to fetch my tasks:', error);
      return this.sortTasksByCreateTime(
        this.filterExpiredSubmittingTasks(this._taskListCache).filter(task =>
          this.matchesCreator(task, normalizedUsername)
        )
      );
    }
  }

  /**
   * 从内存缓存获取单个任务（供详情面板使用，避免依赖 localStorage）
   */
  getCachedTask(taskId) {
    return this._taskListCache.find(t => String(t.id) === String(taskId)) || null;
  }
  

  /**
   * 获取Pending任务
   */
  async getPendingTasks() {
    try {
      const response = await apiService.getPendingTasks();
      return this.mergeLocalTaskMetadata(this.extractTaskList(response));
    } catch (error) {
      console.error('Failed to fetch pending tasks:', error);
      return this.getCachedTasksByBucket('pending');
    }
  }

  /**
   * 获取Current任务
   */
  async getCurrentTasks() {
    try {
      const response = await apiService.getCurrentTasks();
      return this.mergeLocalTaskMetadata(this.extractTaskList(response));
    } catch (error) {
      console.error('Failed to fetch current tasks:', error);
      return this.getCachedTasksByBucket('current');
    }
  }

  /**
   * 获取History任务
   */
  async getHistoryTasks() {
    try {
      const response = await apiService.getHistoryTasks();
      return this.mergeLocalTaskMetadata(this.extractTaskList(response));
    } catch (error) {
      console.error('Failed to fetch history tasks:', error);
      return this.getCachedTasksByBucket('history');
    }
  }

  /**
   * 根据过滤器获取任务
   */
  async fetchTasks(filter) {
    switch (filter) {
      case 'mine': {
        const currentUser = authService.getUser();
        return currentUser?.username ? this.getMyTasks(currentUser.username) : [];
      }
      case 'history': {
        const tasks = await this.getAllTasks();
        return this.filterTasksByBucket(tasks, 'history');
      }
      case 'current': {
        const tasks = await this.getAllTasks();
        return this.filterTasksByBucket(tasks, 'current');
      }
      case 'pending':
      case 'future': {
        const tasks = await this.getAllTasks();
        return this.filterTasksByBucket(tasks, 'pending');
      }
      case 'all':
      default:
        return this.getAllTasks();
    }
  }

  async getPersistedTask(taskId) {
    try {
      return await apiService.getTaskDetail(taskId);
    } catch (error) {
      console.warn(`Failed to fetch persisted task ${taskId}:`, error);
      return null;
    }
  }

  async syncPersistedTerminalStatus(taskId, source = 'terminal-status-sync') {
    const persistedTask = await this.getPersistedTask(taskId);
    if (!persistedTask || !this.isTerminalStatus(persistedTask.status)) {
      return null;
    }

    this.syncTaskStateToFrontend(taskId, persistedTask.status, persistedTask.message, {
      manualStatusLocked: true,
      stopPolling: true,
      forceEmit: true,
      source
    });

    return persistedTask;
  }
  
  /**
   * 开始轮询任务状态
   */
  startPolling(taskId) {
    if (this.activePolls[taskId]) return;
    if (this.isManualStatusLocked(taskId)) return;
    
    // 立即检查一次
    this.checkTaskStatus(taskId);
    
    // 设置定时轮询
    this.activePolls[taskId] = setInterval(() => {
      this.checkTaskStatus(taskId);
    }, API_CONFIG.polling.interval);
  }

  reconcilePolling(tasks = []) {
    const activeTaskIds = new Set(
      (tasks || [])
        .filter(task => this.isPollingStatus(task?.status))
        .map(task => String(task.id))
    );

    Object.keys(this.activePolls).forEach(taskId => {
      if (!activeTaskIds.has(String(taskId))) {
        this.stopPolling(taskId);
      }
    });

    (tasks || []).forEach(task => {
      if (this.isPollingStatus(task?.status)) {
        this.startPolling(task.id);
      }
    });
  }
  
  /**
   * 停止轮询任务状态
   */
  stopPolling(taskId) {
    if (this.activePolls[taskId]) {
      clearInterval(this.activePolls[taskId]);
      delete this.activePolls[taskId];
    }
  }
  
  /**
   * 检查任务状态
   */
  async checkTaskStatus(taskId) {
    if (this.isManualStatusLocked(taskId)) {
      this.stopPolling(taskId);
      return;
    }

    const cachedStatus = this._polledStatusCache.get(taskId);
    if (this.isTerminalStatus(cachedStatus?.status)) {
      this.stopPolling(taskId);
      return;
    }

    try {
      const data = await apiService.getTaskStatus(taskId);
      if (this.isManualStatusLocked(taskId)) {
        this.stopPolling(taskId);
        return;
      }

      console.log(`[TaskService] Polled status for task ${taskId}:`, data);
      const status = data.status || data.data?.status;
      const message = data.message || data.data?.message;

      const persistedTerminalTask = await this.syncPersistedTerminalStatus(taskId);
      if (persistedTerminalTask) {
        return;
      }

      if (status) {
        // 使用内存缓存判断状态变化（不再依赖 localStorage）
        const previousStatus = cachedStatus?.status;
        const previousMessage = cachedStatus?.message;

        if (this.isTerminalStatus(previousStatus)) {
          this.stopPolling(taskId);
          return;
        }

        const statusChanged = previousStatus && previousStatus !== status;
        const messageChanged = previousMessage !== message;

        // 更新内存缓存（不写 localStorage）
        this._polledStatusCache.set(taskId, { status, message });

        // 将机器人状态中转到 DB（DB 是唯一权威数据源）
        if (statusChanged) {
          console.log(`[TaskService] 任务 ${taskId} 状态变更: ${previousStatus} -> ${status}`);
          try {
            await this.updateTaskStatus(taskId, status);
          } catch (updateError) {
            console.warn(`Failed to relay polled status to DB for task ${taskId}:`, updateError);
          }
        }

        // 驱动 UI 实时更新
        if (statusChanged || messageChanged) {
          this.emitTaskStatusUpdate(taskId, status, message, 'polling');
        }

        // 到达终态，停止轮询
        if (this.isTerminalStatus(status)) {
          this.stopPolling(taskId);
        }
      }
    } catch (error) {
      console.warn(`Polling error for task ${taskId}:`, error);
    }
  }
  
  /**
   * 创建新任务
   */
  async createTask(taskData) {
    const user = authService.getUser();
    console.log('[TaskService] Current user when creating task:', user);
    // 自动补充创建者信息
    if (!taskData.creator) {
      taskData.creator = user ? user.username : 'Unknown';
    }

    // 自动补充创建者身份信息（student / teacher 等）
    if (!taskData.creator_identity) {
      taskData.creator_identity = user?.identity || 'Unknown';
    }
    console.log('identity', taskData.creator_identity)

    console.log('[TaskService] createTask payload:', JSON.stringify(taskData, null, 2));
    try {
      // 1. 传给机器人执行
      const result = await apiService.createTask(taskData);

      if (result.code === 200) {
        // 2. 提交到数据库 (机器人接口调用成功后)
        await this.persistTask(taskData);

        // 3. DB persist 成功后写入 UI 偏好（不在 localStorage 缓存 status）
        const { display_type, model_selection, model } = taskData;
        if (display_type || model_selection || model) {
          storageService.setTaskUiPref(taskData.id, {
            display_type: display_type || '',
            model_selection: model_selection || '',
            model: model || ''
          });
        }

        // 4. 开始轮询任务状态
        this.startPolling(taskData.id);
      }
      return result;
    } catch (error) {
      console.error('Failed to create task:', error);
      throw error;
    }
  }
  
  /**
   * 控制任务（暂停/恢复/终止）
   */
  async controlTask(taskId, action) {
    try {
      const result = await apiService.controlTask(taskId, action);
      if (result.code === 200) {
        const newStatus = action === 'pause' ? 'paused' :
                         action === 'resume' ? 'executing' : 'failed';
        eventBus.emit('task:status-update', { taskId, status: newStatus });
        // 更新内存缓存
        this._polledStatusCache.set(taskId, { status: newStatus, message: null });
      }
      return result;
    } catch (error) {
      console.error('Failed to control task:', error);
      throw error;
    }
  }
  
  /**
   * 删除任务
   */
  async deleteTask(taskId) {
    try {
      // 从内存缓存获取当前任务状态
      const cachedStatus = this._polledStatusCache.get(taskId);
      const status = cachedStatus ? cachedStatus.status : null;

      // 如果任务状态不是终止状态，则需要在机器人端删除
      const isTerminalState = ['failed', 'finish', 'completed'].includes(status);

      if (status && !isTerminalState) {
          try {
              await apiService.deleteTaskInRobot(taskId);
          } catch (e) {
              console.warn(`Failed to delete task ${taskId} from robot:`, e);
          }
      }

      // 总是从数据库删除
      const result = await apiService.deleteTaskInDb(taskId);

      if (result.code === 200) {
        this._polledStatusCache.delete(taskId);
        storageService.deleteTask(taskId);
        storageService.deleteTaskUiPref(taskId);
        this.stopPolling(taskId);
        eventBus.emit('task:deleted', { taskId });
      }
      return result;
    } catch (error) {
      console.error('Failed to delete task:', error);
      throw error;
    }
  }
  
  /**
   * 持久化任务到数据库
   */
  async persistTask(task) {
    try {
      await apiService.persistTask(task);
    } catch (error) {
      console.warn('Failed to persist task to database:', error);
    }
  }

  /**
   * 仅更新任务状态到数据库
   */
  async updateTaskStatus(taskId, status) {
    try {
      return await apiService.updateTaskStatus(taskId, status);
    } catch (error) {
      console.warn('Failed to update task status in database:', error);
      throw error;
    }
  }

  async updateRobotTaskStatus(taskId, status) {
    try {
      return await apiService.updateRobotTaskStatus(taskId, status);
    } catch (error) {
      console.warn('Failed to update task status in robot:', error);
      throw error;
    }
  }

  async overrideTaskStatus(taskId, status, message) {
    const persistedTerminalTask = await this.syncPersistedTerminalStatus(taskId, 'manual-override-skip');
    if (persistedTerminalTask) {
      return persistedTerminalTask;
    }

    await this.updateRobotTaskStatus(taskId, status);
    const result = await this.updateTaskStatus(taskId, status);

    if (this.isTerminalStatus(status)) {
      this.applyManualStatusLock(taskId, status, message);
    } else {
      this.releaseManualStatusLock(taskId);
      this.syncTaskStateToFrontend(taskId, status, message, {
        manualStatusLocked: false,
        stopPolling: false,
        forceEmit: true,
        source: 'manual-override'
      });
      return result;
    }

    this.emitTaskStatusUpdate(taskId, status, message, 'manual-override');
    return result;
  }
  
  /**
   * 停止所有轮询
   */
  stopAllPolling() {
    Object.keys(this.activePolls).forEach(taskId => {
      this.stopPolling(taskId);
    });
  }
}

export default new TaskService();
