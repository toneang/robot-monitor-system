export function getElements() {
  return {
    connectionStatus: document.getElementById("connectionStatus"),
    modeStatus: document.getElementById("modeStatus"),
    lastAction: document.getElementById("lastAction"),
    basePose: document.getElementById("basePose"),
    keymapGrid: document.getElementById("keymapGrid"),
  };
}

export function setConnectionState(els, text, className) {
  els.connectionStatus.textContent = text;
  els.connectionStatus.classList.remove("ok", "warning", "error");
  els.connectionStatus.classList.add(className);
}

export function buildKeymapUI(els, keymap) {
  const keyRowRefs = new Map();
  Object.entries(keymap).forEach(([key, info]) => {
    const row = document.createElement("div");
    row.className = "key-row";
    row.dataset.key = key;
    row.innerHTML = `
      <span class="keycap">${key.toUpperCase()}</span>
      <span class="desc">${info.label}</span>
      <span class="action">${info.action}</span>
    `;
    els.keymapGrid.appendChild(row);
    keyRowRefs.set(key, row);
  });
  return keyRowRefs;
}

export function setInitialStatus(els) {
  els.lastAction.textContent = "等待按键 / Waiting...";
  els.basePose.textContent = "-";
}
