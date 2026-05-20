/**
 * 序号管理器
 * 用于管理任务的显示序号
 */
class SerialManager {
  constructor() {
    this.serialMap = {};
  }
  
  /**
   * 重置所有序号
   */
  reset() {
    this.serialMap = {};
  }
  
  /**
   * 设置任务序号
   */
  set(taskId, serial) {
    this.serialMap[taskId] = serial;
    return serial;
  }
  
  /**
   * 获取任务序号
   */
  get(taskId) {
    return this.serialMap[taskId];
  }
  
  /**
   * 获取下一个序号
   */
  getNext() {
    const values = Object.values(this.serialMap);
    if (!values.length) return 1;
    const max = Math.max(...values.map(v => Number(v) || 0));
    return max + 1;
  }
  
  /**
   * 检查序号是否存在
   */
  has(taskId) {
    return taskId in this.serialMap;
  }
  
  /**
   * 删除序号
   */
  remove(taskId) {
    delete this.serialMap[taskId];
  }
}

export default new SerialManager();