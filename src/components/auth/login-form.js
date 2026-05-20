import { authService } from '../../services/auth.service.js';

export class LoginForm {
    constructor() {
        this.form = document.getElementById('loginForm');
        this.usernameInput = document.getElementById('username');
        this.passwordInput = document.getElementById('password'); 
        this.confirmPasswordInput = document.getElementById('confirmPassword'); // New

        this.roleInputs = document.getElementsByName('role');
        this.toggleBtn = document.getElementById('toggleAuthMode'); 
        this.submitBtn = document.getElementById('authSubmitBtn');
        this.titleEl = document.getElementById('authTitle'); 
        this.errorMsg = document.getElementById('loginErrorMsg'); 
        
        // 关键改动：使用 ID 获取容器，确保获取准确
        this.roleContainer = document.getElementById('roleSelectionContainer');
        this.confirmPasswordContainer = document.getElementById('confirmPasswordContainer');
        this.identityContainer = document.getElementById('identitySelectionContainer');

        this.isLoginMode = true;

        if (this.form) {
            this.init();
        }
    }

    init() {
        console.log('LoginForm init:', {
            isLoginMode: this.isLoginMode,
            identityContainer: this.identityContainer,
            confirmPasswordContainer: this.confirmPasswordContainer,
            roleContainer: this.roleContainer
        });

        this.form.addEventListener('submit', (e) => this.handleSubmit(e));

        if (this.toggleBtn) {
            this.toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleMode();
            });
        }

        // 清除错误信息
        this.usernameInput.addEventListener('input', () => this.hideError());
        if (this.passwordInput) this.passwordInput.addEventListener('input', () => this.hideError());
        if (this.confirmPasswordInput) this.confirmPasswordInput.addEventListener('input', () => this.hideError()); // New
    }

    toggleMode() {
        this.isLoginMode = !this.isLoginMode;
        
        if (this.isLoginMode) {
            this.titleEl.textContent = 'Please sign in to your account';
            this.submitBtn.innerHTML = '<span class="absolute left-0 inset-y-0 flex items-center pl-3"><i class="fa fa-sign-in group-hover:text-white/80 transition-colors"></i></span>Sign In';
            this.toggleBtn.textContent = 'Create an account';

            // 登录模式：显示角色选择，隐藏确认密码和身份选择
            if (this.roleContainer) this.roleContainer.classList.remove('hidden');
            if (this.confirmPasswordContainer) this.confirmPasswordContainer.classList.add('hidden');
            if (this.identityContainer) this.identityContainer.classList.add('hidden');
            if (this.confirmPasswordInput) {
                this.confirmPasswordInput.required = false;
                this.confirmPasswordInput.value = ''; // 清空值
            }

        } else {
            this.titleEl.textContent = 'Create a new account';
            this.submitBtn.innerHTML = '<span class="absolute left-0 inset-y-0 flex items-center pl-3"><i class="fa fa-user-plus group-hover:text-white/80 transition-colors"></i></span>Register';
            this.toggleBtn.textContent = 'Already have an account? Sign in';

            // 注册模式：隐藏角色选择，显示确认密码和身份选择
            if (this.roleContainer) this.roleContainer.classList.add('hidden');
            if (this.confirmPasswordContainer) this.confirmPasswordContainer.classList.remove('hidden');
            if (this.confirmPasswordInput) this.confirmPasswordInput.required = true;
            if (this.identityContainer) this.identityContainer.classList.remove('hidden');
        }
        
        this.hideError();
        this.form.reset();
    }

    async handleSubmit(e) {
        e.preventDefault();
        
        const username = this.usernameInput.value.trim();
        const password = this.passwordInput ? this.passwordInput.value.trim() : '';
        let role = 'user'; // 默认为 user
        let identity = null;

        // 如果是登录模式，才读取用户选择的角色；如果是注册模式，获取身份字段
        if (this.isLoginMode) {
             for (const input of this.roleInputs) {
                if (input.checked) {
                    role = input.value;
                    break;
                }
            }
        } else {
            // 注册模式：获取身份选择
            const identitySelect = document.getElementById('identity');
            if (identitySelect) {
                identity = identitySelect.value;
            }
        }


        if (!username || !password) {
            this.showError('Username and password are required');
            return;
        }
        
        // 注册模式验证两次密码
        if (!this.isLoginMode) {
            const confirmPassword = this.confirmPasswordInput ? this.confirmPasswordInput.value.trim() : '';
            if (password !== confirmPassword) {
                this.showError('Passwords do not match');
                return;
            }
        }

        this.setLoading(true);
        this.hideError();

        try {
            if (this.isLoginMode) {
                await authService.login(username, password, role);
            } else {
                await authService.register(username, password, role, identity);
                alert('Registration successful! Please sign in.');
                this.toggleMode();
            }
        } catch (error) {
            console.error('Auth error:', error);
            // 显示更友好的错误信息
            let msg = this.isLoginMode ? 'Login failed' : 'Registration failed';
            if (error.message) {
                msg += ': ' + error.message;
            }
            this.showError(msg);
        } finally {
            this.setLoading(false);
        }
    }

    setLoading(isLoading) {
        if (this.submitBtn) {
            this.submitBtn.disabled = isLoading;
            const originalText = this.isLoginMode ? 'Sign In' : 'Register';
            if (isLoading) {
                this.submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Processing...';
            } else {
                 const icon = this.isLoginMode ? 'fa-sign-in' : 'fa-user-plus';
                 this.submitBtn.innerHTML = `<span class="absolute left-0 inset-y-0 flex items-center pl-3"><i class="fa ${icon} group-hover:text-white/80 transition-colors"></i></span>${originalText}`;
            }
        }
    }

    showError(msg) {
        if (this.errorMsg) {
            this.errorMsg.querySelector('span').textContent = msg;
            this.errorMsg.classList.remove('hidden');
        } else {
            alert(msg);
        }
    }

    hideError() {
        if (this.errorMsg) {
            this.errorMsg.classList.add('hidden');
        }
    }
}
