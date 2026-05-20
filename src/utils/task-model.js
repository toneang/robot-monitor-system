export function getTaskModelLabel(task) {
  const backendType = String(task?.type || '').trim().toLowerCase();
  const useMemory = String(task?.use_memory ?? task?.useMemory ?? '0').trim();

  if (useMemory === '1') {
    return 'vlm+mem';
  }
  if (backendType === 'rule') {
    return 'rule';
  }

  const normalizedSelection = String(task?.model_selection || task?.modelSelection || '').trim().toLowerCase();
  if (normalizedSelection === 'rule') {
    return 'rule';
  }
  if (normalizedSelection === 'vlm+mem' || normalizedSelection === 'vlm-mem') {
    return 'vlm+mem';
  }
  if (normalizedSelection === 'vlm') {
    return 'vlm';
  }

  const normalizedModel = String(task?.model || '').trim().toLowerCase();
  if (normalizedModel === 'memory') {
    return 'vlm+mem';
  }
  if (normalizedModel === 'rule') {
    return 'rule';
  }
  if (normalizedModel === 'vlm') {
    return 'vlm';
  }

  if (backendType === 'custom') {
    return 'vlm';
  }

  return 'vlm';
}
