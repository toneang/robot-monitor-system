import eventBus from '../core/event-bus.js';
import apiService from './api.service.js';

const LOCK_CHANGED_EVENT = 'task-form-lock:changed';

class TaskFormLockService {
  constructor() {
    this.started = false;
    this.interval = null;
    this.refreshPromise = null;
    this.state = this.getDefaultState();
  }

  start(intervalMs = 5000) {
    if (this.started) return;
    this.started = true;
    this.refresh();
    this.interval = setInterval(() => {
      this.refresh();
    }, intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.started = false;
    this.refreshPromise = null;
  }

  getDefaultState() {
    return {
      enabled: true,
      updatedAt: '',
      updatedBy: ''
    };
  }

  normalizeState(rawState) {
    const payload = rawState?.data && typeof rawState.data === 'object'
      ? rawState.data
      : rawState;
    const fallback = this.getDefaultState();

    if (!payload || typeof payload !== 'object') {
      return fallback;
    }

    return {
      enabled: payload.enabled !== undefined ? !!payload.enabled : fallback.enabled,
      updatedAt: String(payload.updatedAt || payload.updated_at || '').trim(),
      updatedBy: String(payload.updatedBy || payload.updated_by || '').trim()
    };
  }

  statesEqual(left, right) {
    return !!left
      && !!right
      && left.enabled === right.enabled
      && left.updatedAt === right.updatedAt
      && left.updatedBy === right.updatedBy;
  }

  getState() {
    return { ...this.state };
  }

  setCachedState(rawState, forceEmit = false) {
    const nextState = this.normalizeState(rawState);
    const changed = !this.statesEqual(this.state, nextState);
    this.state = nextState;

    if (changed || forceEmit) {
      this.emit(this.getState());
    }

    return this.getState();
  }

  async refresh() {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await apiService.getTaskFormLockConfig();
        return this.setCachedState(response);
      } catch (error) {
        console.warn('Failed to fetch task form lock config:', error);
        return this.getState();
      }
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async setState(enabled, updatedBy = '') {
    const response = await apiService.updateTaskFormLockConfig(enabled, updatedBy);
    return this.setCachedState(response, true);
  }

  isEnabled() {
    return this.getState().enabled;
  }

  onChange(callback) {
    return eventBus.on(LOCK_CHANGED_EVENT, callback);
  }

  emit(state) {
    eventBus.emit(LOCK_CHANGED_EVENT, state);
  }
}

export default new TaskFormLockService();
