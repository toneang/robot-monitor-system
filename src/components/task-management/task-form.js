import { generateUUID } from '../../utils/uuid.js';
import serialManager from '../../utils/serial.js';
import taskService from '../../services/task.service.js';
import { authService } from '../../services/auth.service.js';
import eventBus from '../../core/event-bus.js';
import { graphService } from '../../services/graph.service.js';
import { DateTimePicker } from './datetime-picker.js';
import { resolveBackendTaskModel } from '../../utils/task-type.js';

/**
 * 任务表单组件
 */
export class TaskForm {
  constructor(formElement) {
    this.form = formElement;
    this.init();
  }
  
  init() {
    this.form.addEventListener('submit', this.handleSubmit.bind(this));

    // Initialize custom datetime picker (past times greyed out)
    const taskTimeInput = document.getElementById('taskTime');
    if (taskTimeInput) {
      this.dateTimePicker = new DateTimePicker(taskTimeInput);
    }

    const taskTypeSelect = document.getElementById('taskType');
    const taskModelSelect = document.getElementById('taskModel');
    if (taskTypeSelect) {
      taskTypeSelect.addEventListener('change', this.updateUseMemoryState.bind(this));
    }
    if (taskModelSelect) {
      taskModelSelect.addEventListener('change', this.updateUseMemoryState.bind(this));
    }
    this.updateUseMemoryState();
  }
  
  async handleSubmit(e) {
    e.preventDefault();

    const taskType = document.getElementById('taskType').value;
    const taskModel = document.getElementById('taskModel')?.value || 'random';
    const taskDesc = document.getElementById('taskDesc').value;
    const taskLocation = document.getElementById('taskLocation').value;
    const taskTime = this.dateTimePicker ? this.dateTimePicker.getValue() : '';
    /*
    const useMemory = document.getElementById('useMemory').checked ? 1 : 0;

    let resolvedTaskType = taskType;
    let resolvedUseMemory = useMemory;

    if (taskType === 'random') {
      const randomOptions = [
        { type: 'rule', useMemory: 0 },
        { type: 'custom', useMemory: 0 },
        { type: 'custom', useMemory: 1 }
      ];
      const selectedOption = randomOptions[Math.floor(Math.random() * randomOptions.length)];
      resolvedTaskType = selectedOption.type;
      resolvedUseMemory = selectedOption.useMemory;
    }
    */

    const { type: resolvedTaskType, useMemory: resolvedUseMemory } = resolveBackendTaskModel(taskModel);
    const resolvedTaskModel = resolvedUseMemory === 1
      ? 'memory'
      : (resolvedTaskType === 'rule' ? 'rule' : 'vlm');
    const resolvedModelSelection = resolvedUseMemory === 1
      ? 'vlm+mem'
      : (resolvedTaskType === 'rule' ? 'rule' : 'vlm');

    // 获取选中的优先级
    let priority = 'low';
    document.querySelectorAll('input[name="priority"]').forEach(radio => {
      if (radio.checked) priority = radio.value;
    });

    // 验证必填字段
    if (!taskType || !taskDesc) {
      this.showError('Please fill in the required fields');
      return;
    }

    const submitBtn = this.form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;

    // 防止重复提交
    if (submitBtn.disabled) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin mr-2"></i>Submitting...';

    const taskId = generateUUID();
    const createTime = new Date().toLocaleString();
    const serial = serialManager.set(taskId, serialManager.getNext());

    const currentUser = authService.getUser();

    // 获取用户个性化信息
    let userPreferenceSummary = '';
    if (currentUser && currentUser.username) {
      try {
        const profileData = await graphService.getProfileTags(currentUser.username);
        if (profileData && profileData.user_performance_summary) {
          userPreferenceSummary = profileData.user_performance_summary;
        }
        // 打印
        console.log('userPreferenceSummary', userPreferenceSummary)
      } catch (error) {
        console.warn('Failed to fetch user preference summary:', error);
        // Do not block task creation, just the personalized information is empty
      }
    }

    // 获取机器人画像信息
    let robotProfileSummary = '';
    try {
      const robotProfileData = await graphService.getRobotProfileTags("office_robot");
      if (robotProfileData) {
        // Extract key information to build the robot profile summary
        const parts = [];

        if (robotProfileData.performance_summary) {
          parts.push(`Performance: ${robotProfileData.performance_summary}`);
        }

        if (robotProfileData.ability_level && robotProfileData.ability_level.length > 0) {
          const topAbility = robotProfileData.ability_level[0];
          parts.push(`Ability: ${topAbility.name} (${(topAbility.confidence * 100).toFixed(0)}%)`);
        }

        if (robotProfileData.specialization && robotProfileData.specialization.length > 0) {
          const specs = robotProfileData.specialization.map(s => s.name).join(', ');
          parts.push(`Specializes in: ${specs}`);
        }

        robotProfileSummary = parts.join('; ');
      }
      console.log('robotProfileSummary', robotProfileSummary);
    } catch (error) {
      console.warn('Failed to fetch robot profile summary:', error);
      // 不阻塞任务创建，只是机器人画像信息为空
    }

    const payload = {
      id: taskId,
      type: resolvedTaskType,
      description: taskDesc,
      location: taskLocation || 'unspecified',
      priority: priority,
      execute_time: taskTime || '',
      use_memory: resolvedUseMemory,
      model: resolvedTaskModel,
      display_type: taskType,
      model_selection: resolvedModelSelection,
      status: 'submitting',
      create_time: createTime,
      creator: currentUser ? currentUser.username : 'Unknown',
      user_preference_summary: userPreferenceSummary,
      robot_profile_summary: robotProfileSummary
    };
    
    try {
      // 触发事件，让UI先渲染
      console.log(`[TaskForm] 派发任务创建事件，任务ID: ${taskId}，状态: submitting`);
      eventBus.emit('task:created', payload);
      
      // 提交到后端
      console.log(`[TaskForm] 开始提交任务到后端...`);
      await taskService.createTask(payload);
      
      // 重置表单
      this.form.reset();
      if (this.dateTimePicker) this.dateTimePicker.reset();
      this.updateUseMemoryState();

      // 更新状态为pending
      console.log(`[TaskForm] 任务创建成功，更新状态为 pending`);
      eventBus.emit('task:status-update', { taskId, status: 'pending' });
      
      this.showSuccess('任务创建成功');
    } catch (error) {
      console.error(`[TaskForm] 任务创建失败:`, error);
      this.showError('网络错误，请检查后端连接');
      eventBus.emit('task:status-update', { taskId, status: 'failed' });
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  }
  
  updateUseMemoryState() {
    const taskTypeSelect = document.getElementById('taskType');
    const taskModelSelect = document.getElementById('taskModel');
    const taskModelHint = document.getElementById('taskModelHint');

    /*
    const useMemoryInput = document.getElementById('useMemory');
    const useMemoryHint = document.getElementById('useMemoryHint');

    if (!taskTypeSelect || !useMemoryInput) return;

    const isRandom = taskTypeSelect.value === 'random';
    useMemoryInput.disabled = isRandom;

    if (isRandom) {
      useMemoryInput.checked = false;
      useMemoryInput.parentElement.classList.add('opacity-50', 'cursor-not-allowed');
      if (useMemoryHint) useMemoryHint.classList.remove('hidden');
      return;
    }

    useMemoryInput.parentElement.classList.remove('opacity-50', 'cursor-not-allowed');
    if (useMemoryHint) useMemoryHint.classList.add('hidden');
    */

    if (!taskTypeSelect || !taskModelSelect || !taskModelHint) return;

    const hintMap = {
      '': 'Choose a model. Backend mapping: random -> randomly choose rule/custom/custom + memory, vlm -> custom, rule -> rule, vlm-mem -> custom + memory.',
      random: 'Backend mapping: randomly choose rule/custom/custom + memory',
      vlm: 'Backend mapping: custom',
      rule: 'Backend mapping: rule',
      'vlm-mem': 'Backend mapping: custom + memory'
    };

    taskModelHint.textContent = hintMap[taskModelSelect.value] || hintMap.random;
  }

  showError(message) {
    alert(message);
  }
  
  showSuccess(message) {
    // 创建 Toast 元素
    const toast = document.createElement('div');
    toast.className = 'fixed top-20 right-4 z-50 bg-white border-l-4 border-green-500 shadow-lg rounded-r-lg p-4 flex items-center transition-all duration-500 transform translate-x-full';
    toast.innerHTML = `
      <div class="text-green-500 mr-3">
        <i class="fa fa-check-circle text-xl"></i>
      </div>
      <div>
        <h4 class="font-bold text-gray-800 text-sm">Success</h4>
        <p class="text-sm text-gray-600">${message}</p>
      </div>
    `;
    
    document.body.appendChild(toast);
    
    // 强制重绘以触发动画
    requestAnimationFrame(() => {
      toast.classList.remove('translate-x-full');
    });

    // 3秒后自动消失
    setTimeout(() => {
      toast.classList.add('translate-x-full', 'opacity-0');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 500); // 等待淡出动画结束
    }, 3000);
  }
}
