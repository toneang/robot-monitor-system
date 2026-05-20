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
  }

  isManualStatusLocked(taskId) {
    const task = storageService.getTask(taskId);
    return !!task?.manualStatusLocked;
  }

  applyManualStatusLock(taskId, status, message) {
    const updates = {
      status,
      manualStatusLocked: true,
      manualStatusUpdatedAt: new Date().toISOString()
    };

    if (message !== undefined) {
      updates.message = message;
    }

    storageService.updateTask(taskId, updates);
    this.stopPolling(taskId);
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
    const SUBMITTING_TIMEOUT_MS = 2 * 60 * 1000;
    return (tasks || []).filter(task => {
      const status = String(task.status || '').toLowerCase();
      if (status === 'submitting') {
        const createdAt = new Date(task.timestamp || task.create_time || 0).getTime();
        if (createdAt > 0 && Date.now() - createdAt > SUBMITTING_TIMEOUT_MS) {
          return false;
        }
      }
      return true;
    });
  }

  getLocalInFlightTasks(serverTaskIds = new Set(), predicate = null) {
    const inFlightStatuses = new Set(['submitting', 'pending', 'executing', 'processing', 'running', 'paused']);
    const localTasks = this.filterExpiredSubmittingTasks(storageService.getTasks() || []);

    return localTasks.filter(task => {
      if (serverTaskIds.has(task.id)) return false;
      if (!inFlightStatuses.has(String(task.status || '').toLowerCase())) return false;
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
  
    /**
   * 获取所有任务
   */
    async getAllTasks() {
      try {
        const response = await apiService.getAllTasks();
        // 兼容 response 直接为数组 或 { data: [...] } 的情况
        const tasks = Array.isArray(response) ? response : (response && response.data ? response.data : []);
        const tasksWithLocalOverrides = this.mergeLocalTaskMetadata(tasks);
  
        // 远端部署后可能出现接口返回延迟：保护本地刚创建、尚未被服务端返回的任务不被覆盖
        const serverTaskIds = new Set(tasksWithLocalOverrides.map(task => task.id));
        const localInFlightTasks = this.getLocalInFlightTasks(serverTaskIds);
        const mergedTasks = tasksWithLocalOverrides.concat(localInFlightTasks);
  
        console.log(`[TaskService] Fetched ${tasks.length} tasks from API, merged ${localInFlightTasks.length} local in-flight task(s)`);
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
      return this.mergeLocalTaskMetadata(response && response.data ? response.data : []);
    } catch (error) {
      console.error('Failed to fetch pending tasks:', error);
      return [];
    }
  }

  /**
   * 获取Current任务
   */
  async getCurrentTasks() {
    try {
      const response = await apiService.getCurrentTasks();
      return this.mergeLocalTaskMetadata(response && response.data ? response.data : []);
    } catch (error) {
      console.error('Failed to fetch current tasks:', error);
      return [];
    }
  }

  /**
   * 获取History任务
   */
  async getHistoryTasks() {
    try {
      const response = await apiService.getHistoryTasks();
      return this.mergeLocalTaskMetadata(response && response.data ? response.data : []);
    } catch (error) {
      console.error('Failed to fetch history tasks:', error);
      return [];
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
      case 'history':
        return this.getHistoryTasks();
      case 'current':
        return this.getCurrentTasks();
      case 'pending':
      case 'future':
        return this.getPendingTasks();
      case 'all':
      default:
        return this.getAllTasks();
    }
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

    try {
      const data = await apiService.getTaskStatus(taskId);
      if (this.isManualStatusLocked(taskId)) {
        this.stopPolling(taskId);
        return;
      }

      console.log(`[TaskService] Polled status for task ${taskId}:`, data);
      const status = data.status || data.data?.status;
      const message = data.message || data.data?.message;
      
      if (status) {
        // 1. 获取当前本地状态进行比较
        const currentTask = storageService.getTask(taskId);
        const statusChanged = currentTask && currentTask.status !== status;
        const messageChanged = currentTask && currentTask.message !== message;
        
        // 2. 更新 UI 和 本地缓存
        if (statusChanged || messageChanged) {
          console.log(`[TaskService] 准备更新任务 ${taskId} 状态为:`, status, '消息:', message);
          storageService.updateTask(taskId, { status, message });

          // 3. 仅更新数据库任务状态（id, status）
          if (statusChanged) {
            // 3. 仅更新数据库任务状态（id, status）
            await this.updateTaskStatus(taskId, status);
          }

          eventBus.emit('task:status-update', { taskId, status, message });
        }
        
        // 如果任务完成或失败，停止轮询
        if (status === 'completed' || status === 'failed' || status === 'finished') {
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
    // 自动补充创建者信息
    if (!taskData.creator) {
        const user = authService.getUser();
        taskData.creator = user ? user.username : 'Unknown';
    }
    
    // 先保存到本地缓存
    storageService.addTask(taskData);
    
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
      await apiService.updateTaskStatus(taskId, status);
    } catch (error) {
      console.warn('Failed to update task status in database:', error);
    }
  }

  async overrideTaskStatus(taskId, status, message) {
    await this.updateTaskStatus(taskId, status);
    this.applyManualStatusLock(taskId, status, message);
    eventBus.emit('task:status-update', { taskId, status, message, source: 'manual-override' });
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
