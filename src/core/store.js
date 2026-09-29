// localStorage 存档：JSON 读写 + 清档
const KEY = 'forextale_save_v1';

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && obj.v === 1 ? obj : null;
  } catch {
    return null;
  }
}

export function writeSave(obj) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
    return true;
  } catch {
    return false; // 隐身模式/容量满时静默失败，游戏照常进行
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
