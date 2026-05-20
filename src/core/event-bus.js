/**
 * 事件总线
 * 用于组件之间的通信
 */
class EventBus {
  constructor() {
    this.events = {};
  }
  
  /**
   * 订阅事件
   */
  on(event, callback) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
    
    // 返回取消订阅函数
    return () => this.off(event, callback);
  }
  
  /**
   * 取消订阅
   */
  off(event, callback) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(cb => cb !== callback);
  }
  
  /**
   * 触发事件
   */
  emit(event, data) {
    if (!this.events[event]) return;
    this.events[event].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    });
  }
  
  /**
   * 只订阅一次
   */
  once(event, callback) {
    const wrapper = (data) => {
      callback(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }
  
  /**
   * 清空所有事件监听
   */
  clear() {
    this.events = {};
  }
  
  /**
   * 获取指定事件的监听器数量
   */
  listenerCount(event) {
    return this.events[event]?.length || 0;
  }
}

export default new EventBus();