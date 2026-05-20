import eventBus from '../core/event-bus.js';
import apiService from './api.service.js';

const AUTH_USER_KEY = 'robot_monitor_user';
const AUTH_SESSION_KEY = 'robot_monitor_session_id';

class AuthService {
    constructor() {
        this.currentUser = null;
        this.loadUser();
    }

    /**
     * 从本地存储加载用户
     */
    loadUser() {
        try {
            const userJson = localStorage.getItem(AUTH_USER_KEY);
            if (userJson) {
                this.currentUser = JSON.parse(userJson);
                const storedSessionId = localStorage.getItem(AUTH_SESSION_KEY);
                if (storedSessionId && this.currentUser && !this.currentUser.session_id) {
                    this.currentUser.session_id = storedSessionId;
                }
            }
        } catch (error) {
            console.error('Failed to load user from storage', error);
            this.clearLocalAuth();
        }
    }

    persistAuthState() {
        if (!this.currentUser) {
            localStorage.removeItem(AUTH_USER_KEY);
            localStorage.removeItem(AUTH_SESSION_KEY);
            return;
        }

        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(this.currentUser));
        if (this.currentUser.session_id) {
            localStorage.setItem(AUTH_SESSION_KEY, this.currentUser.session_id);
        } else {
            localStorage.removeItem(AUTH_SESSION_KEY);
        }
    }

    clearLocalAuth() {
        this.currentUser = null;
        localStorage.removeItem(AUTH_USER_KEY);
        localStorage.removeItem(AUTH_SESSION_KEY);
    }

    getSessionId() {
        return this.currentUser?.session_id || localStorage.getItem(AUTH_SESSION_KEY) || '';
    }

    buildPresencePayload() {
        if (!this.currentUser) return null;

        return {
            session_id: this.getSessionId(),
            username: this.currentUser.username,
            role: this.currentUser.role,
            identity: this.currentUser.identity
        };
    }

    async ensurePresenceSession() {
        const payload = this.buildPresencePayload();
        if (!payload || !payload.username) return null;

        const response = await apiService.sendPresenceHeartbeat(payload);
        const sessionId = response?.session_id || payload.session_id;
        if (sessionId && this.currentUser) {
            this.currentUser.session_id = sessionId;
            this.persistAuthState();
        }

        return response;
    }

    /**
     * 登录
     * @param {string} username 
     * @param {string} password
     * @param {string} role 'admin' | 'user'
     */
    async login(username, password, role) {
        try {
            // 调用 API 进行登录
            
            let user;
            let loginResponse;
            try {
                console.log('[AuthService] Attempting login for user:', username, 'with role:', role);
                loginResponse = await apiService.login(username, password, role);
                
                // 适配不同 API 返回格式
                if (loginResponse.code === 200) {
                     user = loginResponse.user || loginResponse.data;
                } else {
                     // 如果后端返回了业务错误码（如 401），手动抛出错误信息
                     // 这样前端就能捕获并提示 "账号密码有误" 而不是通用的 fetch 错误
                     alert('Incorrect username or password!');
                     throw new Error('Incorrect username or password!');
                }
            } catch (error) {
                console.warn('API login failed:', error);
                throw error;
            }

            if (!user) {
                // 如果 API 没报错但也没给 user，手动构造一个
                user = { username, role, loginTime: new Date().toISOString() };
            }

            if (!user.loginTime) {
                user.loginTime = new Date().toISOString();
            }

            const resolvedSessionId = user.session_id || loginResponse?.session_id || '';
            if (resolvedSessionId) {
                user.session_id = resolvedSessionId;
            }

            this.currentUser = user;
            this.persistAuthState();
            
            eventBus.emit('auth:login', user);
            return true;
        } catch (error) {
            throw error;
        }
    }

    /**
     * 注册
     */
    async register(username, password, role, identity) {
        try {
            const response = await apiService.register(username, password, role, identity);
            // 检查应用层面的错误代码 (如果后端返回 200 OK 但包含错误 code)
            if (response && response.code && response.code !== 200) {
                 const msg = response.message || 'Registration failed';
                 if (msg.toLowerCase().includes('exist') || msg.toLowerCase().includes('duplicate')) {
                     alert(msg);
                 } else {
                     alert('Registration failed: ' + msg);
                 }
                 throw new Error(msg);
            }
            return response;
        } catch (error) {
            // 捕获 API 层面抛出的错误 (包括 400/409/500 等)
            const msg = error.message || '';
            // 针对“用户名已存在”的情况进行提示
            if (msg.toLowerCase().includes('exist') || msg.toLowerCase().includes('duplicate') || error.status === 409) {
                alert('Username already exists, please choose another one!');
            } else {
                alert('Registration failed: ' + msg);
            }
            throw error;
        }
    }

    /**
     * 登出
     */
    logout() {
        const logoutPayload = this.buildPresencePayload();
        this.clearLocalAuth();
        eventBus.emit('auth:logout');

        if (logoutPayload && (logoutPayload.session_id || logoutPayload.username)) {
            apiService.logoutSession(logoutPayload.session_id, logoutPayload.username).catch((error) => {
                console.warn('Failed to notify server logout:', error);
            });
        }
    }

    /**
     * 获取当前用户
     */
    getUser() {
        return this.currentUser;
    }

    /**
     * 检查是否已登录
     */
    isAuthenticated() {
        return !!this.currentUser;
    }

    /**
     * 检查是否是管理员
     */
    isAdmin() {
        return this.currentUser && this.currentUser.role === 'admin';
    }
}

// 导出单例
export const authService = new AuthService();
