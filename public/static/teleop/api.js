import { SHARED_CONFIG } from "../shared-config.js";

export function formatPose(basePose) {
  if (!Array.isArray(basePose)) {
    return "-";
  }
  return `[${basePose.map((v) => Number(v).toFixed(4)).join(", ")}]`;
}

export async function fetchTeleopState() {
  const res = await fetch(`${SHARED_CONFIG.robotUrl}/api/teleop/state`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function postTeleopAction(action) {
  const res = await fetch(`${SHARED_CONFIG.robotUrl}/api/teleop/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function fetchCurrentTasks() {
  const res = await fetch(`${SHARED_CONFIG.robotUrl}/api/task/current`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function controlTask(taskId, action) {
  const res = await fetch(`${SHARED_CONFIG.robotUrl}/api/task/control/${taskId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const payload = await res.json();
      detail = payload?.error || payload?.message || "";
    } catch (_err) {
      // Ignore JSON parse failure and fall back to HTTP code.
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
}

export async function stopRunningTasksForManualControl() {
  const tasks = await fetchCurrentTasks();
  const runningTask = tasks.find((task) =>
    ["executing", "running", "processing"].includes(String(task.status || "").toLowerCase())
  );

  if (runningTask?.id) {
    await controlTask(runningTask.id, "terminate");
  }

  const pendingTasks = tasks.filter(
    (task) => String(task.status || "").toLowerCase() === "pending" && task.id
  );
  await Promise.allSettled(pendingTasks.map((task) => controlTask(task.id, "pause")));
}
