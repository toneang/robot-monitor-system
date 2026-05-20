/**
 * 格式化工具函数
 */

/**
 * 格式化日期时间
 */
export function formatDateTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * 格式化时间（只显示时分秒）
 */
export function formatTime(dateString) {
  if (!dateString) return '';
  const parts = dateString.split(' ');
  return parts.length > 1 ? parts[1] : dateString;
}

/**
 * 格式化数字（保留指定小数位）
 */
export function formatNumber(num, decimals = 2) {
  if (typeof num !== 'number') return '--';
  return (Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals)).toFixed(decimals);
}

/**
 * 格式化百分比
 */
export function formatPercentage(value, decimals = 0) {
  if (typeof value !== 'number') return '--';
  return `${Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals)}%`;
}

/**
 * 格式化距离
 */
export function formatDistance(meters) {
  if (typeof meters !== 'number') return '--';
  if (meters >= 1000) {
    return `${formatNumber(meters / 1000, 2)}km`;
  }
  return `${Math.round(meters)}m`;
}

/**
 * 格式化速度
 */
export function formatSpeed(metersPerSecond) {
  if (typeof metersPerSecond !== 'number') return '--';
  return `${formatNumber(metersPerSecond, 2)}m/s`;
}

/**
 * 格式化延迟
 */
export function formatLatency(milliseconds) {
  if (typeof milliseconds !== 'number') return '--';
  if (milliseconds === -1) return '超时';
  return `${Math.round(milliseconds)}ms`;
}