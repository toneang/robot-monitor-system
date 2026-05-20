import eventBus from '../core/event-bus.js';
import apiService from './api.service.js';
import { authService } from './auth.service.js';

export class OnlineStatusService {
    constructor() {
        this.interval = null;
        this.isRunning = false;
        this.refreshPromise = null;
    }

    start(intervalMs = 15000) {
        if (this.isRunning) return;
        this.isRunning = true;
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
        this.isRunning = false;
        this.refreshPromise = null;
        eventBus.emit('presence:update', { count: 0, users: [] });
    }

    async refresh() {
        if (!this.isRunning || !authService.isAuthenticated()) {
            return null;
        }

        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        this.refreshPromise = (async () => {
            try {
                await authService.ensurePresenceSession();
            } catch (error) {
                console.warn('Failed to refresh presence session:', error);
            }

            try {
                const response = await apiService.getOnlineUsers();
                const normalized = this.normalizePresenceResponse(response);
                eventBus.emit('presence:update', normalized);
                return normalized;
            } catch (error) {
                console.warn('Failed to fetch online users:', error);
                return null;
            }
        })();

        try {
            return await this.refreshPromise;
        } finally {
            this.refreshPromise = null;
        }
    }

    normalizePresenceResponse(response) {
        const rawUsers = Array.isArray(response)
            ? response
            : (response?.data || response?.users || []);

        const users = Array.isArray(rawUsers)
            ? rawUsers
                .map((user) => ({
                    username: String(user?.username || '').trim(),
                    role: user?.role || 'user',
                    identity: user?.identity || '',
                    last_seen_at: user?.last_seen_at || '',
                    session_count: Number(user?.session_count || 1)
                }))
                .filter((user) => user.username)
            : [];

        return {
            count: Number(response?.count) || users.length,
            users
        };
    }
}
