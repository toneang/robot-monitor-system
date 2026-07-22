import apiService from '../../services/api.service.js';
import eventBus from '../../core/event-bus.js';
import { authService } from '../../services/auth.service.js';
import { getDisplayTaskTypeLabel } from '../../utils/task-type.js';

/**
 * 评分弹窗组件
 */
export class RatingModal {
  constructor() {
    this.modal = document.getElementById('ratingModal');
    this.allStars = document.querySelectorAll('[data-category]');
    this.commentInput = document.getElementById('ratingComment');
    this.expectationInput = document.getElementById('ratingExpectation');
    this.submitBtn = document.getElementById('submitRatingBtn');
    this.skipBtn = document.getElementById('skipRatingBtn');
    this.taskTypeEl = document.getElementById('ratingTaskType');
    this.taskDescriptionEl = document.getElementById('ratingTaskDescription');
    this.executionLogEntries = document.getElementById('executionLogEntries');

    this.categories = ['personalization', 'functional', 'personalized', 'intent', 'completion', 'improvement'];
    this.currentRatings = {};
    this.currentTaskId = null;
    this.isEditMode = false;
    this.skippedTaskIds = new Set();
    this.taskDetailRequestId = 0;

    this.init();
  }

  init() {
    if (!this.modal) return;

    // 初始化各分类评分
    this.categories.forEach(cat => {
      this.currentRatings[cat] = 0;
    });

    // 星星点击事件
    this.allStars.forEach(star => {
      star.addEventListener('click', () => {
        const category = star.dataset.category;
        const rating = parseInt(star.dataset.rating);
        this.setRating(category, rating);
      });

      // 鼠标悬停效果
      star.addEventListener('mouseenter', () => {
        const category = star.dataset.category;
        const rating = parseInt(star.dataset.rating);
        this.highlightStars(category, rating);
      });

      star.addEventListener('mouseleave', () => {
        const category = star.dataset.category;
        this.highlightStars(category, this.currentRatings[category]);
      });
    });

    // 提交按钮
    this.submitBtn.addEventListener('click', this.submitRating.bind(this));

    // 跳过按钮
    this.skipBtn.addEventListener('click', () => this.close(true));
  }

  /**
   * 打开评分弹窗
   */
  open(taskId, existingRating = null) {
    // 如果弹窗已打开且是同一个任务，不重复初始化（防止轮询重复触发时清空已填写的内容）
    if (this.currentTaskId === taskId && !this.modal.classList.contains('hidden')) {
      return;
    }
    // 如果该任务已跳过，不再弹出
    if (!existingRating && this.skippedTaskIds.has(taskId)) {
      return;
    }
    this.currentTaskId = taskId;
    this.isEditMode = !!existingRating;
    this.resetForm(existingRating);
    this.renderTaskTypeDetail(null, true);
    this.updateSubmitButtonLabel();
    this.modal.classList.remove('hidden');
    this.loadTaskTypeDetail(taskId);
  }

  /**
   * 手动打开（从"添加问卷"按钮调用，跳过 skip 检查）
   */
  openManually(taskId, existingRating = null) {
    this.skippedTaskIds.delete(taskId);
    this.open(taskId, existingRating);
  }

  resetForm(existingRating = null) {
    this.categories.forEach(cat => {
      this.currentRatings[cat] = 0;
      this.highlightStars(cat, 0);
    });
    this.commentInput.value = '';
    this.expectationInput.value = 'yes';

    if (existingRating) {
      this.prefillRating(existingRating);
    }
  }

  prefillRating(rating) {
    const fieldMap = {
      personalization: 'personalization_level',
      functional: 'score_functional_correctness',
      personalized: 'score_personalized_correctness',
      intent: 'score_intent_understanding',
      completion: 'score_auto_completion',
      improvement: 'score_robot_improvement'
    };

    Object.entries(fieldMap).forEach(([category, field]) => {
      const score = Number(rating[field] || 0);
      if (score >= 1 && score <= 5) {
        this.setRating(category, score);
      }
    });

    this.commentInput.value = rating.comment || '';
    this.expectationInput.value = rating.expectation || 'yes';
  }

  updateSubmitButtonLabel() {
    if (!this.submitBtn) return;
    this.submitBtn.innerText = this.isEditMode ? 'Update Feedback' : 'Submit Feedback';
  }

  /**
   * 关闭评分弹窗
   */
  close(skipRecord = true) {
    // 只有用户点"跳过"时才记录，提交成功后关闭不记录
    if (skipRecord && this.currentTaskId) {
      this.skippedTaskIds.add(this.currentTaskId);
    }
    this.modal.classList.add('hidden');
    this.renderTaskTypeDetail(null, false);
    this.currentTaskId = null;
    this.isEditMode = false;
    this.updateSubmitButtonLabel();
  }

  async loadTaskTypeDetail(taskId) {
    const requestId = ++this.taskDetailRequestId;

    try {
      const task = await apiService.getTaskDetail(taskId);
      if (requestId !== this.taskDetailRequestId || this.currentTaskId !== taskId) {
        return;
      }

      this.renderTaskTypeDetail(task, false);
    } catch (error) {
      console.warn(`Failed to load rating task detail for ${taskId}:`, error);
      if (requestId !== this.taskDetailRequestId || this.currentTaskId !== taskId) {
        return;
      }

      this.renderTaskTypeDetail({
        id: taskId,
        type: '',
        display_type: '',
        description: ''
      }, false);
    }
  }

  renderTaskTypeDetail(task, loading = false) {
    if (!this.taskTypeEl || !this.taskDescriptionEl) {
      return;
    }

    if (loading) {
      this.taskTypeEl.textContent = 'Loading...';
      this.taskDescriptionEl.textContent = '-';
      return;
    }

    if (!task) {
      this.taskTypeEl.textContent = '-';
      this.taskDescriptionEl.textContent = '-';
      return;
    }

    const displayType = getDisplayTaskTypeLabel(task) || '-';
    const description = String(task.description || task.desc || '').trim() || '-';

    this.taskTypeEl.textContent = displayType;
    this.taskDescriptionEl.textContent = description;
    this.renderExecutionLog(task);
  }

  renderExecutionLog(task) {
    if (!this.executionLogEntries) return;

    let logEntries = [];
    if (task && task.execution_log) {
      try {
        logEntries = typeof task.execution_log === 'string'
          ? JSON.parse(task.execution_log)
          : task.execution_log;
      } catch (e) {
        logEntries = [];
      }
    }

    if (!logEntries.length) {
      this.executionLogEntries.innerHTML = '<p class="text-gray-400 italic text-xs">No execution data available</p>';
      return;
    }

    this.executionLogEntries.innerHTML = logEntries.map(entry => {
      const time = entry.timestamp || '';
      const status = entry.status || 'unknown';
      const message = entry.message || '';
      const borderColor = this.getLogStatusColor(status);
      const badgeClass = this.getLogStatusBadge(status);
      return `
        <div class="border-l-2 ${borderColor} pl-2 py-1">
          <div class="text-gray-400 text-[10px]">${time}</div>
          <span class="inline-block px-1 py-0.5 rounded text-[10px] font-medium ${badgeClass}">${status}</span>
          <div class="text-gray-600 mt-0.5">${message}</div>
        </div>
      `;
    }).join('');
  }

  getLogStatusColor(status) {
    const map = {
      pending: 'border-gray-300',
      executing: 'border-blue-400',
      processing: 'border-blue-400',
      running: 'border-blue-400',
      paused: 'border-yellow-400',
      finished: 'border-green-400',
      completed: 'border-green-400',
      failed: 'border-red-400',
      fail: 'border-red-400',
    };
    return map[String(status).toLowerCase()] || 'border-gray-300';
  }

  getLogStatusBadge(status) {
    const map = {
      pending: 'bg-gray-100 text-gray-600',
      executing: 'bg-blue-100 text-blue-700',
      processing: 'bg-blue-100 text-blue-700',
      running: 'bg-blue-100 text-blue-700',
      paused: 'bg-yellow-100 text-yellow-700',
      finished: 'bg-green-100 text-green-700',
      completed: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700',
      fail: 'bg-red-100 text-red-700',
    };
    return map[String(status).toLowerCase()] || 'bg-gray-100 text-gray-600';
  }

  /**
   * 设置评分
   */
  setRating(category, rating) {
    this.currentRatings[category] = rating;
    this.highlightStars(category, rating);
  }

  /**
   * 高亮星星
   */
  highlightStars(category, count) {
    const stars = document.querySelectorAll(`[data-category="${category}"]`);
    stars.forEach(star => {
      const rating = parseInt(star.dataset.rating);
      if (rating <= count) {
        star.classList.remove('text-gray-300');
        star.classList.add('text-yellow-400');
      } else {
        star.classList.remove('text-yellow-400');
        star.classList.add('text-gray-300');
      }
    });
  }

  /**
   * 提交评分
   */
  async submitRating() {
    // 检查是否所有维度都已评分
    const unratedCategories = this.categories.filter(cat => this.currentRatings[cat] === 0);
    if (unratedCategories.length > 0) {
      alert(`Please rate all dimensions. Missing: ${unratedCategories.join(', ')}`);
      return;
    }

    const originalText = this.submitBtn.innerText;
    const wasEditMode = this.isEditMode;
    this.submitBtn.disabled = true;
    this.submitBtn.innerText = wasEditMode ? 'Updating...' : 'Submitting...';

    try {
      const user = authService.getUser();
      const data = {
        taskId: this.currentTaskId,
        personalization_level: this.currentRatings.personalization,
        score_functional_correctness: this.currentRatings.functional,
        score_personalized_correctness: this.currentRatings.personalized,
        score_intent_understanding: this.currentRatings.intent,
        score_auto_completion: this.currentRatings.completion,
        score_robot_improvement: this.currentRatings.improvement,
        comment: this.commentInput.value,
        expectation: this.expectationInput.value,
        submitted_by: user ? user.username : 'Anonymous',
        submitted_role: user ? user.role : 'user',
        submitted_at: new Date().toISOString()
      };

      // 调用API保存评分
      await apiService.rateTask(data);
      console.log('Rating submitted:', data);

      // 触发事件通知
      eventBus.emit('task:rated', data);

      this.close(false);
      alert(wasEditMode ? 'Feedback updated successfully!' : 'Thank you for your feedback!');

    } catch (error) {
      console.error('Failed to submit rating:', error);
      alert('Submission failed, please try again.');
    } finally {
      this.submitBtn.disabled = false;
      this.submitBtn.innerText = originalText;
    }
  }
}
