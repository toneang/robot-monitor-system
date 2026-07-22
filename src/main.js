import './assets/styles/main.css';
import { TaskForm } from './components/task-management/task-form.js';
import { TaskTimeline } from './components/task-management/task-timeline.js';
import { LoginForm } from './components/auth/login-form.js';
import { RatingModal } from './components/task-management/rating-modal.js';
import { EnvironmentChat } from './components/chat/environment-chat.js';
import { FaceRegistrationModal } from './components/auth/face-registration-modal.js';
import { KnowledgeGraphModal } from './components/admin/knowledge-graph-modal.js';
import { RobotProfileModal } from './components/common/robot-profile-modal.js';
import { EnvCheckModal } from './components/common/env-check-modal.js';
import { TaskConfirmModal } from './components/common/task-confirm-modal.js';
import { EnvMonitorService } from './services/env-monitor.service.js';
import { VideoStreamService } from './services/video.service.js';
import { TaskConfirmService } from './services/task-confirm.service.js';
import { OnlineStatusService } from './services/online-status.service.js';
import taskFormLockService from './services/task-form-lock.service.js';
import { authService } from './services/auth.service.js';
import apiService from './services/api.service.js';
import storageService from './services/storage.service.js';
import taskService from './services/task.service.js';
import eventBus from './core/event-bus.js';
import { API_CONFIG } from './config/api.config.js';
import { formatPercentage, formatSpeed, formatLatency } from './utils/formatter.js';
import { getDisplayTaskTypeLabel } from './utils/task-type.js';
import { getTaskModelLabel } from './utils/task-model.js';

/**
 * 机器人监控系统主应用
 */
class RobotMonitorApp {
  constructor() {
    this.taskForm = null;
    this.taskTimeline = null;
    this.loginForm = new LoginForm();
    this.videoStreams = []; // Changed from single stream to array
    this.statusUpdateInterval = null;
    this.selectedTaskId = null;
    this.isAppRunning = false;
    this.listenersSetup = false;
    this.taskSyncInFlight = false;
    this.taskFormLockInitialized = false;
    this.environmentChat = null;
    this.faceRegistrationModal = null;
    this.knowledgeGraphModal = null;
    this.robotProfileModal = null;
    this.envCheckModal = null;
    this.envMonitorService = null;
    this.taskConfirmModal = null;
    this.taskConfirmService = null;
    this.onlineStatusService = null;
  }
  
  /**
   * 初始化应用
   */
  async init() {
    console.log('Initializing Robot Monitor System...');
    
    // 初始化组件（绑定DOM）
    this.initComponents();
    
    // 设置认证逻辑
    this.setupAuth();
    
    // 检查初始状态
    if (authService.isAuthenticated()) {
        const user = authService.getUser();
        await this.startApp(user);
    } else {
        // 确保显示登录页
        this.stopApp();
    }
  }

  /**
   * 设置认证事件
   */
  setupAuth() {
     // 登出按钮
     const logoutBtn = document.getElementById('logoutBtn');
     if (logoutBtn) {
         logoutBtn.addEventListener('click', () => {
             authService.logout();
         });
     }

     // 认证事件监听
     eventBus.on('auth:login', async (user) => {
         await this.startApp(user);
     });

     eventBus.on('auth:logout', () => {
         this.stopApp();
     });
  }

  /**
   * 启动应用逻辑
   */
  async startApp(user) {
      if (this.isAppRunning) return;

      console.log(`Starting app for user: ${user.username} (${user.role})`);
      
      // 更新用户信息
      this.updateUserInfo(user);
      
      // 切换视图
      document.getElementById('login-view').classList.add('hidden');
      document.getElementById('app-view').classList.remove('hidden');

      const taskFormEl = document.getElementById('taskForm');
      if (taskFormEl) {
          const addTaskPanel = taskFormEl.closest('.card-shadow');
          if (addTaskPanel) {
             // 只有普通用户可以提交任务
            if (user.role === 'admin') {
                addTaskPanel.classList.add('hidden');
                
                // Show admin stats panel
                const statsPanel = document.getElementById('adminStatsPanel');
                if (statsPanel) statsPanel.classList.remove('hidden');
            } else {
                addTaskPanel.classList.remove('hidden');
                
                // Hide admin stats panel
                const statsPanel = document.getElementById('adminStatsPanel');
                if (statsPanel) statsPanel.classList.add('hidden');
            }
          }
      }

      // 启动服务
      this.initVideoStream();
      await taskFormLockService.refresh();
      this.startStatusPolling();
      taskService.startRepublishTimer();
      this.cleanupStaleLocalTasks();
      await this.loadTasks();
      
      // 设置全局监听器（仅一次）
      if (!this.listenersSetup) {
          this.setupEventListeners();
          this.listenersSetup = true;
      }
      
      // 初始化环境检测
      if (!this.environmentChat) {
        this.environmentChat = new EnvironmentChat();
      }
      if (this.envMonitorService) {
        this.envMonitorService.startPolling();
      }
      if (user.role === 'admin' && this.taskConfirmService) {
        this.taskConfirmService.startPolling();
      }
      if (this.onlineStatusService) {
        this.onlineStatusService.start();
      }

      this.isAppRunning = true;
  }

  /**
   * 停止应用逻辑
   */
  stopApp() {
      console.log('Stopping app...');

      if (this.envMonitorService) {
        this.envMonitorService.stopPolling();
      }
      if (this.taskConfirmService) {
        this.taskConfirmService.stopPolling();
      }
      if (this.onlineStatusService) {
        this.onlineStatusService.stop();
      }
      this.updateOnlineUsersUI({ count: 0, users: [] });

      if (this.environmentChat) {
          this.environmentChat.destroy();
          this.environmentChat = null;
      }
      
      // Stop all video streams
      if (this.videoStreams) {
          this.videoStreams.forEach(stream => stream && stream.stop());
          this.videoStreams = [];
      }
      
      if (this.statusUpdateInterval) {
          clearInterval(this.statusUpdateInterval);
          this.statusUpdateInterval = null;
      }
      taskService.stopRepublishTimer();

      // 切换视图
      const appView = document.getElementById('app-view');
      const loginView = document.getElementById('login-view');
      
      if (appView) appView.classList.add('hidden');
      if (loginView) loginView.classList.remove('hidden');
      
      // 重置表单
      const loginForm = document.getElementById('loginForm');
      if (loginForm) loginForm.reset();

      this.isAppRunning = false;
  }

  /**
   * 更新顶部用户信息
   */
  updateUserInfo(user) {
      const nameEl = document.getElementById('headerUsername');
      const roleEl = document.getElementById('headerRole');
      const graphBtn = document.getElementById('knowledgeGraphBtn');
      const teleopBtn = document.getElementById('teleopBtn');
      if (nameEl) nameEl.textContent = user.username;

      if (roleEl) {
          // 显示身份字段，如果不存在则显示role
          const identityMap = {
              'student': 'Student',
              'teacher': 'Teacher',
              'administrative_staff': 'Administrative Staff',
              'admin': 'Administrative Staff',  // 修改：admin显示为Administrative Staff
              'user': 'User'
          };

          // 优先显示identity字段，如果没有则显示role
          let displayIdentity;
          if (user.identity && identityMap[user.identity]) {
              displayIdentity = identityMap[user.identity];
          } else if (user.role && identityMap[user.role]) {
              displayIdentity = identityMap[user.role];
          } else {
              displayIdentity = 'User';
          }

          console.log('User info display:', {
              username: user.username,
              role: user.role,
              identity: user.identity,
              displayIdentity: displayIdentity
          });

          roleEl.textContent = displayIdentity;

          // 设置样式
          if (user.role === 'admin' || user.identity === 'administrative_staff') {
              roleEl.className = 'text-xs text-primary font-bold';
              if (graphBtn) graphBtn.classList.remove('hidden');
              if (teleopBtn) teleopBtn.classList.remove('hidden');
          } else {
              roleEl.className = 'text-xs text-gray-500';
              if (graphBtn) graphBtn.classList.add('hidden');
              if (teleopBtn) teleopBtn.classList.add('hidden');
          }
      }
  }

  updateOnlineUsersUI(presence = {}) {
      const card = document.getElementById('onlineUsersCard');
      const countEl = document.getElementById('onlineUsersCount');
      const listEl = document.getElementById('onlineUsersList');
      const users = Array.isArray(presence.users) ? presence.users : [];
      const usernames = users.map((user) => user.username).filter(Boolean);
      const count = Number.isFinite(Number(presence.count)) ? Number(presence.count) : usernames.length;
      const tooltipText = usernames.length
        ? users.map((user) => {
            const extra = user.identity || user.role;
            return extra ? `${user.username} (${extra})` : user.username;
          }).join(', ')
        : 'No active users';

      if (countEl) {
          countEl.textContent = `${count} Online`;
      }

      if (listEl) {
          listEl.textContent = usernames.length ? usernames.join(', ') : 'No active users';
          listEl.title = tooltipText;
      }

      if (card) {
          card.classList.toggle('border-success', count > 0);
          card.classList.toggle('border-gray-300', count === 0);
      }
  }
  
  /**
   * 初始化组件
   */
  initComponents() {
    // 初始化任务表单
    const formElement = document.getElementById('taskForm');
    if (formElement) {
      this.taskForm = new TaskForm(formElement);
      console.log('Task form initialized');
    }
    
    // 初始化任务时间轴
    const timelineElement = document.getElementById('taskTimeline');
    if (timelineElement) {
      this.taskTimeline = new TaskTimeline(timelineElement, {
        bindFilters: true,
        variant: 'timeline',
        emptyMessage: 'No tasks available'
      });
      console.log('Task timeline initialized');
    }

    // 初始化评分弹窗

    // 初始化人脸录入模态框
    this.faceRegistrationModal = new FaceRegistrationModal();
    const faceBtn = document.getElementById('faceRegisterBtn');
    if (faceBtn) {
        faceBtn.addEventListener('click', () => {
             this.faceRegistrationModal.open();
        });
    }
    const teleopBtn = document.getElementById('teleopBtn');
    if (teleopBtn) {
        teleopBtn.addEventListener('click', () => {
             window.open('/teleop.html', '_blank', 'noopener,noreferrer');
        });
    }
    // Initialize Knowledge Graph Modal
    this.knowledgeGraphModal = new KnowledgeGraphModal();
    const graphBtn = document.getElementById('knowledgeGraphBtn');
    if (graphBtn) {
        graphBtn.addEventListener('click', () => {
              this.knowledgeGraphModal.open();
        });
    }

    // Initialize Robot Profile Modal
    // 初始化机器人画像模态框
    this.robotProfileModal = new RobotProfileModal();
    const robotProfileBtn = document.getElementById('robotProfileBtn');
    if (robotProfileBtn) {
        robotProfileBtn.addEventListener('click', () => {
             // 默认打开office_robot的画像
             this.robotProfileModal.open('office_robot');
        });
    }

    this.ratingModal = new RatingModal();

    // 初始化环境检查模态框
    this.envCheckModal = new EnvCheckModal();
    this.envMonitorService = new EnvMonitorService(this.envCheckModal);
    this.envMonitorService.setOnConfirmedCallback(() => {
      // 环境检查确认后，弹出等待中的评分问卷
      this._showPendingRatings();
    });
    this.taskConfirmModal = new TaskConfirmModal();
    this.taskConfirmService = new TaskConfirmService(this.taskConfirmModal, (message, type) => {
      this.showToast(message, type);
    });
    this.onlineStatusService = new OnlineStatusService();
    this._pendingRatingTaskIds = new Set(); // 等待环境检查确认后再弹评分的任务
    this.setupTaskFormLockControls();
  }
  
  /**
   * 初始化视频流
   */
  initVideoStream() {
    const user = authService.getUser();
    
    // 1. Realsense and Navigation moved between containers
    const rgbCameraImg = document.getElementById('rgb-camera');
    const cameraPlaceholder = document.getElementById('camera-placeholder');
    const realsenseWrapper = document.getElementById('realsenseWrapper');
    
    const navImg = document.getElementById('nav-camera');
    const navPlaceholder = document.getElementById('nav-placeholder');
    const navWrapper = document.getElementById('navWrapper');

    // Layout Containers
    const leftVideoPanel = document.getElementById('leftVideoPanel');
    const adminVideoPanel = document.getElementById('adminVideoPanel');
    
    // Slots
    const userRealsenseSlot = document.getElementById('userRealsenseSlot');
    const userNavSlot = document.getElementById('userNavSlot');
    const adminRealsenseSlot = document.getElementById('adminRealsenseSlot');
    const adminNavSlot = document.getElementById('adminNavSlot');

    // Role-based Layout Logic - Move DOM first, then start streams
    if (user && user.role === 'admin') {
         // Show admin panel, hide left panel video section
         if (adminVideoPanel) adminVideoPanel.classList.remove('hidden');
         if (leftVideoPanel) leftVideoPanel.classList.add('hidden');

         // Show admin-only buttons
         const knowledgeGraphBtn = document.getElementById('knowledgeGraphBtn');
         if (knowledgeGraphBtn) knowledgeGraphBtn.classList.remove('hidden');
         // Show robotProfileBtn for all users
         const robotProfileBtn = document.getElementById('robotProfileBtn');
         if (robotProfileBtn) robotProfileBtn.classList.remove('hidden');

         const slotMain = document.getElementById('slot-main');
         const slotSide1 = document.getElementById('slot-side-1');
         const slotSide2 = document.getElementById('slot-side-2');

         const wrapperRealsense = document.getElementById('realsenseWrapper');
         const wrapperNav = document.getElementById('navWrapper');
         const wrapperGripper = document.getElementById('gripperWrapper');

         // Helper function to update layout
         const updateLayout = () => {
             wrapperRealsense.style.cursor = 'pointer';
             wrapperNav.style.cursor = 'pointer';
             wrapperGripper.style.cursor = 'pointer';

             if (slotMain.firstElementChild === wrapperRealsense) {
                 wrapperRealsense.style.cursor = 'crosshair';
                 wrapperRealsense.title = 'Click to grasp';
             } else {
                 wrapperRealsense.removeAttribute('title');
             }
         };

         // Swap Logic
         const swapVideo = (targetWrapper) => {
             const currentMain = slotMain.firstElementChild;
             if (currentMain === targetWrapper) return;

             const targetParent = targetWrapper.parentElement;
             targetParent.appendChild(currentMain);
             slotMain.appendChild(targetWrapper);

             updateLayout();
         };

         // Bind Events
         if (wrapperRealsense) wrapperRealsense.onclick = () => swapVideo(wrapperRealsense);
         if (wrapperNav) wrapperNav.onclick = () => swapVideo(wrapperNav);
         if (wrapperGripper) wrapperGripper.onclick = () => swapVideo(wrapperGripper);

         // Move wrappers to slots FIRST (before starting streams)
         if (slotMain && wrapperRealsense) slotMain.appendChild(wrapperRealsense);
         if (slotSide1 && wrapperNav) slotSide1.appendChild(wrapperNav);
         if (slotSide2 && wrapperGripper) slotSide2.appendChild(wrapperGripper);

         updateLayout();

         // NOW start streams after wrappers are in visible slots
         // Init Realsense
         if (rgbCameraImg && cameraPlaceholder) {
           const realsenseStream = new VideoStreamService(
             API_CONFIG.endpoints.realsenseCamera,
             rgbCameraImg,
             cameraPlaceholder
           );
           realsenseStream.start();
           this.videoStreams.push(realsenseStream);
           this.setupGraspControl(rgbCameraImg);
         }

         // Init Navigation
         if (navImg && navPlaceholder) {
             const navStream = new VideoStreamService(
                 API_CONFIG.endpoints.camera,
                 navImg,
                 navPlaceholder
             );
             navStream.start();
             this.videoStreams.push(navStream);
         }

         // Init Gripper
         const gripperImg = document.getElementById('gripper-camera');
         const gripperPlaceholder = document.getElementById('gripper-placeholder');
         if (gripperImg && gripperPlaceholder) {
             const gripperStream = new VideoStreamService(
                API_CONFIG.endpoints.gripperCamera,
                gripperImg,
                gripperPlaceholder
            );
            gripperStream.start();
            this.videoStreams.push(gripperStream);
         }

     } else {
        // User Role
        // Show left panel logic, hide admin panel
        if (leftVideoPanel) leftVideoPanel.classList.remove('hidden');
        if (adminVideoPanel) adminVideoPanel.classList.add('hidden');

        // Hide admin-only buttons
        const knowledgeGraphBtn = document.getElementById('knowledgeGraphBtn');
        if (knowledgeGraphBtn) knowledgeGraphBtn.classList.add('hidden');

        // Move Realsense to User Slot first
        if (userRealsenseSlot && realsenseWrapper) {
            userRealsenseSlot.appendChild(realsenseWrapper);
            realsenseWrapper.style.cursor = 'default';
            realsenseWrapper.onclick = null;
        }

        // Start Realsense stream after DOM placement
        if (rgbCameraImg && cameraPlaceholder) {
            const realsenseStream = new VideoStreamService(
                API_CONFIG.endpoints.realsenseCamera,
                rgbCameraImg,
                cameraPlaceholder
            );
            realsenseStream.start();
            this.videoStreams.push(realsenseStream);
        }
    }
    //else {
    //     // User Role
    //     // Show left panel logic, hide admin panel
    //     if (leftVideoPanel) leftVideoPanel.classList.remove('hidden');
    //     if (adminVideoPanel) adminVideoPanel.classList.add('hidden');

    //     // Hide admin-only buttons
    //     const knowledgeGraphBtn = document.getElementById('knowledgeGraphBtn');
    //     if (knowledgeGraphBtn) knowledgeGraphBtn.classList.add('hidden');
    //     // Note: robotProfileBtn should be visible for all users


    //}
  }
  
  /**
   * 更新管理员统计面板
   */
  updateAdminStats(tasks) {
    const statsPanel = document.getElementById('adminStatsPanel');
    if (!statsPanel || statsPanel.classList.contains('hidden')) return;

    // 1. Pending Count
    const pendingCount = tasks.filter(t => t.status === 'pending').length;
    document.getElementById('statPendingCount').textContent = pendingCount;

    // 2. Success Rate (Finished / (Finished + Failed))
    // 包含所有视为“成功完成”的状态
    const finishedCount = tasks.filter(t => ['completed', 'finish', 'finished', 'success'].includes((t.status || '').toLowerCase())).length;
    // 包含所有视为“失败”的状态
    const failedCount = tasks.filter(t => ['failed', 'fail'].includes((t.status || '').toLowerCase())).length;
    const totalFinishedFailed = finishedCount + failedCount;
    // 防止除以零
    const successRate = totalFinishedFailed > 0 ? Math.round((finishedCount / totalFinishedFailed) * 100) : 0;
    
    document.getElementById('statSuccessRate').textContent = `${successRate}%`;
    document.getElementById('statSuccessRateDetail').textContent = `(${finishedCount}/${totalFinishedFailed})`;

    // 3. Today's Progress (今日完成数 / 今日总任务)
    const today = new Date().toDateString(); // 使用本地日期字符串比较 'Fri Jan 09 2026'
    
    // 过滤出今天的任务
    const todayTasks = tasks.filter(t => {
        const dStr = t.create_time || t.timestamp;
        if (!dStr) return false;
        try {
            // 尝试解析各种格式
            const d = new Date(dStr);
            return d.toDateString() === today;
        } catch(e) { return false; }
    });
    
    const todayTotal = todayTasks.length;
    // 今日完成数 (包括成功和失败的终态任务)
    const todayProcessed = todayTasks.filter(t => 
        ['completed', 'finish', 'finished', 'success', 'failed', 'fail'].includes((t.status || '').toLowerCase())
    ).length;
    const todayPercent = todayTotal > 0 ? Math.round((todayProcessed / todayTotal) * 100) : 0;

    document.getElementById('statTodayProgress').textContent = `${todayProcessed}/${todayTotal}`;
    document.getElementById('statTodayPercent').textContent = `${todayPercent}%`;

    // 4. Status Breakdown
    const statusCounts = {};
    const statusAliases = {
        finish: 'completed',
        finished: 'completed'
    };
    tasks.forEach(t => {
        const rawStatus = (t.status || 'unknown').toLowerCase();
        const normalizedStatus = statusAliases[rawStatus] || rawStatus;
        statusCounts[normalizedStatus] = (statusCounts[normalizedStatus] || 0) + 1;
    });

    const breakdownContainer = document.getElementById('statStatusBreakdown');
    if (breakdownContainer) {
        breakdownContainer.innerHTML = '';
        Object.keys(statusCounts).forEach(status => {
            const count = statusCounts[status];
            const badge = document.createElement('div');

            let colorClass = 'bg-gray-100 text-gray-600';
            if (['executing', 'running', 'processing'].includes(status)) colorClass = 'bg-blue-100 text-blue-800';
            if (['completed', 'finish', 'finished', 'success'].includes(status)) colorClass = 'bg-green-100 text-green-800';
            if (['failed', 'fail'].includes(status)) colorClass = 'bg-red-100 text-red-800';
            if (['pending'].includes(status)) colorClass = 'bg-yellow-100 text-yellow-800';
            if (['paused'].includes(status)) colorClass = 'bg-orange-100 text-orange-800';

            badge.className = `px-2 py-1 rounded text-xs font-bold ${colorClass} flex items-center border border-current border-opacity-10`;
            badge.innerHTML = `<span class="capitalize mr-2">${status}</span> <span class="bg-white bg-opacity-60 px-1.5 rounded-full text-[10px] min-w-[16px] text-center">${count}</span>`;
            breakdownContainer.appendChild(badge);
        });
    }
  }

  setupTaskFormLockControls() {
    if (this.taskFormLockInitialized) return;
    this.taskFormLockInitialized = true;

    taskFormLockService.start();
    taskFormLockService.onChange((state) => {
      this.updateTaskFormLockUI(state);
    });

    const toggle = document.getElementById('taskFormLockToggle');
    if (toggle) {
      toggle.addEventListener('change', async () => {
        const user = authService.getUser();
        if (!user || user.role !== 'admin') {
          this.updateTaskFormLockUI(taskFormLockService.getState());
          return;
        }

        try {
          const state = await taskFormLockService.setState(toggle.checked, user.username);
          this.updateTaskFormLockUI(state);
        } catch (error) {
          console.warn('Failed to update task form lock state:', error);
          this.updateTaskFormLockUI(taskFormLockService.getState());
          this.showToast('Failed to update task form lock', 'error');
        }
      });
    }

    this.updateTaskFormLockUI(taskFormLockService.getState());
  }

  updateTaskFormLockUI(state = taskFormLockService.getState()) {
    const toggle = document.getElementById('taskFormLockToggle');
    const status = document.getElementById('taskFormLockStatus');
    const meta = document.getElementById('taskFormLockMeta');

    if (toggle) {
      toggle.checked = !!state.enabled;
    }

    if (status) {
      status.textContent = state.enabled ? 'On' : 'Off';
      status.className = state.enabled
        ? 'text-xs font-bold uppercase tracking-wide text-amber-700'
        : 'text-xs font-bold uppercase tracking-wide text-gray-500';
    }

    if (meta) {
      meta.textContent = state.updatedAt
        ? `Last updated by ${state.updatedBy || 'admin'} at ${new Date(state.updatedAt).toLocaleString()}`
        : 'Default: locked';
    }
  }

  /**
   * 设置抓取控制
   */
  setupGraspControl(imgElement) {
    // 防止重复绑定 (Use a cleaner way to track listeners or ensure single binding)
    // Note: With element swapping, the parent element might change, but the event listener is on the 'container' which is fixed initially.
    // However, in our new logic, valid click is determined by location.
    
    // We bind to the specific Realsense wrapper element which is passed here as parent of img
    const wrapper = document.getElementById('realsenseWrapper');
    if (!wrapper || wrapper._graspListenerAttached) return;

    // Unified handler: left-click = 抓取, right-click(contextmenu) = 放置
    const handleGraspClick = async (e, isGrasp) => {
      // 权限检查：仅管理员可操作
      const user = authService.getUser();
      if (!user || user.role !== 'admin') return;

      // New Condition: Only trigger Grasp if this wrapper is in the MAIN slot
      const slotMain = document.getElementById('slot-main');
      if (wrapper.parentElement !== slotMain) {
           console.log('Ignored grasp click - Video not in main view');
           return;
      }

      // Stop propagation to prevent swapping if we are grasping
      e.stopPropagation();

      if (imgElement.style.display === 'none') return;

      const rect = imgElement.getBoundingClientRect();
      const containerX = e.clientX - rect.left;
      const containerY = e.clientY - rect.top;

      const naturalWidth = imgElement.naturalWidth || rect.width;
      const naturalHeight = imgElement.naturalHeight || rect.height;
      const ratioW = rect.width / naturalWidth;
      const ratioH = rect.height / naturalHeight;
      const scale = Math.min(ratioW, ratioH);
      const displayedWidth = naturalWidth * scale;
      const displayedHeight = naturalHeight * scale;
      const offsetX = (rect.width - displayedWidth) / 2;
      const offsetY = (rect.height - displayedHeight) / 2;

      const imageX = containerX - offsetX;
      const imageY = containerY - offsetY;

      if (imageX >= 0 && imageX <= displayedWidth && imageY >= 0 && imageY <= displayedHeight) {
        const normX = imageX / displayedWidth;
        const normY = imageY / displayedHeight;

        const executingTask = Array.from(document.querySelectorAll('.task-item')).find(taskItem =>
          taskService.isCurrentTaskStatus(taskItem?.dataset?.taskStatus)
          && ['executing', 'running', 'processing'].includes(taskService.normalizeStatus(taskItem?.dataset?.taskStatus))
        );

        const opLabel = isGrasp ? 'pick' : 'place';
        let confirmMsg = `Are you sure you want to ${opLabel} at this position?`;
        if (executingTask) {
          confirmMsg += '\n\nWarning: There is a task currently executing. Continuing will terminate the current task.';
        }
        if (!confirm(confirmMsg)) return;

        if (executingTask) {
          const taskId = executingTask.dataset.taskId;
          console.log(`Terminating executing task ${taskId} before grasp/place...`);
          try {
            await apiService.controlTask(taskId, 'terminate');
            eventBus.emit('task:status-update', { taskId, status: 'failed' });
          } catch (err) {
            console.error('Failed to terminate task', err);
          }
        }

        console.log(`Click coordinates (normalized): (${normX.toFixed(4)}, ${normY.toFixed(4)})`);

        try {
          await apiService.executeGrasp(normX, normY, isGrasp);
          this.showToast(`${opLabel} command sent`, 'success');
        } catch (error) {
          this.showToast(`${opLabel} failed: ${error.message || error}`, 'error');
        }

        this.createRipple(containerX, containerY, wrapper);
      }
    };

    // 左键：抓取
    wrapper.addEventListener('click', (e) => handleGraspClick(e, true));
    // 右键：放置（阻止默认的上下文菜单）
    wrapper.addEventListener('contextmenu', (e) => { e.preventDefault(); handleGraspClick(e, false); });

    wrapper._graspListenerAttached = true;
  }

  /**
   * Start periodic status polling
   */
  startStatusPolling() {
      if (this.statusUpdateInterval) return;

      // Initial update
      this.updateAllStatus();

      // Start interval
      this.statusUpdateInterval = setInterval(() => {
          this.updateAllStatus();
      }, API_CONFIG.polling.statusInterval);
  }

  /**  {"battery_percentage":0.0,"battery_voltage":0.0,"cpu_usage":50.7,"current_position":{"x":-1.6812114850662242e-05,"y":-1.237267837052605e-09,"yaw":2.3321449849859904e-05},"current_velocity":{"angular":0.0,"linear":0.0},"daily_distance":0.0004226176948725305,"joint_states":{"joint_arm":{"effort":0.0,"position":0.0,"velocity":0.0},"joint_base_x":{"effort":0.0,"position":0.0,"velocity":0.0},"joint_gripper":{"effort":0.0,"position":-0.0,"velocity":-0.0},"joint_head_pan":{"effort":-0.08382229673093043,"position":-0.0030679615757712823,"velocity":0.0},"joint_head_tilt":{"effort":-0.9281875915974598,"position":-0.6734175658817965,"velocity":-0.0},"joint_lift":{"effort":0.0,"position":0.0,"velocity":0.0},"joint_wrist_pitch":{"effort":4.39623047631315e-45,"position":0.10285404151068855,"velocity":0.00021916390767116555},"joint_wrist_roll":{"effort":27.272787655101098,"position":0.556818404185001,"velocity":0.00047058534179238257},"joint_wrist_yaw":{"effort":0.0,"position":0.00041221474739484116,"velocity":0.0}},"last_update":1767939450.8045251,"memory_usage":47.9,"network_latency":54.723262786865234,"timestamp":"2026-01-09T14:18:05.916949"}
   * Create visual ripple effect
   */
  createRipple(x, y, container) {
      const ripple = document.createElement('div');
      // Tailwind animate-ping for simple ripple
      ripple.className = 'absolute rounded-full bg-white/50 animate-ping pointer-events-none';
      ripple.style.left = (x - 10) + 'px'; // Center it
      ripple.style.top = (y - 10) + 'px';
      ripple.style.width = '20px';
      ripple.style.height = '20px';
      
      container.appendChild(ripple);
      
      setTimeout(() => {
          if (ripple.parentElement) ripple.remove();
      }, 1000);
  }

  async updateAllStatus() {
    try {
      const tasks = await this.syncTasksFromServer();
      await this.updateGlobalTaskStatus(Array.isArray(tasks) ? tasks : null);

      // Use single call to get full status
      const data = await apiService.getFullStatus();
      if (!data) return;
      
      // Update existing UI components
      if (data.battery_percentage !== undefined) {
         this.updateBatteryUI({ percentage: data.battery_percentage });
      }
      
      if (data.current_velocity) {
          this.updateVelocityUI(data.current_velocity);
      }
      
      if (data.cpu_usage !== undefined) {
          this.updateCpuUI({ cpu_usage: data.cpu_usage });
      }
      
      if (data.network_latency !== undefined) {
          this.updateLatencyUI({ latency: data.network_latency });
      }

      // Update new fields
      if (data.memory_usage !== undefined) this.updateMemoryUI(data.memory_usage);
      if (data.current_position) this.updatePositionUI(data.current_position);
      if (data.daily_distance !== undefined) this.updateDistanceUI(data.daily_distance);
      if (data.joint_states) this.updateJointsUI(data.joint_states);

    } catch (error) {
      console.warn('Status update failed:', error);
    }
  }

  async updateGlobalTaskStatus(tasks = null) {
      try {
          const currentTasks = Array.isArray(tasks)
            ? tasks.filter(task => ['executing', 'running', 'processing'].includes(String(task?.status || '').toLowerCase()))
            : await taskService.getCurrentTasks();
          // Filter for active tasks
          const runningTask = currentTasks.find(t => ['executing', 'running', 'processing'].includes(String(t.status || '').toLowerCase()));
          
          const statusText = document.getElementById('globalStatusText');
          const statusCard = document.getElementById('globalStatusCard');
          const statusIcon = document.getElementById('globalStatusIcon');
          if (!statusText || !statusCard || !statusIcon) return;

          if (runningTask) {
              const currentUser = authService.getUser();
              const isCreator = currentUser && runningTask.creator === currentUser.username;
              const isAdmin = currentUser && currentUser.role === 'admin';
              
              statusCard.classList.remove('border-gray-300');
              statusCard.classList.add('border-success');
              statusIcon.className = 'fa fa-bolt text-success';
              
              if (isCreator || isAdmin) {
                   // const taskType = runningTask.type || 'Task';
                   const taskType = getDisplayTaskTypeLabel(runningTask) || 'Task';
                   statusText.textContent = `Working (${taskType})`;
              } else {
                   statusText.textContent = 'Device Occupied';
              }
          } else {
              statusText.textContent = 'Idle (No Task)';
              statusCard.classList.remove('border-success');
              statusCard.classList.add('border-gray-300');
              statusIcon.className = 'fa fa-coffee text-gray-400';
          }
      } catch (e) {
          console.warn('Failed to update global task status', e);
      }
  }
  
  updateBatteryUI(data) {
    const levelEl = document.getElementById('batteryLevel');
    if (levelEl) {
      levelEl.textContent = formatPercentage(data.percentage, 0);
    }
  }
  
  updateVelocityUI(data) {
    const linearEl = document.getElementById('currentSpeed');
    const angularEl = document.getElementById('angularSpeed');
    
    if (linearEl) linearEl.textContent = formatSpeed(data.linear);
    if (angularEl) angularEl.textContent = `${data.angular.toFixed(2)} rad/s`;
  }
  
  updateMemoryUI(usage) {
      const el = document.getElementById('memoryUsage');
      if (el) el.textContent = formatPercentage(usage, 1);
  }

  updatePositionUI(pos) {
      const el = document.getElementById('robotPosition');
      if (el) {
          el.textContent = `X:${pos.x.toFixed(2)}, Y:${pos.y.toFixed(2)}`;
          el.title = `Yaw: ${pos.yaw.toFixed(4)}`;
      }
  }

  updateDistanceUI(dist) {
      const el = document.getElementById('distance');
      if (el) el.textContent = `${dist.toFixed(2)} m`;
  }

  updateJointsUI(joints) {
      const container = document.getElementById('jointStatesContainer');
      if (!container) return;
      
      container.innerHTML = '';
      
      Object.entries(joints).forEach(([name, state]) => {
          // Clean name: joint_head_pan -> Head Pan
          const cleanName = name.replace('joint_', '').replace(/_/g, ' ');
          // Capitalize
          const label = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
          
          const div = document.createElement('div');
          div.className = 'p-2 bg-gray-50 rounded border border-gray-100';
          div.innerHTML = `
            <p class="text-[10px] text-gray-500 uppercase font-semibold truncate" title="${name}">${label}</p>
            <div class="flex justify-between items-end mt-1">
                <span class="text-xs font-mono font-medium">${state.position.toFixed(2)}</span>
                <span class="text-[10px] text-gray-400">rad</span>
            </div>
          `;
          container.appendChild(div);
      });
  }
  
  updateCpuUI(data) {
    const cpuEl = document.getElementById('cpuUsage');
    if (cpuEl) {
      cpuEl.textContent = formatPercentage(data.cpu_usage, 1);
    }
  }
  
  updateLatencyUI(data) {
    const el = document.getElementById('networkLatency');
    if (el) {
      el.textContent = formatLatency(data.latency);
      if (data.latency === -1) {
        el.classList.add('text-red-500');
      } else {
        el.classList.remove('text-red-500');
      }
    }
  }
  
  /**
   * 清理本地缓存中过期的 submitting 任务
   */
  cleanupStaleLocalTasks() {
    // 清理过期的 submitting 任务（localStorage 中残留的旧缓存）
    const localTasks = storageService.getTasks() || [];
    const now = Date.now();
    const maxAgeMs = 60 * 1000; // 1 分钟
    const validTasks = localTasks.filter(task => {
      if (!taskService.isSubmitState(task?.status)) return true;
      try {
        const createdTime = new Date(task.create_time || task.timestamp || 0).getTime();
        return (now - createdTime) < maxAgeMs;
      } catch {
        return false;
      }
    });
    if (validTasks.length < localTasks.length) {
      storageService.saveTasks(validTasks);
      console.log(`Cleaned up ${localTasks.length - validTasks.length} stale local submitting task(s)`);
    }
  }

  /**
   * 加载任务列表
   */
  async loadTasks() {
    await this.syncTasksFromServer();
  }

  async syncTasksFromServer() {
    if (this.taskSyncInFlight) {
      return null;
    }

    this.taskSyncInFlight = true;
    const previouslySelectedTaskId = this.selectedTaskId;

    try {
      const tasks = await taskService.getAllTasks({ includeLocalInFlight: false });
      taskService.reconcilePolling(tasks);

      if (this.taskTimeline) {
        this.taskTimeline.render(tasks);
      }

      this.updateAdminStats(tasks);
      this.updateUnratedTasksPanel(tasks);
      await this.restoreSelectedTask(previouslySelectedTaskId);
      console.log(`Synced ${tasks.length} tasks from server`);
      return tasks;
    } catch (error) {
      console.error('Failed to sync tasks:', error);
      return null;
    } finally {
      this.taskSyncInFlight = false;
    }
  }

  async restoreSelectedTask(taskId) {
    if (!taskId) {
      return;
    }

    const taskItem = document.querySelector(`.task-item[data-task-id="${taskId}"]`);
    if (!taskItem) {
      this.selectedTaskId = null;
      this.hideTaskDetail();
      return;
    }

    const taskCard = taskItem.querySelector('.task-card');
    if (taskCard) {
      taskCard.classList.add('active');
    }

    this.selectedTaskId = taskId;
    await this.renderTaskDetail(taskItem);
  }
  
  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    // 任务选择事件
    eventBus.on('task:selected', ({ taskId, taskItem }) => {
      this.selectedTaskId = taskId;
      this.renderTaskDetail(taskItem);
    });
    
    // 任务取消选择事件
    eventBus.on('task:deselected', () => {
      this.selectedTaskId = null;
      this.hideTaskDetail();
    });

    eventBus.on('presence:update', (payload) => {
      this.updateOnlineUsersUI(payload);
    });

    eventBus.on('task:republished', ({ count }) => {
      if (!count) return;
      const message = count === 1
        ? 'A previous submission failed. Your task is being resent now.'
        : `Previous submissions failed. ${count} of your tasks are being resent now.`;
      this.showToast(message, 'info');
    });

    // 监听任务状态更新，处理评分弹窗
    eventBus.on('task:status-update', async ({ taskId, status, message }) => {
        const currentUser = authService.getUser();
        const normalizedStatus = String(status || '').toLowerCase().trim();
        const isTerminalStatus = taskService.isTerminalStatus(normalizedStatus);

        if (currentUser && currentUser.role === 'admin') {
             const updatedTasks = taskService._taskListCache || [];
             this.updateAdminStats(updatedTasks);
        }

        if (isTerminalStatus) {
            const task = taskService.getCachedTask(taskId) || {};
            const currentUser = authService.getUser();

            // 如果是当前用户创建的任务，且未评价，放入等待队列
            const hasValidRating = task?.rating && typeof task.rating === 'object' && Object.keys(task.rating).length > 0;
            if (task && currentUser && task.creator === currentUser.username && !hasValidRating) {
                this._pendingRatingTaskIds.add(taskId);
                // 延迟检查：如果环境检查弹窗存在，等它确认后再弹评分
                setTimeout(() => {
                    if (!this._pendingRatingTaskIds.has(taskId)) return;
                    const envModal = document.getElementById('envCheckModal');
                    const isEnvCheckVisible = envModal && !envModal.classList.contains('hidden');
                    if (!isEnvCheckVisible) {
                        this._pendingRatingTaskIds.delete(taskId);
                        if (this.ratingModal) {
                            this.ratingModal.open(taskId);
                        }
                    }
                    // 如果环境检查弹窗正在显示，等 onConfirmedCallback 触发 _showPendingRatings
                }, 1500);
            }
        }

        // 如果当前详情页正在显示该任务，只做轻量更新；终态再完整刷新
        if (this.selectedTaskId === taskId) {
           const taskItem = document.querySelector(`.task-item[data-task-id="${taskId}"]`);
           if (taskItem) {
               if (isTerminalStatus) {
                   await this.renderTaskDetail(taskItem);
               } else {
                   this.updateSelectedTaskDetail(taskId, taskItem, { status, message });
               }
           }
        }
    });

    // 监听评价提交，刷新任务数据
    eventBus.on('task:rated', async () => {
        await this.loadTasks();
        // 如果当前选中了任务，刷新详情
        if (this.selectedTaskId) {
           const taskItem = document.querySelector(`.task-item[data-task-id="${this.selectedTaskId}"]`);
           if (taskItem) {
               // 需要重新 apply selection style 因为 loadTasks 重绘了 timeline
               taskItem.classList.add('active'); // 简单尝试，实际 taskTimeline 负责样式
               this.renderTaskDetail(taskItem);
           }
        }
    });
  }
  
  /**
   * 渲染任务详情
   */
  async renderTaskDetail(taskItem) {
    const emptyDetail = document.getElementById('emptyTaskDetail');
    const detailForm = document.getElementById('taskDetailForm');

    if (emptyDetail) emptyDetail.classList.add('hidden');
    if (detailForm) detailForm.classList.remove('hidden');

    // 填充基本信息
    const taskId = taskItem.dataset.taskId;
    const serial = taskItem.dataset.taskSerial;
    // const taskType = taskItem.dataset.taskTitle.split('：')[0];
    const taskType = taskItem.dataset.taskDisplayType || taskItem.dataset.taskTitle.split('：')[0];

    // 获取完整任务数据以显示更多详情 (如评分)
    // DB 是唯一权威数据源，从内存缓存获取
    let detailData = taskService.getCachedTask(taskId) || {};
    if (!detailData.id || !detailData.creator || detailData.rating === undefined || detailData.subtasks === undefined) {
      const tasks = await taskService.getAllTasks();
      detailData = tasks.find(t => String(t.id) === String(taskId)) || detailData;
    }

    document.getElementById('detailTaskTitle').textContent = `#${serial} ${taskItem.dataset.taskTitle}`;
    document.getElementById('detailTaskType').textContent = taskType;
    document.getElementById('detailTaskModel').textContent = getTaskModelLabel(detailData);
    document.getElementById('detailTaskCreator').textContent = taskItem.dataset.taskCreator || 'Unknown';
    document.getElementById('detailTaskLocation').textContent = taskItem.dataset.taskLocation;
    document.getElementById('detailTaskTime').textContent = taskItem.dataset.taskTime;

    // 设置 Use Memory 显示
    const useMemory = taskItem.dataset.taskUseMemory;
    document.getElementById('detailUseMemory').innerHTML = useMemory === '1'
      ? '<span class="text-success">Enabled</span>'
      : '<span class="text-gray-400">Disabled</span>';

    // 设置优先级显示
    const priority = taskItem.dataset.taskPriority;
    let priorityHTML = '';
    if (priority === 'high') {
      priorityHTML = '<span class="text-danger">high</span>';
    } else if (priority === 'medium') {
      priorityHTML = '<span class="text-warning">medium</span>';
    } else {
      priorityHTML = '<span class="text-gray-600">low</span>';
    }
    document.getElementById('detailTaskPriority').innerHTML = priorityHTML;

    // 设置状态显示
    const status = detailData.status || taskItem.dataset.taskStatus;
    this.updateStatusBadge(status);

    const currentUser = authService.getUser();
    const detailTaskIdRow = document.getElementById('detailTaskIdRow');
    const detailTaskId = document.getElementById('detailTaskId');

    if (detailTaskIdRow) {
      detailTaskIdRow.classList.remove('hidden');
    }
    if (detailTaskId) {
      detailTaskId.textContent = detailData.id || taskId || '-';
    }

    // 管理员：显示修改状态按钮
    const modifyBtn = document.getElementById('modifyStatusBtn');
    if (modifyBtn && currentUser && currentUser.role === 'admin') {
      modifyBtn.classList.remove('hidden');
      modifyBtn.onclick = () => this.showStatusEditor(taskId, status);
    } else if (modifyBtn) {
      modifyBtn.classList.add('hidden');
    }

    // ==========================================
    // 子任务与评分逻辑 (Requested Feature)
    // ==========================================

    // 显示子任务统计 (如果有)
    const subtaskStats = document.getElementById('subtaskStats');
    if (detailData.subtasks && detailData.subtasks.length > 0) {
        subtaskStats.classList.remove('hidden');
        const total = detailData.subtasks.length;
        const completed = detailData.subtasks.filter(s => s.status === 'completed').length;
        const processing = detailData.subtasks.filter(s => s.status === 'processing').length;
        const pending = detailData.subtasks.filter(s => s.status === 'pending').length;

        document.getElementById('subtaskTotal').textContent = total;
        document.getElementById('subtaskCompleted').textContent = completed;
        document.getElementById('subtaskProcessing').textContent = processing;
        document.getElementById('subtaskPending').textContent = pending;
    } else {
        subtaskStats.classList.add('hidden');
    }

    // 渲染执行日志
    const execLogSection = document.getElementById('detailExecutionLogSection');
    const execLogEntries = document.getElementById('detailExecutionLogEntries');
    if (execLogSection && execLogEntries) {
      let logEntries = [];
      if (detailData && detailData.execution_log) {
        try {
          logEntries = typeof detailData.execution_log === 'string'
            ? JSON.parse(detailData.execution_log)
            : detailData.execution_log;
        } catch (e) {
          logEntries = [];
        }
      }
      if (logEntries.length) {
        execLogSection.classList.remove('hidden');
        const statusColorMap = {
          pending: 'border-gray-300', executing: 'border-blue-400', processing: 'border-blue-400',
          running: 'border-blue-400', paused: 'border-yellow-400', finished: 'border-green-400',
          completed: 'border-green-400', failed: 'border-red-400', fail: 'border-red-400',
        };
        const statusBadgeMap = {
          pending: 'bg-gray-100 text-gray-600', executing: 'bg-blue-100 text-blue-700',
          processing: 'bg-blue-100 text-blue-700', running: 'bg-blue-100 text-blue-700',
          paused: 'bg-yellow-100 text-yellow-700', finished: 'bg-green-100 text-green-700',
          completed: 'bg-green-100 text-green-700', failed: 'bg-red-100 text-red-700',
          fail: 'bg-red-100 text-red-700',
        };
        execLogEntries.innerHTML = logEntries.map(entry => {
          const s = String(entry.status || '').toLowerCase();
          const borderColor = statusColorMap[s] || 'border-gray-300';
          const badgeClass = statusBadgeMap[s] || 'bg-gray-100 text-gray-600';
          return `
            <div class="border-l-2 ${borderColor} pl-2 py-1">
              <div class="text-gray-400 text-[10px]">${entry.timestamp || ''}</div>
              <span class="inline-block px-1 py-0.5 rounded text-[10px] font-medium ${badgeClass}">${entry.status || 'unknown'}</span>
              <div class="text-gray-600 mt-0.5">${entry.message || ''}</div>
            </div>
          `;
        }).join('');
      } else {
        execLogSection.classList.add('hidden');
      }
    }

    // 处理评价显示
    const ratingSection = document.getElementById('ratingSection');
    const ratedView = document.getElementById('ratedView');
    const unratedView = document.getElementById('unratedView');

    // 只有已完成/失败的任务才显示评价区块
    if (status === 'completed' || status === 'finished' || status === 'failed' || detailData.rating) {
        ratingSection.classList.remove('hidden');

        const hasValidRating = detailData.rating && typeof detailData.rating === 'object' && Object.keys(detailData.rating).length > 0;

        if (hasValidRating) {
            // 已评价
            ratedView.classList.remove('hidden');
            unratedView.classList.add('hidden');

            // 渲染多维度评分
            const dimensionRatings = document.getElementById('dimensionRatings');
            dimensionRatings.innerHTML = '';

            const dimensions = [
                { key: 'personalization_level', label: 'Personalization Level' },
                { key: 'score_functional_correctness', label: 'Functional Correctness' },
                { key: 'score_personalized_correctness', label: 'Personalized Correctness' },
                { key: 'score_intent_understanding', label: 'Intent Understanding' },
                { key: 'score_auto_completion', label: 'Auto Completion' },
                { key: 'score_robot_improvement', label: 'Robot Improvement' }
            ];

            dimensions.forEach(dim => {
                const score = detailData.rating[dim.key];
                if (score) {
                    const row = document.createElement('div');
                    row.className = 'flex items-center justify-between text-sm';

                    // Label
                    const label = document.createElement('span');
                    label.className = 'text-gray-600';
                    label.textContent = dim.label;
                    row.appendChild(label);

                    // Stars
                    const starsContainer = document.createElement('div');
                    starsContainer.className = 'flex text-yellow-400 text-xs';
                    for (let i = 1; i <= 5; i++) {
                        const star = document.createElement('i');
                        star.className = `fa fa-star ${i <= score ? '' : 'text-gray-300'}`;
                        starsContainer.appendChild(star);
                    }
                    row.appendChild(starsContainer);

                    // Score text
                    const scoreText = document.createElement('span');
                    scoreText.className = 'font-bold text-gray-700 text-xs ml-2';
                    scoreText.textContent = `${score}/5`;
                    row.appendChild(scoreText);

                    dimensionRatings.appendChild(row);
                }
            });

            const editRatingBtnId = 'editRatingBtn';
            const oldEditRatingBtn = document.getElementById(editRatingBtnId);
            if (oldEditRatingBtn) oldEditRatingBtn.remove();

            if (authService.isAdmin()) {
                const editRatingBtn = document.createElement('button');
                editRatingBtn.id = editRatingBtnId;
                editRatingBtn.className = 'mb-3 text-xs text-primary hover:text-primary/80 transition-colors inline-flex items-center';
                editRatingBtn.innerHTML = '<i class="fa fa-pencil mr-1"></i> Edit Feedback';
                editRatingBtn.addEventListener('click', () => {
                    if (this.ratingModal) {
                        this.ratingModal.openManually(taskId, detailData.rating);
                    }
                });
                dimensionRatings.parentNode.insertBefore(editRatingBtn, dimensionRatings.nextSibling);
            }

            // 显示符合预期情况
            const commentSection = document.getElementById('commentSection');
            const commentSpan = document.getElementById('ratedComment');

            // 清理旧的 expectation 元素 (如果有)
            const oldExp = document.getElementById('ratedExpectationDisplay');
            if (oldExp) oldExp.remove();

            if (detailData.rating.expectation) {
                 const expectationEl = document.createElement('div');
                 expectationEl.id = 'ratedExpectationDisplay';
                 expectationEl.className = 'mb-2 text-sm flex items-center border-b pb-2';

                 const expMap = {
                     'yes': { text: 'Fully Met Expectations', icon: 'fa-check-circle', color: 'text-green-600' },
                     'partial': { text: 'Partially Met Expectations', icon: 'fa-exclamation-circle', color: 'text-yellow-600' },
                     'no': { text: 'Unmet Expectations', icon: 'fa-times-circle', color: 'text-red-600' }
                 };
                 const exp = expMap[detailData.rating.expectation] || { text: detailData.rating.expectation, icon: 'fa-info-circle', color: 'text-gray-600' };

                 expectationEl.innerHTML = `<span class="font-bold text-gray-700 mr-2">Result:</span>
                    <span class="${exp.color} font-medium flex items-center">
                        <i class="fa ${exp.icon} mr-1"></i> ${exp.text}
                    </span>`;

                 commentSection.parentNode.insertBefore(expectationEl, commentSection);
            }

            commentSpan.textContent = detailData.rating.comment || 'No comment provided';

            // 显示评价人信息
            if (detailData.rating.submitted_by || detailData.rating.submittedBy) {
                const submittedBy = detailData.rating.submitted_by || detailData.rating.submittedBy;
                const submittedAt = detailData.rating.submitted_at || detailData.rating.submittedAt;

                let infoEl = document.getElementById('ratedInfo');
                if (!infoEl) {
                    infoEl = document.createElement('div');
                    infoEl.id = 'ratedInfo';
                    infoEl.className = 'text-xs text-gray-400 mt-2 border-t pt-2';
                    commentSpan.parentNode.appendChild(infoEl);
                }
                const timeStr = submittedAt ? new Date(submittedAt).toLocaleString() : 'Unknown time';
                infoEl.innerHTML = `<i class="fa fa-user mr-1"></i> ${submittedBy} <span class="mx-2">|</span> <i class="fa fa-clock-o mr-1"></i> ${timeStr}`;
            }
        } else {
            // 未评价
            ratedView.classList.add('hidden');

            // 检查当前用户是否是任务创建者
            const currentUser = authService.getUser();
            const creator = detailData.creator || taskItem.dataset.taskCreator;
            const isCreator = currentUser && creator === currentUser.username;

            // 只有创建者才能看到添加问卷按钮
            const addRatingBtn = document.getElementById('addRatingBtn');
            const unratedContent = unratedView.querySelector('p');

            if (isCreator) {
                // 创建者：显示添加问卷按钮
                unratedContent.textContent = 'No feedback yet';
                unratedView.classList.remove('hidden');

                if (addRatingBtn) {
                    addRatingBtn.style.display = '';
                    // 使用 cloneNode 清除旧的事件监听器
                    const newBtn = addRatingBtn.cloneNode(true);
                    addRatingBtn.parentNode.replaceChild(newBtn, addRatingBtn);

                    newBtn.addEventListener('click', () => {
                        if (this.ratingModal) {
                            this.ratingModal.openManually(taskId);
                        }
                    });
                }
            } else {
                // 非创建者：隐藏添加问卷按钮，显示提示信息
                unratedContent.textContent = 'Only task creator can provide feedback';
                if (addRatingBtn) addRatingBtn.style.display = 'none';
                unratedView.classList.remove('hidden');
            }
        }
    } else {
        ratingSection.classList.add('hidden');
    }

    // 渲染操作按钮
    this.renderActionButtons(taskId, status, detailData.creator);
  }
  
  updateSelectedTaskDetail(taskId, taskItem, updates = {}) {
    const detailForm = document.getElementById('taskDetailForm');
    if (!detailForm || detailForm.classList.contains('hidden')) {
      return;
    }

    const cachedTask = taskService.getCachedTask(taskId) || {};
    const resolvedStatus = updates.status !== undefined
      ? updates.status
      : (cachedTask.status ?? taskItem?.dataset?.taskStatus);
    const resolvedCreator = cachedTask.creator || taskItem?.dataset?.taskCreator || 'Unknown';

    if (taskItem && resolvedStatus !== undefined) {
      taskItem.dataset.taskStatus = resolvedStatus;
    }

    this.updateStatusBadge(resolvedStatus);
    this.renderActionButtons(taskId, resolvedStatus, resolvedCreator);

    const modifyBtn = document.getElementById('modifyStatusBtn');
    const currentUser = authService.getUser();
    if (modifyBtn && currentUser?.role === 'admin') {
      modifyBtn.onclick = () => this.showStatusEditor(taskId, resolvedStatus);
    }
  }

  /**
   * 更新状态徽章
   */
  updateStatusBadge(status) {
    const statusElement = document.getElementById('detailTaskStatus');
    if (!statusElement) return;
    
    const normalizedStatus = String(status).toLowerCase().trim();

    const statusMap = {
      executing: { text: 'Executing', class: 'status-badge status-primary' },
      processing: { text: 'Executing', class: 'status-badge status-primary' },
      running: { text: 'Executing', class: 'status-badge status-primary' },
      paused: { text: 'Paused', class: 'status-badge status-warning' },
      completed: { text: 'Completed', class: 'status-badge status-success' },
      finish: { text: 'Completed', class: 'status-badge status-success' },
      finished: { text: 'Completed', class: 'status-badge status-success' },
      failed: { text: 'Failed', class: 'status-badge status-danger' },
      submitting: { text: 'Submitting', class: 'status-badge bg-gray-100 text-gray-500' },
      pending: { text: 'Pending', class: 'status-badge status-pending' }
    };
    
    const statusInfo = statusMap[normalizedStatus] || statusMap.pending;
    statusElement.textContent = statusInfo.text;
    statusElement.className = statusInfo.class;
  }
  
  /**
   * 渲染操作按钮
   */
  renderActionButtons(taskId, status, creator) {
    const container = document.getElementById('taskActionButtons');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Normalize status
    const normalizedStatus = String(status).toLowerCase().trim();
    
    // 权限检查：仅任务创建者或管理员可以操作
    const currentUser = authService.getUser();
    if (!currentUser) return;
    
    const isCreator = creator === currentUser.username;
    const isAdmin = currentUser.role === 'admin';

    // 如果不是创建者且不是管理员，不显示操作按钮
    if (!isCreator && !isAdmin) {
        return;
    }

    // 暂停/恢复按钮
    if (['executing', 'processing', 'running'].includes(normalizedStatus)) {
      const pauseBtn = this.createButton('Pause', 'warning', 'pause', () => {
        this.controlTask(taskId, 'pause');
      });
      container.appendChild(pauseBtn);
    } else if (normalizedStatus === 'paused') {
      const resumeBtn = this.createButton('Resume', 'success', 'play', () => {
        this.controlTask(taskId, 'resume');
      });
      container.appendChild(resumeBtn);
    }

    // 终止按钮 (仅在非终态显示)
    if (['executing', 'processing', 'running', 'paused', 'pending', 'submitting'].includes(normalizedStatus)) {
        const terminateBtn = this.createButton('Terminate', 'secondary', 'stop', () => {
            this.terminateTask(taskId);
        });
        terminateBtn.className = `flex-1 bg-gray-600 text-white py-2 rounded-md hover:bg-gray-700 transition-colors flex items-center justify-center text-sm`;
        container.appendChild(terminateBtn);
    }

    // 删除按钮
    const deleteBtn = this.createButton('Delete', 'danger', 'trash', () => {
      this.deleteTask(taskId);
    });
    container.appendChild(deleteBtn);
  }

  /**
   * 终止任务
   */
  async terminateTask(taskId) {
      if (!confirm('Are you sure you want to terminate this task? It will stop but not be deleted.')) return;

      try {
          await taskService.controlTask(taskId, 'terminate');
          this.showToast('Task terminated', 'success');
          // 状态更新通常通过轮询或 events 完成，但为了即时反馈：
          eventBus.emit('task:status-update', { taskId, status: 'failed' }); // Terminated tasks usually go to failed or specific term status
      } catch (error) {
          this.showToast('Termination failed: ' + (error.message || 'Unknown error'), 'error');
      }
  }

  /**
   * 管理员修改任务状态
   */
  showStatusEditor(taskId, currentStatus) {
    const statusBadge = document.getElementById('detailTaskStatus');
    const modifyBtn = document.getElementById('modifyStatusBtn');
    if (!statusBadge || !modifyBtn) return;

    const allStatuses = ['pending', 'executing', 'paused', 'completed', 'failed'];

    // 隐藏原有的状态 badge 和修改按钮
    statusBadge.style.display = 'none';
    modifyBtn.style.display = 'none';

    // 创建编辑器容器，插入到 wrapper 中
    const wrapper = statusBadge.parentElement;
    const editor = document.createElement('div');
    editor.id = 'statusEditorInline';
    editor.className = 'flex items-center gap-1 flex-wrap';
    editor.innerHTML = allStatuses.map(s => `
      <button class="status-option-btn px-2 py-0.5 rounded text-xs font-medium transition-colors
        ${s === currentStatus ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer'}"
        data-status="${s}" ${s === currentStatus ? 'disabled' : ''}>
        ${s}
      </button>
    `).join('');
    wrapper.appendChild(editor);

    const closeEditor = () => {
      editor.remove();
      statusBadge.style.display = '';
      modifyBtn.style.display = '';
    };

    editor.querySelectorAll('.status-option-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newStatus = btn.dataset.status;
        try {
          await taskService.overrideTaskStatus(taskId, newStatus);
          this.showToast(`Status changed to ${newStatus}`, 'success');
          closeEditor();
          // 更新状态 badge 和修改按钮
          this.updateStatusBadge(newStatus);
          modifyBtn.onclick = () => this.showStatusEditor(taskId, newStatus);
        } catch (error) {
          this.showToast('Failed to update status', 'error');
          closeEditor();
        }
      });
    });
  }
  createButton(text, type, icon, onClick) {
    const btn = document.createElement('button');
    btn.className = `flex-1 bg-${type} text-white py-2 rounded-md hover:bg-${type}/90 transition-colors flex items-center justify-center text-sm`;
    btn.innerHTML = `<i class="fa fa-${icon} mr-2"></i>${text}`;
    btn.onclick = onClick;
    return btn;
  }
  
  /**
   * 控制任务
   */
  async controlTask(taskId, action) {
    try {
      await taskService.controlTask(taskId, action);
      this.showToast(`Task ${action === 'pause' ? 'paused' : 'resumed'}`, 'success');
    } catch (error) {
      this.showToast('Operation failed', 'error');
    }
  }
  
  /**
   * 删除任务
   */
  async deleteTask(taskId) {
    if (!confirm('Are you sure you want to delete this task?')) return;
    
    try {
      await taskService.deleteTask(taskId);
      this.showToast('Task deleted', 'success');
    } catch (error) {
      this.showToast('Delete failed', 'error');
    }
  }
  
  /**
   * 隐藏任务详情
   */
  hideTaskDetail() {
    const emptyDetail = document.getElementById('emptyTaskDetail');
    const detailForm = document.getElementById('taskDetailForm');
    
    if (emptyDetail) emptyDetail.classList.remove('hidden');
    if (detailForm) detailForm.classList.add('hidden');
  }
  
  /**
   * 渲染未评分任务列表
   */
  updateUnratedTasksPanel(tasks) {
    const panel = document.getElementById('unratedTasksPanel');
    const listEl = document.getElementById('unratedTasksList');
    const emptyEl = document.getElementById('unratedTasksEmpty');
    if (!panel || !listEl) return;

    const currentUser = authService.getUser();
    if (!currentUser) {
      panel.classList.add('hidden');
      return;
    }

    // 筛选：当前用户创建的终态任务中，未评分的
    const unratedTasks = (tasks || []).filter(task => {
      if (task.creator !== currentUser.username) return false;
      if (!taskService.isTerminalStatus(task?.status)) return false;
      const hasValidRating = task?.rating && typeof task.rating === 'object' && Object.keys(task.rating).length > 0;
      return !hasValidRating;
    });

    if (unratedTasks.length === 0) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.classList.add('hidden');

    unratedTasks.forEach(task => {
      const sid = (task.id || '').substring(0, 8);
      const desc = (task.description || 'No description').substring(0, 40);
      const statusLabel = {
        finished: 'Finished', completed: 'Completed', failed: 'Failed', fail: 'Failed'
      }[task.status] || task.status;
      const statusColor = task.status === 'failed' ? 'text-red-500' : 'text-green-500';

      const createTime = task.create_time || '-';
      const execTime = task.execute_time || task.create_time || '-';

      const item = document.createElement('div');
      item.className = 'flex items-center justify-between p-2 rounded-md border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors';
      item.innerHTML = `
        <div class="flex-1 min-w-0">
          <p class="text-sm text-gray-800 truncate" title="${task.description}">${desc}</p>
          <p class="text-xs text-gray-400">#${sid} · <span class="${statusColor}">${statusLabel}</span> · Created: ${createTime.substring(0, 16)} · Execute: ${execTime.substring(0, 16)}</p>
        </div>
        <button class="rate-task-btn ml-2 px-3 py-1 text-xs rounded-md bg-warning text-white hover:bg-warning/90 transition-colors shrink-0">
          <i class="fa fa-star mr-1"></i>Rate
        </button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.rate-task-btn')) return; // button handles its own click
        if (this.ratingModal) this.ratingModal.openManually(task.id);
      });

      const rateBtn = item.querySelector('.rate-task-btn');
      rateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.ratingModal) this.ratingModal.openManually(task.id);
      });

      listEl.appendChild(item);
    });
  }

  /**
   * 环境检查确认后，弹出所有等待中的评分问卷
   */
  _showPendingRatings() {
    const taskIds = [...this._pendingRatingTaskIds];
    this._pendingRatingTaskIds.clear();
    taskIds.forEach(taskId => {
      if (this.ratingModal) {
        this.ratingModal.open(taskId);
      }
    });
  }

  /**
   * 显示提示信息
   */
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : 
                    type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    toast.className = `fixed top-4 right-4 ${bgColor} text-white px-4 py-2 rounded shadow-lg z-50 transition-opacity duration-500`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 500);
    }, 2000);
  }
  
  /**
   * 销毁应用
   */
  destroy() {
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
    }
    
    if (this.videoStream) {
      this.videoStream.stop();
    }
    
    taskService.stopAllPolling();
    eventBus.clear();
    
    console.log('Robot Monitor System destroyed');
  }
}

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
  const app = new RobotMonitorApp();
  app.init();
  
  // 全局暴露app实例（用于调试）
  window.robotMonitorApp = app;
  
  // 页面卸载时清理资源
  window.addEventListener('beforeunload', () => {
    app.destroy();
  });
});
