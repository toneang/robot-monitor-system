import { API_CONFIG } from '../config/api.config.js';
import { authService } from './auth.service.js';
import taskService from './task.service.js';
import storageService from './storage.service.js';


export class EnvMonitorService {
    constructor(modal) {
        this.modal = modal;
        this.interval = null;
        this.isPolling = false;
        this.lastMessage = null;
        this.lastContextKey = 'global';
        // 注册确认回调，记录已读消息
        if (this.modal && typeof this.modal.setOnConfirm === 'function') {
            this.modal.setOnConfirm(() => {
                if (this.lastMessage) {
                    localStorage.setItem(this.getAcknowledgedStorageKey(this.lastContextKey), this.lastMessage);
                }
            });
        }
    }

    getAcknowledgedStorageKey(contextKey = 'global') {
        return `env_check_acknowledged:${contextKey}`;
    }

    normalizeTaskValue(value) {
        return String(value || '').trim();
    }

    normalizeEnvPayload(rawPayload) {
        if (typeof rawPayload === 'string') {
            return {
                message: rawPayload.trim(),
                taskId: '',
                creator: ''
            };
        }

        return {
            message: this.normalizeTaskValue(rawPayload?.text || rawPayload?.message || rawPayload?.detail),
            taskId: this.normalizeTaskValue(rawPayload?.task_id || rawPayload?.taskId),
            creator: this.normalizeTaskValue(rawPayload?.creator || rawPayload?.username || rawPayload?.user_name)
        };
    }

    findTaskOwner(tasks, taskId = '') {
        if (!Array.isArray(tasks) || tasks.length === 0) {
            return '';
        }

        const normalizedTaskId = this.normalizeTaskValue(taskId);
        if (normalizedTaskId) {
            const matchedTask = tasks.find(task => this.normalizeTaskValue(task?.id) === normalizedTaskId);
            const matchedCreator = this.normalizeTaskValue(matchedTask?.creator);
            if (matchedCreator) {
                return matchedCreator;
            }
        }

        const activeTask = tasks.find(task => taskService.isCurrentTaskStatus(task?.status));
        return this.normalizeTaskValue(activeTask?.creator);
    }

    async resolveTaskOwner(payload) {
        const payloadCreator = this.normalizeTaskValue(payload?.creator);
        if (payloadCreator) {
            return payloadCreator;
        }

        const taskId = this.normalizeTaskValue(payload?.taskId);
        const currentTasks = await taskService.getAllTasks();
        const ownerFromCurrentTasks = this.findTaskOwner(currentTasks, taskId);
        if (ownerFromCurrentTasks) {
            return ownerFromCurrentTasks;
        }

        return this.findTaskOwner(storageService.getTasks(), taskId);
    }

    async shouldShowForCurrentUser(payload) {
        const currentUser = authService.getUser();
        const currentUsername = this.normalizeTaskValue(currentUser?.username);
        if (!currentUsername) {
            return { shouldShow: false, owner: '' };
        }

        const owner = await this.resolveTaskOwner(payload);
        return {
            shouldShow: !!owner && owner === currentUsername,
            owner
        };
    }

    startPolling(intervalMs = 3000) {
        if (this.isPolling) return;
        this.isPolling = true;
        this.checkEnv(); // Initial check
        
        this.interval = setInterval(() => {
            this.checkEnv();
        }, intervalMs);
    }

    stopPolling() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isPolling = false;
    }

    async checkEnv() {
        try {
            const url = `${API_CONFIG.robotUrl}${API_CONFIG.endpoints.envCheck}`;
            const response = await fetch(url);
            
            if (response.ok) {
                const contentType = response.headers.get("content-type");
                let payload = { message: '', taskId: '', creator: '' };
                
                if (contentType && contentType.includes("application/json")) {
                    const data = await response.json();
                    payload = this.normalizeEnvPayload(data);
                } else {
                    payload = this.normalizeEnvPayload(await response.text());
                }

                // Clean up message
                const message = this.normalizeTaskValue(payload.message);

                if (message.length > 0) {
                    const { shouldShow, owner } = await this.shouldShowForCurrentUser(payload);
                    if (!shouldShow) {
                        return;
                    }

                    const contextKey = this.normalizeTaskValue(payload.taskId) || owner || 'global';
                    const acknowledged = localStorage.getItem(this.getAcknowledgedStorageKey(contextKey));
                    const isNewContext = contextKey !== this.lastContextKey;
                    const isNewMessage = message !== this.lastMessage;

                    if ((isNewMessage || isNewContext) && message !== acknowledged) {
                        this.lastMessage = message;
                        this.lastContextKey = contextKey;
                        this.modal.show(message);
                    }
                }
            }
        } catch (error) {
            // Silently fail or log for debug
            // console.debug('Environment check failed:', error);
        }
    }
}
