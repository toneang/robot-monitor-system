import { KEYMAP } from "./keymap.js";
import {
  fetchTeleopState,
  formatPose,
  postTeleopAction,
  stopRunningTasksForManualControl,
} from "./api.js";
import {
  buildKeymapUI,
  getElements,
  setConnectionState,
  setInitialStatus,
} from "./ui.js";

export function createTeleopController() {
  const els = getElements();
  const keyRowRefs = buildKeymapUI(els, KEYMAP);
  const pendingActions = new Set();

  async function refreshState() {
    try {
      const data = await fetchTeleopState();
      setConnectionState(els, "已连接 / Connected", "ok");
      els.modeStatus.textContent = data.mode || "-";
    } catch (err) {
      setConnectionState(els, `连接失败 / ${err.message}`, "error");
    }
  }

  async function sendAction(action, key) {
    if (pendingActions.has(action)) {
      return;
    }
    pendingActions.add(action);

    const row = keyRowRefs.get(key);
    if (row) {
      row.classList.add("active");
    }

    try {
      try {
        await stopRunningTasksForManualControl();
      } catch (err) {
        const message = String(err?.message || "");
        const noCurrentTask =
          message.includes("当前任务为空") ||
          message.toLowerCase().includes("no current task") ||
          message.toLowerCase().includes("current task is empty");
        // if (!noCurrentTask) {
        //   throw err;
        // }
      }
      const data = await postTeleopAction(action);
      setConnectionState(els, "已连接 / Connected", "ok");
      els.lastAction.textContent = action;
      els.modeStatus.textContent = data.mode || "-";
      els.basePose.textContent = formatPose(data.base_pose);
    } catch (err) {
      setConnectionState(els, `控制失败 / ${err.message}`, "error");
    } finally {
      pendingActions.delete(action);
      setTimeout(() => {
        if (row) {
          row.classList.remove("active");
        }
      }, 160);
    }
  }

  function onKeyDown(event) {
    const key = event.key.toLowerCase();
    const mapping = KEYMAP[key];
    if (!mapping) {
      return;
    }
    event.preventDefault();
    sendAction(mapping.action, key);
  }

  function mount() {
    setInitialStatus(els);
    refreshState();
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("focus", refreshState);
  }

  return { mount };
}
