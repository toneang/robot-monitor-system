import apiService from './api.service.js';
import { authService } from './auth.service.js';

export class TaskConfirmService {
  constructor(modal, toastHandler = null) {
    this.modal = modal;
    this.toastHandler = toastHandler;
    this.interval = null; // fallback polling
    this.reconnectTimer = null;
    this.eventSource = null;
    this.isRunning = false;
    this.seenRequests = new Set();

    if (this.modal && typeof this.modal.setOnDecision === 'function') {
      this.modal.setOnDecision((taskId, action, phase) => this.submitDecision(taskId, action, phase));
    }
  }

  startPolling(intervalMs = 3000) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.connectSSE();

    // Fallback polling: keep it frequent enough in case SSE is buffered or dropped.
    this.checkPendingConfirmations();
    this.interval = setInterval(() => {
      this.checkPendingConfirmations();
    }, intervalMs);
  }

  stopPolling() {
    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.disconnectSSE();
    this.seenRequests.clear();
  }

  connectSSE() {
    const user = authService.getUser();
    if (!user || user.role !== 'admin' || !this.isRunning) return;

    try {
      this.disconnectSSE();
      const streamUrl = apiService.getTaskConfirmStreamUrl();
      this.eventSource = new EventSource(streamUrl);

      this.eventSource.onopen = () => {
        this.checkPendingConfirmations();
      };

      this.eventSource.addEventListener('confirm_required', async (event) => {
        await this.handleSSEMessage(event.data);
      });

      // Compatible with backends that only emit default "message" events.
      this.eventSource.onmessage = async (event) => {
        await this.handleSSEMessage(event.data);
      };

      this.eventSource.onerror = () => {
        this.disconnectSSE();
        if (!this.isRunning) return;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.connectSSE();
          this.checkPendingConfirmations();
        }, 3000);
      };
    } catch (error) {
      console.warn('Failed to create SSE connection:', error);
    }
  }

  disconnectSSE() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  async handleSSEMessage(rawData) {
    let payload = {};
    try {
      payload = rawData ? JSON.parse(rawData) : {};
    } catch (error) {
      return;
    }

    const taskId = String(payload.task_id || payload.taskId || '').trim();
    if (!taskId) return;

    await this.enqueueTaskById(taskId, {
      phase: payload.phase,
      actions: payload.actions
    });
  }

  async checkPendingConfirmations() {
    const user = authService.getUser();
    if (!user || user.role !== 'admin') return;

    try {
      const response = await apiService.getPendingConfirmTasks();
      const items = this.normalizePendingItems(response);

      for (const item of items) {
        const taskId = String(item.task_id || item.taskId || '').trim();
        if (!taskId) continue;
        await this.enqueueTaskById(taskId, {
          phase: item.phase,
          actions: item.actions
        });
      }
    } catch (error) {
      // Keep polling resilient; only log in debug output.
      console.warn('Failed to check pending confirmations:', error);
    }
  }

  async enqueueTaskById(taskId, metadata = {}) {
    const phase = this.normalizePhase(metadata.phase);
    const actions = this.normalizeActions(metadata.actions, phase);
    const requestKey = this.getRequestKey(taskId, phase);
    if (this.seenRequests.has(requestKey)) return;

    this.seenRequests.add(requestKey);
    try {
      const task = await apiService.getTaskDetail(taskId);
      this.modal.enqueue({ taskId, phase, actions, task: task || null });
    } catch (error) {
      console.warn(`Failed to load detail for confirmation task ${taskId}:`, error);
      this.modal.enqueue({ taskId, phase, actions, task: null });
    }
  }

  normalizePendingItems(response) {
    if (Array.isArray(response)) return response;

    if (response?.pending && (response?.task_id || response?.taskId)) {
      return [{
        task_id: response.task_id || response.taskId,
        phase: response.phase,
        actions: response.actions
      }];
    }

    const raw = response?.data || response?.items || [];
    if (!Array.isArray(raw)) return [];
    return raw;
  }

  normalizePhase(phase) {
    const value = String(phase || '').trim();
    return value || 'confirm';
  }

  normalizeActions(actions, phase) {
    if (Array.isArray(actions) && actions.length > 0) {
      return actions.map(action => String(action).trim()).filter(Boolean);
    }
    return phase === 'manual_takeover' ? ['continue', 'cancel'] : ['execute', 'takeover', 'cancel'];
  }

  getRequestKey(taskId, phase) {
    return `${String(taskId)}:${this.normalizePhase(phase)}`;
  }

  async submitDecision(taskId, action, phase = 'confirm') {
    try {
      const response = await apiService.submitTaskConfirmation(taskId, action);
      if (this.toastHandler) {
        this.toastHandler(`Task ${taskId} action submitted: ${action}`, 'success');
      }
      if (response?.phase && this.modal && typeof this.modal.enqueue === 'function') {
        await this.enqueueTaskById(taskId, {
          phase: response.phase,
          actions: response.actions
        });
      }
      return response;
    } catch (error) {
      this.seenRequests.delete(this.getRequestKey(taskId, phase));
      if (this.toastHandler) {
        this.toastHandler(`Failed to submit confirmation for task ${taskId}`, 'error');
      }
      throw error;
    }
  }
}
