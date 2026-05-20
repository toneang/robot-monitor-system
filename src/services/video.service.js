import { API_CONFIG } from '../config/api.config.js';

/**
 * 视频流服务类
 * 用于处理MJPEG视频流的显示
 */
export class VideoStreamService {
  constructor(endpoint, imgElement, placeholderElement) {
    this.endpoint = endpoint;
    this.imgElement = imgElement;
    this.placeholderElement = placeholderElement;
    this.isRunning = false;
  }
  
  /**
   * 启动视频流
   */
  start() {
    if (this.isRunning) return;

    // 添加时间戳防止浏览器缓存
    const url = `${API_CONFIG.robotUrl}${this.endpoint}?t=${Date.now()}`;
    this.imgElement.crossOrigin = 'anonymous';
    this.imgElement.src = url;
    this.isRunning = true;

    // 加载成功
    this.imgElement.onload = () => {
      this.imgElement.style.display = 'block';
      if (this.placeholderElement) {
        this.placeholderElement.style.display = 'none';
      }
    };

    // 加载失败
    this.imgElement.onerror = () => {
      console.warn(`[VideoStream] ${this.endpoint} 连接失败`);
      this.imgElement.style.display = 'none';
      if (this.placeholderElement) {
        this.placeholderElement.style.display = 'block';
      }
      this.isRunning = false;
    };
  }
  
  /**
   * 停止视频流
   */
  stop() {
    this.imgElement.src = '';
    this.imgElement.removeAttribute('src');
    this.imgElement.style.display = 'none';
    if (this.placeholderElement) {
      this.placeholderElement.style.display = 'block';
    }
    this.isRunning = false;
  }
  
  /**
   * 重启视频流
   */
  restart() {
    this.stop();
    setTimeout(() => this.start(), 100);
  }
}