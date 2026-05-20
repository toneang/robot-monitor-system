import apiService from '../../services/api.service.js';
import { authService } from '../../services/auth.service.js';

export class FaceRegistrationModal {
    constructor() {
        this.isOpen = false;
        this.stream = null;
        this.modal = null;
        this.video = null;
        this.canvas = null;
        this.init();
    }

    init() {
        // Create modal structure
        this.modal = document.createElement('div');
        this.modal.id = 'face-register-modal';
        this.modal.className = 'fixed inset-0 bg-black/50 hidden items-center justify-center z-50 backdrop-blur-sm transition-opacity duration-300';
        
        this.modal.innerHTML = `
            <div class="bg-white rounded-xl w-full max-w-lg p-6 shadow-2xl relative transform transition-all scale-95 opacity-0 duration-300" id="face-modal-content">
                <button type="button" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 focus:outline-none" id="close-face-modal-x">
                    <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                
                <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">
                    <i class="fa fa-id-card-o text-primary mr-2"></i> Face Information Registration
                </h3>
                
                <div class="mb-4">
                    <label for="face-username" class="block text-sm font-medium text-gray-700 mb-1">Name</label>
                    <input type="text" id="face-username" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary sm:text-sm" placeholder="请输入您的姓名" required>
                </div>

                <div class="relative w-full aspect-video bg-gray-100 rounded-lg overflow-hidden mb-6 border-2 border-dashed border-gray-300 flex items-center justify-center group">
                    <video id="face-video" class="w-full h-full object-cover hidden" autoplay playsinline muted style="transform: scaleX(-1);"></video>
                    <canvas id="face-canvas" class="hidden"></canvas>
                    <div id="camera-placeholder" class="text-gray-400 flex flex-col items-center">
                        <i class="fa fa-camera text-4xl mb-2"></i>
                        <span>Waiting for camera to start...</span>
                    </div>
                     <!-- Face Guide Overlay -->
                    <div id="face-guide" class="absolute inset-0 border-4 border-blue-400/50 rounded-full w-48 h-64 m-auto hidden pointer-events-none shadow-[0_0_0_1000px_rgba(0,0,0,0.3)]"></div>
                    <div id="face-guide-text" class="absolute bottom-4 text-white text-sm font-medium bg-black/50 px-3 py-1 rounded-full hidden">Please align your face with the box</div>
                </div>
                
                <div class="flex justify-end gap-3">
                    <button id="close-face-modal" class="px-5 py-2.5 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors">
                        Cancel
                    </button>
                    <button id="capture-face-btn" class="px-5 py-2.5 bg-primary text-white hover:bg-blue-700 rounded-lg font-medium shadow-md transition-all flex items-center disabled:opacity-50 disabled:cursor-not-allowed">
                        <i class="fa fa-camera mr-2"></i> Capture and Register
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.modal);
        
        this.video = this.modal.querySelector('#face-video');
        this.canvas = this.modal.querySelector('#face-canvas');
        this.content = this.modal.querySelector('#face-modal-content');
        this.placeholder = this.modal.querySelector('#camera-placeholder');
        this.guide = this.modal.querySelector('#face-guide');
        this.guideText = this.modal.querySelector('#face-guide-text');
        
        this.bindEvents();
    }
    
    bindEvents() {
        const closeBtn = this.modal.querySelector('#close-face-modal');
        const closeX = this.modal.querySelector('#close-face-modal-x');
        const captureBtn = this.modal.querySelector('#capture-face-btn');

        const closeHandler = () => this.close();
        
        closeBtn.addEventListener('click', closeHandler);
        closeX.addEventListener('click', closeHandler);
        
        // Close on backdrop click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) closeHandler();
        });

        captureBtn.addEventListener('click', () => this.captureAndRegister());
    }

    async open() {
        this.isOpen = true;
        this.modal.classList.remove('hidden');
        this.modal.classList.add('flex');
        
        // Set default username
        const user = authService.getUser();
        const usernameInput = this.modal.querySelector('#face-username');
        if (user && usernameInput) {
            usernameInput.value = user.username || '';
        }

        // Trigger reflow
        void this.modal.offsetWidth;
        
        this.content.classList.remove('scale-95', 'opacity-0');
        this.content.classList.add('scale-100', 'opacity-100');

        await this.startCamera();
    }

    close() {
        this.content.classList.remove('scale-100', 'opacity-100');
        this.content.classList.add('scale-95', 'opacity-0');
        
        setTimeout(() => {
            this.modal.classList.add('hidden');
            this.modal.classList.remove('flex');
            this.stopCamera();
            this.isOpen = false;
        }, 300);
    }
    
    async startCamera() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    width: { ideal: 1280 }, 
                    height: { ideal: 720 },
                    facingMode: 'user'
                } 
            });
            this.video.srcObject = this.stream;
            // Wait for video only when metadata loaded
            this.video.onloadedmetadata = () => {
                this.video.play();
                this.video.classList.remove('hidden');
                this.placeholder.classList.add('hidden');
                this.guide.classList.remove('hidden');
                this.guideText.classList.remove('hidden');
            };
        } catch (err) {
            console.error("Camera access error:", err);
            
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                 alert("请允许浏览器访问您的摄像头以使用人脸录入功能。");
            } else {
                 alert("无法访问摄像头: " + err.message);
            }
            this.close();
        }
    }

    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        this.video.srcObject = null;
        this.video.classList.add('hidden');
        this.placeholder.classList.remove('hidden');
        this.guide.classList.add('hidden');
        this.guideText.classList.add('hidden');
    }

    async captureAndRegister() {
        if (!this.stream) return;

        const usernameInput = this.modal.querySelector('#face-username');
        const username = usernameInput ? usernameInput.value.trim() : '';

        if (!username) {
            alert('请输入用户名');
            if (usernameInput) usernameInput.focus();
            return;
        }
        
        const btn = this.modal.querySelector('#capture-face-btn');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<i class="fa fa-spinner fa-spin mr-2"></i> 处理中...`;

        try {
             // Draw current frame to canvas
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            const ctx = this.canvas.getContext('2d');
            
            // Mirror if facingMode is user (front camera usually mirrored in CSS, need to mirror canvas draw too?)
            // Usually local video is mirrored via CSS scaleX(-1), but canvas drawImage draws raw.
            // If user sees mirrored video, they align themselves mirrored.
            // The captured image should probably be normal? Or mirrored?
            // Let's assume raw capture is fine.
            ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            
            // Get Blob instead of dataUrl
            this.canvas.toBlob(async (blob) => {
                if (!blob) {
                    alert('图片生成失败');
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                    return;
                }

                try {
                    // Send to API
                    const res = await apiService.registerFace(username, blob);
                
                    // 兼容模拟数据的格式 (code/message) 或真实API (success)
                    if (res && (res.code === 200 || res.message?.includes('Successfully registered'))) {
                        alert('人脸录入成功！');
                        this.close();
                    } else {
                        alert('录入失败: ' + (typeof res.message === 'string' ? res.message : '系统错误'));
                    }
                } catch (apiError) {
                     console.error('API Error:', apiError);
                     alert('录入失败: ' + apiError.message);
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            }, 'image/jpeg', 0.85);
            
        } catch (error) {
            console.error('Capture failed', error);
            alert('录入过程中发生错误，请检查网络或重试。');
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}
