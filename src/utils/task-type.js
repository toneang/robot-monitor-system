// 把任务类型转换成前端显示类型
// 把模型选择转换成后端真正需要的参数
const DISPLAY_TASK_TYPE_LABELS = {
  find: 'find',
  notify: 'notify',
  inspect: 'inspect',
  deliver: 'deliver'
};

const BACKEND_TYPE_TO_DISPLAY_TYPE = {
  find: 'find',
  find_person: 'notify',
  pick_up: 'find',
  place: 'deliver',
  deliver: 'deliver',
  check: 'inspect',
  inspect: 'inspect',
  navigate_to_point: 'inspect',
  custom: 'find',
  rule: 'find',
  random: 'find'
};
// 如果任务没有明确 type，或者 type 映射不上，就会根据 description 文本内容猜类型
const DISPLAY_TASK_TYPE_PATTERNS = [
  {
    code: 'notify',
    pattern: /(notify|inform|tell|remind)/i
  },
  {
    code: 'inspect',
    pattern: /(inspect|check|patrol|scan|environment)/i
  },
  {
    code: 'deliver',
    pattern: /(deliver|bring|give|send|take.*to)/i
  }
];

const MODEL_TO_BACKEND_MAPPING = {
  vlm: {
    key: 'vlm',
    type: 'custom',
    useMemory: 0
  },
  rule: {
    key: 'rule',
    type: 'rule',
    useMemory: 0
  },
  'vlm-mem': {
    key: 'vlm-mem',
    type: 'custom',
    useMemory: 1
  }
};

const RANDOM_BACKEND_MODEL_OPTIONS = [
  {
    key: 'rule',
    type: 'rule',
    useMemory: 0
  },
  {
    key: 'vlm',
    type: 'custom',
    useMemory: 0
  },
  {
    key: 'vlm-mem',
    type: 'custom',
    useMemory: 1
  }
];

const RANDOM_MODEL_BAG_STORAGE_KEY = 'robot_monitor_random_model_bag_v1';
let randomModelBagCache = null;

export function getDisplayTaskTypeLabel(taskOrType, description = '') {
  const type = typeof taskOrType === 'object' && taskOrType !== null ? taskOrType.type : taskOrType;
  const taskDescription = typeof taskOrType === 'object' && taskOrType !== null
    ? (taskOrType.description || description || '')
    : description;
  const explicitDisplayType = typeof taskOrType === 'object' && taskOrType !== null
    ? (taskOrType.display_type || taskOrType.displayType || '')
    : '';

  const resolvedDisplayType = normalizeDisplayTaskType(explicitDisplayType)
    || inferDisplayTaskType(type, taskDescription);

  return DISPLAY_TASK_TYPE_LABELS[resolvedDisplayType] || DISPLAY_TASK_TYPE_LABELS.find;
}

export function normalizeDisplayTaskType(displayType) {
  const normalized = String(displayType || '').trim().toLowerCase();
  if (!normalized) return '';

  if (normalized === 'find') return 'find';
  if (normalized === 'deliver') return 'deliver';
  if (normalized === 'notify') return 'notify';
  if (normalized === 'inspect') return 'inspect';

  return '';
}
// 平衡随机
// 用一个“bag”机制：
//   先拿一个 bag（袋子）
//   从袋子里取第一个 model
//   取完就从 bag 里移除
//   bag 空了再重新洗牌生成
// 这样能保证 3 个候选模型都会轮到，不会连续很多次都抽中同一个。
export function resolveBackendTaskModel(modelValue) {
  if (modelValue === 'random') {
    return drawBalancedRandomBackendModel();
  }

  return MODEL_TO_BACKEND_MAPPING[modelValue] || RANDOM_BACKEND_MODEL_OPTIONS[0];
}

function drawBalancedRandomBackendModel() {
  let bag = getRandomModelBag();
  if (!bag.length) {
    bag = createShuffledRandomModelBag();
  }

  const selectedKey = bag[0];
  setRandomModelBag(bag.slice(1));

  return RANDOM_BACKEND_MODEL_OPTIONS.find(option => option.key === selectedKey) || RANDOM_BACKEND_MODEL_OPTIONS[0];
}

function createShuffledRandomModelBag() {
  const bag = RANDOM_BACKEND_MODEL_OPTIONS.map(option => option.key);

  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }

  return bag;
}

function getRandomModelBag() {
  if (Array.isArray(randomModelBagCache)) {
    return [...randomModelBagCache];
  }

  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      randomModelBagCache = [];
      return [];
    }

    const stored = window.localStorage.getItem(RANDOM_MODEL_BAG_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    const validKeys = new Set(RANDOM_BACKEND_MODEL_OPTIONS.map(option => option.key));
    const sanitized = Array.isArray(parsed)
      ? parsed.filter(key => validKeys.has(key))
      : [];

    randomModelBagCache = sanitized;
    return [...sanitized];
  } catch (_error) {
    randomModelBagCache = [];
    return [];
  }
}

function setRandomModelBag(bag) {
  const nextBag = Array.isArray(bag) ? [...bag] : [];
  randomModelBagCache = nextBag;

  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    if (nextBag.length) {
      window.localStorage.setItem(RANDOM_MODEL_BAG_STORAGE_KEY, JSON.stringify(nextBag));
    } else {
      window.localStorage.removeItem(RANDOM_MODEL_BAG_STORAGE_KEY);
    }
  } catch (_error) {
    // Ignore storage failures and keep the in-memory bag as best effort.
  }
}

function inferDisplayTaskType(type, description) {
  const normalizedType = String(type || '').trim().toLowerCase();
  if (normalizedType && BACKEND_TYPE_TO_DISPLAY_TYPE[normalizedType]) {
    return BACKEND_TYPE_TO_DISPLAY_TYPE[normalizedType];
  }

  const normalizedDescription = String(description || '').trim();
  for (const candidate of DISPLAY_TASK_TYPE_PATTERNS) {
    if (candidate.pattern.test(normalizedDescription)) {
      return candidate.code;
    }
  }

  return 'find';
}
