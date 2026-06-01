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
            storageService.updateTask(task.id, { status: 'submitting' });
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
    const task = storageService.getTask(taskId);
    return !!task?.manualStatusLocked;
  }

  setLocalTaskState(taskId, { status, message, manualStatusLocked } = {}) {
    const updates = {};

    if (status !== undefined) {
      updates.status = status;
    }

    if (message !== undefined) {
      updates.message = message;
    }

    if (manualStatusLocked !== undefined) {
      updates.manualStatusLocked = manualStatusLocked;
      updates.manualStatusUpdatedAt = manualStatusLocked ? new Date().toISOString() : null;
    }

    if (Object.keys(updates).length > 0) {
      storageService.updateTask(taskId, updates);
    }
  }

  emitTaskStatusUpdate(taskId, status, message, source) {
    eventBus.emit('task:status-update', { taskId, status, message, source });
  }

  syncTaskStateToFrontend(taskId, status, message, options = {}) {
    const currentTask = storageService.getTask(taskId) || {};
    const resolvedStatus = status !== undefined ? status : currentTask.status;
    const resolvedMessage = message !== undefined ? message : currentTask.message;

    this.setLocalTaskState(taskId, {
      status: resolvedStatus,
      message,
      manualStatusLocked: options.manualStatusLocked
    });

    if (options.stopPolling || !this.isPollingStatus(resolvedStatus)) {
      this.stopPolling(taskId);
    } else if (this.isPollingStatus(resolvedStatus)) {
      this.startPolling(taskId);
    }

    const statusChanged = resolvedStatus !== currentTask.status;
    const messageChanged = message !== undefined && resolvedMessage !== currentTask.message;
    const lockChanged = options.manualStatusLocked !== undefined && options.manualStatusLocked !== currentTask.manualStatusLocked;

    if (statusChanged || messageChanged || lockChanged || options.forceEmit) {
      this.emitTaskStatusUpdate(taskId, resolvedStatus, resolvedMessage, options.source);
    }
  }

  applyManualStatusLock(taskId, status, message) {
    this.setLocalTaskState(taskId, {
      status,
      message,
      manualStatusLocked: true
    });
    this.stopPolling(taskId);
  }

  releaseManualStatusLock(taskId) {
    this.setLocalTaskState(taskId, {
      manualStatusLocked: false
    });
  }

  mergeLocalTaskMetadata(tasks) {
    const localTasks = storageService.getTasks() || [];
    const localTaskMap = new Map(localTasks.map(task => [task.id, task]));

    return (tasks || []).map(task => {
      const localTask = localTaskMap.get(task.id);
      if (!localTask) {
        return task;
      }

      const mergedTask = { ...task };

      if (localTask.display_type) {
        mergedTask.display_type = localTask.display_type;
      }

      if (localTask.model_selection) {
        mergedTask.model_selection = localTask.model_selection;
      }

      if (localTask.model) {
        mergedTask.model = localTask.model;
      }

      if (localTask.manualStatusLocked) {
        mergedTask.status = localTask.status || task.status;
        mergedTask.message = localTask.message !== undefined ? localTask.message : task.message;
        mergedTask.manualStatusLocked = true;
        mergedTask.manualStatusUpdatedAt = localTask.manualStatusUpdatedAt || null;
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
    return tasks || [];
  }

  getLocalInFlightTasks(serverTaskIds = new Set(), predicate = null) {
    const localTasks = this.filterExpiredSubmittingTasks(storageService.getTasks() || []);

    return localTasks.filter(task => {
      if (serverTaskIds.has(task.id)) return false;
      const isInFlight = this.isPendingTaskStatus(task?.status)
        || this.isCurrentTaskStatus(task?.status)
        || this.isPollingStatus(task?.status);
      if (!isInFlight) return false;
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
    const cachedTasks = this.filterExpiredSubmittingTasks(storageService.getTasks() || []);
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
          const serverTaskIds = new Set(tasksWithLocalOverrides.map(task => task.id));
          const localInFlightTasks = this.getLocalInFlightTasks(serverTaskIds);
          mergedTasks = tasksWithLocalOverrides.concat(localInFlightTasks);
          console.log(`[TaskService] Fetched ${tasks.length} tasks from API, merged ${localInFlightTasks.length} local in-flight task(s)`);
        } else {
          console.log(`[TaskService] Fetched ${tasks.length} tasks from API without local in-flight merge`);
        }

        // 按创建时间倒序排序
        this.sortTasksByCreateTime(mergedTasks);

        // 回写本地缓存
        if (mergedTasks.length > 0) {
          storageService.saveTasks(mergedTasks);
        }

        return mergedTasks;
      } catch (error) {
        console.error('Failed to fetch all tasks:', error);
        // API 不可用时，返回本地缓存，但过滤掉超时的 submitting 任务
        return this.filterExpiredSubmittingTasks(storageService.getTasks() || []);
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
      const serverTaskIds = new Set(tasksWithLocalOverrides.map(task => task.id));
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
        this.filterExpiredSubmittingTasks(storageService.getTasks() || []).filter(task =>
          this.matchesCreator(task, normalizedUsername)
        )
      );
    }
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

    const cachedTask = storageService.getTask(taskId);
    if (this.isTerminalStatus(cachedTask?.status)) {
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
        // 1. 获取当前本地状态进行比较
        const currentTask = storageService.getTask(taskId);
        if (this.isTerminalStatus(currentTask?.status)) {
          this.stopPolling(taskId);
          return;
        }
        // TODO 状态只有
        const statusChanged = currentTask && currentTask.status !== status;
        const messageChanged = currentTask && currentTask.message !== message;
        
        // 2. 更新 UI 和 本地缓存
        if (statusChanged || messageChanged) {
          console.log(`[TaskService] 准备更新任务 ${taskId} 状态为:`, status, '消息:', message);
          this.setLocalTaskState(taskId, { status, message });

          // 3. 仅更新数据库任务状态（id, status）
          if (statusChanged) {
            try {
              await this.updateTaskStatus(taskId, status);
            } catch (updateError) {
              console.warn(`Failed to persist polled status for task ${taskId}:`, updateError);
            }
          }

          this.emitTaskStatusUpdate(taskId, status, message, 'polling');
        }
        
        // 如果任务完成或失败，停止轮询
        if (this.isTerminalStatus(status)) {
          this.stopPolling(taskId); // (updateTaskStatus 已在上一步调用)
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

    // 先保存到本地缓存
    storageService.addTask(taskData);
    console.log('[TaskService] createTask payload:', JSON.stringify(taskData, null, 2));
    try {
      // 1. 传给机器人执行
      const result = await apiService.createTask(taskData);

      if (result.code === 200) {
        // 2. 提交到数据库 (机器人接口调用成功后)
        await this.persistTask(taskData);

        // 3. 开始轮询任务状态
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
        storageService.updateTask(taskId, { status: newStatus });
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
      // 获取当前任务状态
      const task = storageService.getTask(taskId);
      const status = task ? task.status : null;
      
      // 如果任务状态不是 'failed' 或 'finish' (即正在进行或等待中)，则需要在机器人端删除
      // 注意：这里包含了 'completed' 作为已完成状态，根据实际情况可能也视为 finish
      // 假设 'failed', 'finish', 'completed' 都是终止状态
      const isTerminalState = ['failed', 'finish', 'completed'].includes(status);
      
      if (status && !isTerminalState) {
          try {
              await apiService.deleteTaskInRobot(taskId);
          } catch (e) {
              console.warn(`Failed to delete task ${taskId} from robot:`, e);
              // 根据需求，可能即使机器人端删除失败也要尝试数据库删除，
              // 或者在这里中断。暂且继续，以免任务卡死无法删除。
          }
      }

      // 总是从数据库删除
      const result = await apiService.deleteTaskInDb(taskId);
      
      if (result.code === 200) {
        storageService.deleteTask(taskId);
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
