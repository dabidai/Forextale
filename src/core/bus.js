// 极简事件总线：教程监听开平仓、UI 解耦都用它
const map = new Map();

export const bus = {
  on(ev, fn) {
    if (!map.has(ev)) map.set(ev, new Set());
    map.get(ev).add(fn);
    return () => bus.off(ev, fn);
  },
  off(ev, fn) {
    map.get(ev)?.delete(fn);
  },
  emit(ev, ...args) {
    for (const fn of map.get(ev) || []) fn(...args);
  },
};
