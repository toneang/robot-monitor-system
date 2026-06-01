import eventBus from '../../core/event-bus.js';
import { formatTime } from '../../utils/formatter.js';
import taskService from '../../services/task.service.js';
import storageService from '../../services/storage.service.js';
import { authService } from '../../services/auth.service.js';
import { getDisplayTaskTypeLabel } from '../../utils/task-type.js';

/**
 * 任务时间轴组件
 */
export class TaskTimeline {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.options = {
      bindFilters: true,
      variant: 'timeline',
      emptyMessage: 'No tasks available',
      taskMatcher: null,
      ...options
    };
    this.currentFilter = 'all';
    this.selectedTaskId = null;
    this.serialMap = new Map();
    this.init();
  }
  
  init() {
    if (this.options.bindFilters) {
      this.setupFilterButtons();
    }
    this.setupEventListeners();
  }

  shouldRenderTask(task) {
    if (typeof this.options.taskMatcher !== 'function') {
      return true;
    }

    return this.options.taskMatcher(task);
  }

  resetSerials() {
    this.serialMap.clear();
  }

  setTaskSerial(taskId, serial) {
    this.serialMap.set(taskId, serial);
    return serial;
  }

  getNextSerial() {
    const values = Array.from(this.serialMap.values()).map(value => Number(value) || 0);
    return values.length ? Math.max(...values) + 1 : 1;
  }

  renderBaseContainer() {
    this.container.innerHTML = this.options.variant === 'timeline'
      ? '<div class="timeline-line"></div>'
      : '';
  }

  renderEmptyState() {
    this.container.insertAdjacentHTML(
      'beforeend',
      `<div class="no-tasks-message text-center py-4 text-gray-500">${this.options.emptyMessage}</div>`
    );
  }

  matchesCurrentFilter(task, typeOverride = null) {
    const type = typeOverride || this.getTaskStyles(task?.status).type;

    switch (this.currentFilter) {
      case 'history':
        return type === 'history';
      case 'current':
        return type === 'current';
      case 'pending':
      case 'future':
        return type === 'future';
      case 'mine': {
        const currentUser = authService.getUser();
        return !!currentUser?.username && taskService.matchesCreator(task, currentUser.username);
      }
      case 'all':
      default:
        return true;
    }
  }
  
  /**
   * 设置筛选按钮
   */
  setupFilterButtons() {
    document.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.handleFilter(btn.dataset.filter, btn);
      });
    });
    
    // 清空选择按钮
    const clearBtn = document.getElementById('clearTaskSelection');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear local task cache and deselect all?')) {
          storageService.clearAll();
          this.clearSelection();
          // 可选：刷新列表以反映缓存变化（如果列表依赖缓存）
          // window.location.reload(); 
        }
      });
    }
  }
  
  /**
   * 处理筛选
   */
  async handleFilter(filter, btn) {
    this.currentFilter = filter;
    
    // 更新按钮状态
    document.querySelectorAll('[data-filter]').forEach(b => {
      b.classList.remove('btn-active');
      b.classList.add('btn-inactive');
    });
    btn.classList.remove('btn-inactive');
    btn.classList.add('btn-active');
    
    // 应用筛选 (从服务器获取)
    try {
      this.container.innerHTML = '<div class="text-center py-4"><i class="fa fa-spinner fa-spin text-primary"></i> Loading...</div>';
      const tasks = await taskService.fetchTasks(filter);
      this.render(tasks);
    } catch (error) {
      console.error('Failed to filter tasks:', error);
      this.container.innerHTML = '<div class="text-center py-4 text-red-500">Failed to load</div>';
    }

    // 如果选中的任务被隐藏/移除，清空选择 (Render 会重置 DOM，所以需要检查 ID 是否在新列表中)
    // Render 已经重建了列表，之前的 selectedTaskId 如果有效，应该高亮，但这里简单起见可以重置
    this.clearSelection();
  }
  
  /**
   * 清空选择
   */
  clearSelection() {
    document.querySelectorAll('.task-card').forEach(c => c.classList.remove('active'));
    this.selectedTaskId = null;
    eventBus.emit('task:deselected');
  }
  
  /**
   * 设置事件监听
   */
  setupEventListeners() {
    eventBus.on('task:created', this.addTaskToTimeline.bind(this));
    eventBus.on('task:status-update', this.updateTaskStatus.bind(this));
    eventBus.on('task:deleted', this.removeTask.bind(this));
  }
  
  /**
   * 渲染任务列表
   */
  render(tasks) {
    const visibleTasks = (tasks || []).filter(task =>
      this.shouldRenderTask(task) && this.matchesCurrentFilter(task)
    );
    this.renderBaseContainer();
    this.resetSerials();
    
    if (!visibleTasks.length) {
      this.renderEmptyState();
      return;
    }
    
    visibleTasks.forEach((task, index) => {
      const serial = this.setTaskSerial(task.id, index + 1);
      this.renderTaskItem(task, serial);
    });
  }
  
  /**
   * 渲染单个任务项
   */
  renderTaskItem(task, serial) {
    const { dotColor, type, iconClass, statusLabel, statusClass } = this.getTaskStyles(task.status);
    
    const priorityLabel = task.priority || 'low';
    const createdAt = formatTime(task.create_time);
    const displayTaskType = getDisplayTaskTypeLabel(task);
    const executionTime = task.execute_time || 'pending';
    const commonDataset = `
           data-type="${type}" 
           data-task-id="${task.id}" 
           data-task-status="${task.status}"
           data-task-serial="${serial}"
           data-task-title="${displayTaskType}：${task.description.substring(0, 20)}..."
           data-task-display-type="${displayTaskType}"
           data-task-priority="${task.priority}"
           data-task-location="${task.location || 'unspecified'}"
           data-task-time="${executionTime}"
           data-task-creator="${task.creator || 'User'}"
           data-task-create-time="${task.create_time}"
           data-task-use-memory="${task.use_memory || '0'}"`;
    
    const showMessage = String(task.status || '').toLowerCase().trim() === 'executing';
    const visibleMessage = showMessage ? (task.message || '') : '';
    const messageHtml = `
      <div class="task-message-container ${visibleMessage ? 'block' : 'hidden'} mb-3">
        <div class="bg-blue-50 border border-blue-100/50 rounded-md p-2 text-xs text-blue-700 flex items-start space-x-2">
          <i class="fa fa-info-circle mt-0.5 opacity-80"></i>
          <span class="task-message-text block min-w-0 flex-1 leading-relaxed break-words line-clamp-1">${visibleMessage}</span>
          <button type="button" class="task-message-toggle hidden" aria-expanded="false" title="Expand message">^</button>
        </div>
      </div>
    `;

    const html = this.options.variant === 'timeline'
      ? `
        <div class="mb-6 relative task-item" ${commonDataset}>
          <div class="timeline-dot ${dotColor}">
            <i class="${iconClass} text-white text-sm"></i>
          </div>
          <div class="ml-4 task-card bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-all">
            <div class="flex justify-between items-start mb-1">
              <div class="flex items-center space-x-2">
                <span class="text-xs font-bold text-primary">#${serial}</span>
                <h4 class="font-bold text-gray-800 text-sm">${displayTaskType}</h4>
              </div>
              <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">${priorityLabel}</span>
            </div>
            <p class="text-sm text-gray-600 mb-2 line-clamp-2">${task.description}</p>
            ${messageHtml}
            <div class="flex items-center text-xs text-gray-400 space-x-3">
              <span><i class="fa fa-map-marker mr-1"></i>${task.location || 'unspecified'}</span>
              <span><i class="fa fa-clock-o mr-1"></i>${createdAt}</span>
              <span class="task-status-text text-xs px-1.5 py-0.5 rounded ml-auto ${statusClass}">${statusLabel}</span>
            </div>
          </div>
        </div>
      `
      : `
        <div class="task-item mb-3" ${commonDataset}>
          <div class="task-card bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-all">
            <div class="flex justify-between items-start gap-3 mb-2">
              <div class="min-w-0">
                <div class="flex items-center space-x-2">
                  <span class="text-xs font-bold text-primary">#${serial}</span>
                  <h4 class="font-bold text-gray-800 text-sm truncate">${displayTaskType}</h4>
                </div>
                <p class="text-xs text-gray-400 mt-1"><i class="fa fa-clock-o mr-1"></i>${createdAt}</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">${priorityLabel}</span>
                <span class="task-status-text text-xs px-1.5 py-0.5 rounded ${statusClass}">${statusLabel}</span>
              </div>
            </div>
            <p class="text-sm text-gray-600 mb-2 line-clamp-2">${task.description}</p>
            ${messageHtml}
            <div class="flex items-center text-xs text-gray-400 justify-between gap-2">
              <span class="truncate"><i class="fa fa-map-marker mr-1"></i>${task.location || 'unspecified'}</span>
              <span class="shrink-0"><i class="fa fa-calendar mr-1"></i>${executionTime}</span>
            </div>
          </div>
        </div>
      `;
    
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const taskItem = wrapper.firstElementChild;
    this.container.appendChild(taskItem);
    this.bindTaskClickEvent(taskItem);
    this.bindTaskMessageToggle(taskItem);
  }
  
  /**
   * 获取任务样式
   */
  getTaskStyles(status) {
    const normalizedStatus = String(status).toLowerCase().trim();
    
    const styles = {
      completed: {
        dotColor: 'bg-success',
        type: 'history',
        iconClass: 'fa fa-check',
        statusLabel: 'Completed',
        statusClass: 'status-success'
      },
      finish: {
        dotColor: 'bg-success',
        type: 'history',
        iconClass: 'fa fa-check',
        statusLabel: 'Finished',
        statusClass: 'status-success'
      },
      finished: {
        dotColor: 'bg-success',
        type: 'history',
        iconClass: 'fa fa-check',
        statusLabel: 'Finished',
        statusClass: 'status-success'
      },
      executing: {
        dotColor: 'bg-current',
        type: 'current',
        iconClass: 'fa fa-spinner fa-spin',
        statusLabel: 'Executing',
        statusClass: 'status-primary'
      },
      processing: {
        dotColor: 'bg-current',
        type: 'current',
        iconClass: 'fa fa-spinner fa-spin',
        statusLabel: 'Executing',
        statusClass: 'status-primary'
      },
      running: {
        dotColor: 'bg-current',
        type: 'current',
        iconClass: 'fa fa-spinner fa-spin',
        statusLabel: 'Executing',
        statusClass: 'status-primary'
      },
      paused: {
        dotColor: 'bg-warning',
        type: 'current',
        iconClass: 'fa fa-pause',
        statusLabel: 'Paused',
        statusClass: 'status-warning'
      },
      failed: {
        dotColor: 'bg-danger',
        type: 'history',
        iconClass: 'fa fa-times',
        statusLabel: 'Failed',
        statusClass: 'status-danger'
      },
      submitting: {
        dotColor: 'bg-gray-300',
        type: 'future',
        iconClass: 'fa fa-upload',
        statusLabel: 'Submitting',
        statusClass: 'bg-gray-100 text-gray-500' // Keep as is or add status-neutral? Let's leave custom for now
      }
    };
    
    return styles[normalizedStatus] || {
      dotColor: 'bg-pending',
      type: 'future',
      iconClass: 'fa fa-clock-o',
      statusLabel: 'Pending',
      statusClass: 'status-pending'
    };
  }
  
  /**
   * 绑定任务点击事件
   */
  bindTaskClickEvent(taskItem) {
    const taskId = taskItem?.dataset?.taskId;
    const taskCard = taskItem?.querySelector('.task-card');
    if (taskCard) {
      taskCard.addEventListener('click', () => {
        document.querySelectorAll('.task-card').forEach(c => c.classList.remove('active'));
        taskCard.classList.add('active');
        this.selectedTaskId = taskId;
        
        eventBus.emit('task:selected', { taskId, taskItem });
      });
    }
  }

  bindTaskMessageToggle(taskItem) {
    if (!taskItem) return;

    const toggleBtn = taskItem.querySelector('.task-message-toggle');
    if (!toggleBtn) return;

    toggleBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isExpanded = toggleBtn.dataset.expanded === 'true';
      this.setTaskMessageExpanded(taskItem, !isExpanded);
    });

    this.refreshTaskMessage(
      taskItem,
      taskItem.querySelector('.task-message-text')?.textContent || '',
      taskItem.dataset.taskStatus
    );
  }

  refreshTaskMessage(taskItem, message, status) {
    const msgContainer = taskItem.querySelector('.task-message-container');
    const msgText = taskItem.querySelector('.task-message-text');
    const toggleBtn = taskItem.querySelector('.task-message-toggle');
    if (!msgContainer || !msgText || !toggleBtn) return;

    const normalizedStatus = String(status || taskItem.dataset.taskStatus || '').toLowerCase().trim();
    const normalizedMessage = typeof message === 'string' ? message : '';
    const canShow = normalizedStatus === 'executing' && !!normalizedMessage;
    const previousExpanded = toggleBtn.dataset.expanded === 'true';

    if (!canShow) {
      msgText.textContent = '';
      msgContainer.classList.add('hidden');
      msgContainer.classList.remove('block');
      toggleBtn.classList.add('hidden');
      this.setTaskMessageExpanded(taskItem, false);
      return;
    }

    msgText.textContent = normalizedMessage;
    msgContainer.classList.remove('hidden');
    msgContainer.classList.add('block');

    const canExpand = this.canExpandTaskMessage(msgText);
    toggleBtn.classList.toggle('hidden', !canExpand);
    this.setTaskMessageExpanded(taskItem, canExpand ? previousExpanded : false);
  }

  canExpandTaskMessage(msgText) {
    if (!msgText) return false;

    const originalExpanded = msgText.classList.contains('task-message-expanded');
    msgText.classList.remove('line-clamp-1');
    msgText.classList.add('task-message-expanded');

    const lineHeight = Number.parseFloat(window.getComputedStyle(msgText).lineHeight) || 20;
    const canExpand = msgText.scrollHeight > lineHeight * 1.5;

    msgText.classList.toggle('task-message-expanded', originalExpanded);
    msgText.classList.toggle('line-clamp-1', !originalExpanded);

    return canExpand;
  }

  setTaskMessageExpanded(taskItem, expanded) {
    const msgText = taskItem.querySelector('.task-message-text');
    const toggleBtn = taskItem.querySelector('.task-message-toggle');
    if (!msgText || !toggleBtn) return;

    msgText.classList.toggle('line-clamp-1', !expanded);
    msgText.classList.toggle('task-message-expanded', expanded);

    toggleBtn.dataset.expanded = String(expanded);
    toggleBtn.setAttribute('aria-expanded', String(expanded));
    toggleBtn.title = expanded ? 'Collapse message' : 'Expand message';
    toggleBtn.classList.toggle('task-message-toggle-collapsed', !expanded);
  }
  
  /**
   * 添加任务到时间轴
   */
  addTaskToTimeline(task) {
    if (!this.shouldRenderTask(task)) {
      return;
    }

    console.log(`[TaskTimeline] 添加任务到时间轴，任务ID: ${task.id}，状态: ${task.status}，当前筛选: ${this.currentFilter}`);
    // 移除"暂无任务"消息
    const noTasksMsg = this.container.querySelector('.no-tasks-message');
    if (noTasksMsg) noTasksMsg.remove();
    
    const serial = this.setTaskSerial(task.id, this.getNextSerial());
    this.renderTaskItem(task, serial);

    // 应用当前筛选条件
    const { type } = this.getTaskStyles(task.status);
    const taskItem = this.container.querySelector(`.task-item[data-task-id="${task.id}"]`);
    if (taskItem) {
      const shouldHide = !this.matchesCurrentFilter(task, type);
      taskItem.classList.toggle('hidden', shouldHide);
      console.log(`[TaskTimeline] 应用筛选: 任务类型=${type}, 应该隐藏=${shouldHide}`);
    }
  }
  
  /**
   * 更新任务状态
   */
  updateTaskStatus({ taskId, status, message  }) {
    const taskItem = this.container.querySelector(`.task-item[data-task-id="${taskId}"]`);
    if (!taskItem) return;

    taskItem.dataset.taskStatus = status;

    // 更新消息显示
    if (message !== undefined) {
      this.refreshTaskMessage(taskItem, message, status);
    }

    const { dotColor, type, iconClass, statusLabel, statusClass } = this.getTaskStyles(status);

    const dot = taskItem.querySelector('.timeline-dot');
    const icon = dot.querySelector('i');
    const statusText = taskItem.querySelector('.task-status-text');

    dot.className = `timeline-dot ${dotColor}`;
    icon.className = `${iconClass} text-white text-sm`;

    if (statusText) {
      statusText.textContent = statusLabel;
      statusText.className = `task-status-text text-xs px-1.5 py-0.5 rounded ml-auto ${statusClass}`;
    }

    taskItem.dataset.type = type;

    // 应用当前筛选
    taskItem.classList.toggle('hidden', !this.matchesCurrentFilter({
      creator: taskItem.dataset.taskCreator,
      status
    }, type));

    // 更新全局系统状态
    this.updateSystemGlobalStatus();
  }
  
  /**
   * 移除任务
   */
  removeTask({ taskId }) {
    const taskItem = this.container.querySelector(`.task-item[data-task-id="${taskId}"]`);
    if (taskItem) {
      taskItem.remove();
      this.serialMap.delete(taskId);
      
      if (this.selectedTaskId === taskId) {
        this.clearSelection();
      }
      
      // 检查是否还有任务
      const remainingTasks = this.container.querySelectorAll('.task-item');
      if (remainingTasks.length === 0) {
        this.renderBaseContainer();
        this.renderEmptyState();
      }
    }
    
    this.updateSystemGlobalStatus();
  }
  
  /**
   * 更新全局系统状态
   * Note: Global Status is now managed by main.js polling/events to support multi-user views
   */
  updateSystemGlobalStatus() {
    // Deprecated: Logic moved to main.js updateGlobalTaskStatus()
  }
}
