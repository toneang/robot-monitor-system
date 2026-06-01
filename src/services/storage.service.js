const STORAGE_KEY = 'robot_monitor_tasks';
const UI_PREFS_KEY = 'robot_monitor_ui_prefs';

class StorageService {
  /**
   * 获取所有任务
   */
  getTasks() {
    try {
      const tasks = localStorage.getItem(STORAGE_KEY);
      return tasks ? JSON.parse(tasks) : [];
    } catch (error) {
      console.error('Failed to read from localStorage:', error);
      return [];
    }
  }
  
  /**
   * 保存所有任务
   */
  saveTasks(tasks) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
    }
  }
  
  /**
   * 添加单个任务
   */
  addTask(task) {
    const tasks = this.getTasks();
    if (!tasks.find(t => t.id === task.id)) {
      tasks.push(task);
      this.saveTasks(tasks);
    }
  }
  
  /**
   * 更新任务
   */
  updateTask(taskId, updates) {
    const tasks = this.getTasks();
    const index = tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      tasks[index] = { ...tasks[index], ...updates };
      this.saveTasks(tasks);
    }
  }
  
  /**
   * 删除任务
   */
  deleteTask(taskId) {
    let tasks = this.getTasks();
    tasks = tasks.filter(t => t.id !== taskId);
    this.saveTasks(tasks);
  }
  
  /**
   * 清空所有任务
   */
  clearAll() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(UI_PREFS_KEY);
  }
  
  /**
   * 获取单个任务
   */
  getTask(taskId) {
    const tasks = this.getTasks();
    return tasks.find(t => t.id === taskId);
  }

  // ==================== UI 偏好存储 (与任务状态缓存分离) ====================

  /**
   * 获取所有 UI 偏好
   */
  getUiPrefs() {
    try {
      const prefs = localStorage.getItem(UI_PREFS_KEY);
      return prefs ? JSON.parse(prefs) : {};
    } catch (error) {
      console.error('Failed to read UI prefs from localStorage:', error);
      return {};
    }
  }

  /**
   * 保存所有 UI 偏好
   */
  saveUiPrefs(prefs) {
    try {
      localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
    } catch (error) {
      console.error('Failed to save UI prefs to localStorage:', error);
    }
  }

  /**
   * 获取单个任务的 UI 偏好
   */
  getTaskUiPref(taskId) {
    const prefs = this.getUiPrefs();
    return prefs[taskId] || null;
  }

  /**
   * 设置单个任务的 UI 偏好
   */
  setTaskUiPref(taskId, prefUpdates) {
    const prefs = this.getUiPrefs();
    prefs[taskId] = { ...(prefs[taskId] || {}), ...prefUpdates };
    this.saveUiPrefs(prefs);
  }

  /**
   * 删除单个任务的 UI 偏好
   */
  deleteTaskUiPref(taskId) {
    const prefs = this.getUiPrefs();
    delete prefs[taskId];
    this.saveUiPrefs(prefs);
  }
}

export default new StorageService();