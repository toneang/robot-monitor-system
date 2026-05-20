import { getDisplayTaskTypeLabel } from '../../utils/task-type.js';

export class TaskConfirmModal {
  constructor() {
    this.modal = null;
    this.floatingBall = null;
    this.pending = [];
    this.activeRequest = null;
    this.floatingRequest = null;
    this.onDecision = null;
    this.ensureModal();
    this.ensureFloatingBall();
    this.bindEvents();
  }

  ensureModal() {
    this.modal = document.getElementById('taskConfirmModal');
    if (this.modal) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'taskConfirmModal';
    wrapper.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 hidden z-50 flex items-center justify-center';
    wrapper.innerHTML = `
      <div class="relative mx-auto p-5 border w-[420px] shadow-lg rounded-md bg-white">
        <div class="mt-2">
          <div class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100 mb-3">
            <i class="fa fa-exclamation-triangle text-yellow-600 text-xl"></i>
          </div>
          <h3 id="confirmTaskTitle" class="text-lg font-medium text-gray-900 text-center">Task Confirmation Required</h3>
          <p id="confirmTaskHint" class="text-sm text-gray-600 mt-2 text-center">Choose how to handle the current subtask.</p>
          <p class="text-xs text-gray-500 mt-1 text-center">Task ID: <span id="confirmTaskId" class="font-mono"></span></p>
          <div class="mt-3 px-1 py-2 bg-gray-50 rounded border text-sm text-gray-700 space-y-2">
            <p><span class="font-semibold">Type:</span> <span id="confirmTaskType">-</span></p>
            <p><span class="font-semibold">Creator:</span> <span id="confirmTaskCreator">-</span></p>
            <p><span class="font-semibold">Location:</span> <span id="confirmTaskLocation">-</span></p>
            <p><span class="font-semibold">Description:</span></p>
            <p id="confirmTaskDesc" class="text-gray-600 break-words">-</p>
          </div>
          <div id="confirmTaskActions" class="items-center px-1 py-3 flex gap-2"></div>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);
    this.modal = wrapper;
  }

  ensureFloatingBall() {
    this.floatingBall = document.getElementById('taskConfirmFloatingBall');
    if (this.floatingBall) return;

    const ball = document.createElement('button');
    ball.id = 'taskConfirmFloatingBall';
    ball.type = 'button';
    ball.className = 'fixed right-6 top-6 hidden z-40 w-16 h-16 rounded-full bg-primary text-white shadow-xl hover:bg-primary/90 focus:outline-none focus:ring-4 focus:ring-primary/30 flex items-center justify-center';
    ball.innerHTML = `
      <span class="relative flex h-full w-full items-center justify-center">
        <i class="fa fa-hand-paper-o text-2xl"></i>
        <span id="taskConfirmFloatingBadge" class="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-yellow-400 text-gray-900 text-[10px] font-bold flex items-center justify-center">Manual</span>
      </span>
    `;
    ball.title = 'Manual takeover in progress';
    document.body.appendChild(ball);
    this.floatingBall = ball;
  }

  bindEvents() {
    const actions = document.getElementById('confirmTaskActions');
    if (actions) {
      actions.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest('[data-confirm-action]');
        if (!button) return;
        this.decide(button.dataset.confirmAction);
      });
    }

    if (this.floatingBall) {
      this.floatingBall.addEventListener('click', () => this.openFloatingRequest());
    }
  }

  setOnDecision(callback) {
    this.onDecision = callback;
  }

  enqueue(requestData) {
    const request = this.normalizeRequest(requestData);
    if (request.phase === 'manual_takeover') {
      this.setFloatingRequest(request);
      return;
    }
    this.pending.push(request);
    if (!this.activeRequest) {
      this.showNext();
    }
  }

  showNext() {
    if (this.pending.length === 0) {
      this.activeRequest = null;
      this.hide();
      return;
    }

    this.activeRequest = this.pending.shift();
    this.renderRequest(this.activeRequest);
    this.show();
  }

  renderRequest(request) {
    const task = request.task || {};
    const title = document.getElementById('confirmTaskTitle');
    const hint = document.getElementById('confirmTaskHint');
    const taskId = document.getElementById('confirmTaskId');
    const type = document.getElementById('confirmTaskType');
    const creator = document.getElementById('confirmTaskCreator');
    const location = document.getElementById('confirmTaskLocation');
    const desc = document.getElementById('confirmTaskDesc');
    const actions = document.getElementById('confirmTaskActions');

    if (title) title.textContent = request.phase === 'manual_takeover' ? 'Manual Takeover Complete?' : 'Task Confirmation Required';
    if (hint) {
      hint.textContent = request.phase === 'manual_takeover'
        ? 'Confirm when the current manual subtask has been completed.'
        : 'Choose how to handle the current subtask.';
    }
    if (taskId) taskId.textContent = String(request.taskId || '-');
    // if (type) type.textContent = task.type || '-';
    if (type) type.textContent = getDisplayTaskTypeLabel(task) || '-';
    if (creator) creator.textContent = task.creator || '-';
    if (location) location.textContent = task.location || '-';
    if (desc) desc.textContent = task.description || task.desc || '-';
    if (actions) actions.innerHTML = request.actions.map(action => this.renderActionButton(action)).join('');
  }

  normalizeRequest(requestData) {
    const phase = String(requestData?.phase || 'confirm').trim() || 'confirm';
    const actions = Array.isArray(requestData?.actions) && requestData.actions.length > 0
      ? requestData.actions.map(action => String(action).trim()).filter(Boolean)
      : (phase === 'manual_takeover' ? ['continue', 'cancel'] : ['execute', 'takeover', 'cancel']);

    return {
      ...requestData,
      phase,
      actions
    };
  }

  renderActionButton(action) {
    const config = {
      execute: {
        label: 'Execute',
        className: 'bg-primary text-white hover:bg-primary/90'
      },
      takeover: {
        label: 'Take Over',
        className: 'bg-yellow-500 text-white hover:bg-yellow-600'
      },
      continue: {
        label: 'Continue',
        className: 'bg-primary text-white hover:bg-primary/90'
      },
      cancel: {
        label: 'Cancel',
        className: 'bg-gray-200 text-gray-700 hover:bg-gray-300'
      }
    };
    const item = config[action] || {
      label: action,
      className: 'bg-gray-200 text-gray-700 hover:bg-gray-300'
    };

    return `
      <button data-confirm-action="${this.escapeHtml(action)}" class="flex-1 px-4 py-2 ${item.className} text-sm font-medium rounded-md">
        ${this.escapeHtml(item.label)}
      </button>
    `;
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  show() {
    if (!this.modal) return;
    this.modal.classList.remove('hidden');
    this.modal.classList.add('flex');
  }

  hide() {
    if (!this.modal) return;
    this.modal.classList.add('hidden');
    this.modal.classList.remove('flex');
  }

  async decide(confirm) {
    if (!this.activeRequest || typeof this.onDecision !== 'function') return;
    const current = this.activeRequest;
    const action = String(confirm || '').trim();
    if (!action) return;

    try {
      await this.onDecision(current.taskId, action, current.phase);
      this.activeRequest = null;
      if (action === 'takeover') {
        this.setFloatingRequest({
          ...current,
          phase: 'manual_takeover',
          actions: ['continue', 'cancel']
        });
      }
      this.showNext();
    } catch (error) {
      this.show();
    }
  }

  setFloatingRequest(request) {
    this.floatingRequest = this.normalizeRequest(request);
    this.hide();
    this.showFloatingBall();
  }

  showFloatingBall() {
    if (!this.floatingBall) return;
    this.floatingBall.classList.remove('hidden');
    this.floatingBall.classList.add('flex');
    this.floatingBall.title = `Manual takeover in progress: ${this.floatingRequest?.taskId || ''}`;
  }

  hideFloatingBall() {
    if (!this.floatingBall) return;
    this.floatingBall.classList.add('hidden');
    this.floatingBall.classList.remove('flex');
  }

  openFloatingRequest() {
    if (!this.floatingRequest) return;
    this.activeRequest = this.floatingRequest;
    this.floatingRequest = null;
    this.hideFloatingBall();
    this.renderRequest(this.activeRequest);
    this.show();
  }
}
