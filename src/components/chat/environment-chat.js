import apiService from '../../services/api.service.js';
import { marked } from 'marked';

export class EnvironmentChat {
    constructor() {
        this.isOpen = false;
        this.messages = [];
        this.container = null;
        this.chatBox = null;
        this.input = null;
        this.init();
    }

    init() {
        // 创建容器
        this.container = document.createElement('div');
        this.container.id = 'env-chat-container';
        this.container.className = 'fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4';

        // 渲染组件
        this.renderChatBox();
        this.renderFloatingButton();

        // 添加到页面
        document.body.appendChild(this.container);

        // 绑定事件
        this.bindEvents();
    }

    renderFloatingButton() {
        const btn = document.createElement('button');
        btn.id = 'env-chat-fab';
        // 使用 Tailwind 类：圆形悬浮按钮，带有图标
        btn.className = `
            w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg 
            flex items-center justify-center transition-transform hover:scale-105 active:scale-95
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
        `;
        btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
        `;
        btn.onclick = () => this.toggleChat();
        this.container.appendChild(btn);
    }

    renderChatBox() {
        this.chatBox = document.createElement('div');
        this.chatBox.id = 'env-chat-box';
        // 使用 hidden 类初始隐藏
        this.chatBox.className = `
            hidden w-[400px] h-[550px] bg-white rounded-lg shadow-xl flex flex-col overflow-hidden border border-gray-200
            transition-all duration-300 transform origin-bottom-right
        `;
        
        this.chatBox.innerHTML = `
            <!-- Header -->
            <div class="bg-blue-600 text-white p-4 flex justify-between items-center">
                <h3 class="font-semibold">环境检测</h3>
                <button id="close-chat" class="hover:text-blue-200 focus:outline-none">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>
            </div>
            
            <!-- Messages Area -->
            <div id="chat-messages" class="flex-1 p-4 overflow-y-auto bg-gray-50 space-y-3">
                <!-- Messages will be inserted here -->
            </div>
            
            <!-- Input Area -->
            <div class="p-3 border-t border-gray-200 bg-white">
                <form id="chat-form" class="flex gap-2">
                    <input type="text" id="chat-input" 
                        class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                        placeholder="输入消息..." autocomplete="off">
                    <button type="submit" 
                        class="bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm font-medium">
                        发送
                    </button>
                </form>
            </div>
        `;
        
        this.container.prepend(this.chatBox); // 注意：prepend 使得它在按钮上方（虽然是 absolute/fixed，但在 DOM 顺序上应该在前面以便布局）
    }

    bindEvents() {
        const closeBtn = this.chatBox.querySelector('#close-chat');
        closeBtn.onclick = () => this.toggleChat(false);

        const form = this.chatBox.querySelector('#chat-form');
        this.input = this.chatBox.querySelector('#chat-input');
        
        form.onsubmit = async (e) => {
            e.preventDefault();
            const text = this.input.value.trim();
            if (text) {
                this.sendMessage(text);
                this.input.value = '';
            }
        };
    }

    toggleChat(show) {
        const chatBox = this.container.querySelector('#env-chat-box');
        const input = this.container.querySelector('#chat-input');
        
        if (show === undefined) {
             this.isOpen = !this.isOpen;
        } else {
             this.isOpen = show;
        }

        if (this.isOpen) {
            chatBox.classList.remove('hidden');
            chatBox.classList.add('flex');
            input.focus();
            
            // 如果是第一次打开，触发环境检测
            if (this.messages.length === 0) {
                this.addMessage('正在进行环境检测...', 'system');
                this.triggerEnvironmentScan();
            }
        } else {
            chatBox.classList.add('hidden');
            chatBox.classList.remove('flex');
        }
    }

    async triggerEnvironmentScan() {
        // 防止重复触发
        if (this.isScanning) return;
        this.isScanning = true;
        
        const loadingId = this.addLoadingMessage();
        
        try {
            const response = await apiService.scanEnvironment();
            this.removeMessage(loadingId);
            
            // 优先使用 data 中的描述，其次是 message
            let reply = '检测完成，环境正常。';
            
            if (response.response) {
                reply = response.response;
            } else if (response.data && response.data.description) {
                reply = response.data.description;
            } else if (response.message) {
                reply = response.message;
            } else if (typeof response === 'string') {
                reply = response;
            }

            this.addMessage(reply, 'bot');

        } catch (error) {
            this.removeMessage(loadingId);
            console.error('Scan failed', error);
            this.addMessage('环境检测失败，请重试。', 'error');
        } finally {
            this.isScanning = false;
        }
    }

    async sendMessage(text) {
        if (!text) return;
        
        // 用户消息
        this.addMessage(text, 'user');
        
        // 显示正在输入...
        const loadingId = this.addLoadingMessage();
        
        try {
            const response = await apiService.sendChatMessage(text);
            this.removeMessage(loadingId);
            
            const reply = response.response || response.reply || response.message || "收到您的消息";
            this.addMessage(reply, 'bot');
        } catch (error) {
            this.removeMessage(loadingId);
            console.error('Msg failed', error);
            this.addMessage('发送失败，请稍后重试。', 'error');
        }
    }

    addMessage(text, type) {
        const msgList = this.container.querySelector('#chat-messages');
        const msgDiv = document.createElement('div');
        
        // 确保 msgList 有正确的类
        if (!msgList.classList.contains('flex')) {
             msgList.className = 'flex-1 p-4 overflow-y-auto bg-gray-50 flex flex-col gap-3';
        }

        // 根据类型设置样式
        let baseClass = "p-3 rounded-lg text-sm max-w-[85%] break-words shadow-sm animate-fade-in";
        if (type === 'user') {
            msgDiv.className = `${baseClass} self-end bg-blue-600 text-white rounded-br-none`;
        } else if (type === 'bot') {
            msgDiv.className = `${baseClass} self-start bg-white text-gray-800 rounded-bl-none border border-gray-200`;
        } else if (type === 'system') {
             msgDiv.className = "text-xs text-gray-400 text-center py-1 self-center w-full";
        } else if (type === 'error') {
             msgDiv.className = "text-xs text-red-500 text-center py-1 self-center w-full bg-red-50 rounded border border-red-100";
        }

        // 处理内容渲染
        if (type === 'bot') {
            try {
                // 使用 marked 解析 Markdown，并允许 HTML 标签（根据需要配置）
                msgDiv.innerHTML = marked.parse(text);
                // 为生成的 HTML 添加基础样式（特别是列表和链接）
                msgDiv.querySelectorAll('ul').forEach(ul => ul.classList.add('list-disc', 'pl-4', 'my-1'));
                msgDiv.querySelectorAll('ol').forEach(ol => ol.classList.add('list-decimal', 'pl-4', 'my-1'));
                msgDiv.querySelectorAll('p').forEach(p => p.classList.add('my-1'));
                msgDiv.querySelectorAll('a').forEach(a => a.classList.add('text-blue-600', 'underline'));
                msgDiv.querySelectorAll('pre').forEach(pre => pre.classList.add('bg-gray-100', 'p-2', 'rounded', 'overflow-x-auto', 'text-xs'));
                 msgDiv.querySelectorAll('code').forEach(code => code.classList.add('bg-gray-100', 'px-1', 'rounded', 'font-mono', 'text-xs'));
            } catch (e) {
                console.error("Markdown parse error:", e);
                msgDiv.innerHTML = text.replace(/\n/g, '<br>');
            }
        } else {
             // 其他类型保持简单文本处理，防止 XSS
             msgDiv.innerHTML = text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, '<br>');
        }

        msgList.appendChild(msgDiv);
        msgList.scrollTop = msgList.scrollHeight; // 滚动到底部
        
        this.messages.push({ text, type });
        return msgDiv;
    }

    addLoadingMessage() {
        const msgList = this.container.querySelector('#chat-messages');
        const msgDiv = document.createElement('div');
        const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        msgDiv.id = id;
        msgDiv.className = 'self-start bg-white border border-gray-200 p-3 rounded-lg rounded-bl-none text-gray-500 text-sm shadow-sm flex items-center gap-1';
        msgDiv.innerHTML = `
            <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
            <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-100"></span>
            <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-200"></span>
        `;
        msgList.appendChild(msgDiv);
        msgList.scrollTop = msgList.scrollHeight;
        return id;
    }

    removeMessage(id) {
        // 使用整个文档查询，以防 container 内部结构变化（虽然不应该）
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    destroy() {
        if (this.container) {
            this.container.remove();
        }
    }
}
