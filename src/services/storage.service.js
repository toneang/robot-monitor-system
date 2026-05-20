const STORAGE_KEY = 'robot_monitor_tasks';

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
  }
  
  /**
   * 获取单个任务
   */
  getTask(taskId) {
    const tasks = this.getTasks();
    return tasks.find(t => t.id === taskId);
  }
}

export default new StorageService();