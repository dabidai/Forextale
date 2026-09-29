// 历史回放行情：按史实锚点确定性重演（同种子同序列），接口与 SimMarket 对齐
// 每根 K 线 battle.candleMs 毫秒，5 个子跳合成；锚点价位精确吸附，新闻随锚点触发
import { Prng } from '../core/prng.js';

export const SUBTICKS = 5;
const CANDLE_KEEP = 1200;

// 锚点间平滑插值 + 小幅乘性噪声，锚点价位强制吸附
export function buildPath(battle) {
  const prng = new Prng(battle.seed);
  const A = battle.anchors;
  const path = new Array(battle.length);
  let noise = 0;
  for (let i = 0; i < battle.length; i++) {
    let k = 0;
    while (k < A.length - 1 && A[k + 1].c <= i) k++;
    const a = A[k], b = A[Math.min(k + 1, A.length - 1)];
    let base = a.p;
    if (b !== a && i > a.c) {
      const t = Math.min(1, (i - a.c) / Math.max(1, b.c - a.c));
      const e = t * t * (3 - 2 * t); // smoothstep，避免折角
      base = a.p + (b.p - a.p) * e;
    }
    noise = noise * 0.92 + prng.gauss() * battle.vol;
    path[i] = Math.max(0.0001, base * (1 + noise));
  }
  for (const a of A) path[a.c] = a.p;
  return path;
}

export class ReplayMarket {
  constructor(battle) {
    this.battle = battle;
    this.pairId = battle.pairId;
    this.prng = new Prng(battle.seed ^ 0x9e3779b9); // 子跳噪声（与路径生成不同流，互不干扰）
    this.candleMs = battle.candleMs || 320; // 实时播放节奏：毫秒/根
    this.tickMs = Math.max(16, Math.round(this.candleMs / SUBTICKS));
    this.path = buildPath(battle);
    this.companionPaths = {};
    for (const [id, cfg] of Object.entries(battle.companion || {})) {
      this.companionPaths[id] = buildPath({ ...battle, anchors: cfg.anchors });
    }
    this.st = { [this.pairId]: { candles: [], drift: 0, base: 0, tickN: 0, shockTick: 0 } };
    this.forming = {};
    this.last = { [this.pairId]: this.path[0] };
    for (const id in this.companionPaths) this.last[id] = this.companionPaths[id][0];
    this.newsIdx = 0;
    this._timer = null;
    this.onTick = null;
    this.onCandle = null;
    this.onNews = null;
    this.onEnd = null;
  }

  start() {
    this.stop();
    this._timer = setInterval(() => this._step(), this.tickMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  step() { this._step(); } // 测试可手动推进

  series(pairId) { return this.st[pairId].candles; }

  // 全部相关品种的最新价（含交叉盘折算用的伴生直盘）
  prices() {
    const p = { [this.pairId]: this.last[this.pairId] };
    const i = Math.min(this.st[this.pairId].candles.length, this.path.length - 1);
    for (const id in this.companionPaths) p[id] = this.companionPaths[id][i];
    return p;
  }

  _step() {
    const st = this.st[this.pairId];
    if (!this.forming[this.pairId]) {
      const o = this.last[this.pairId] ?? this.path[0];
      this.forming[this.pairId] = [o, o, o, o];
    }
    const f = this.forming[this.pairId];
    const target = this.path[Math.min(st.candles.length, this.path.length - 1)];
    const t = (st.tickN + 1) / SUBTICKS;
    // 最后一个子跳精确落在目标价上（锚点吸附），其余子跳带微噪声
    const price = t >= 1
      ? target
      : f[0] + (target - f[0]) * t + this.prng.gauss() * this.battle.vol * 0.35;
    f[3] = price;
    if (price > f[1]) f[1] = price;
    if (price < f[2]) f[2] = price;
    this.last[this.pairId] = price;

    st.tickN++;
    if (st.tickN >= SUBTICKS) {
      st.candles.push(f);
      if (st.candles.length > CANDLE_KEEP) {
        st.candles.shift();
        st.base++;
      }
      st.tickN = 0;
      this.forming[this.pairId] = null;

      const done = st.candles.length;
      while (this.newsIdx < this.battle.anchors.length && this.battle.anchors[this.newsIdx].c < done) {
        this.onNews?.(this.battle.anchors[this.newsIdx]);
        this.newsIdx++;
      }
      this.onCandle?.(this.pairId, f);
      if (done >= this.path.length) {
        this.stop();
        this.onEnd?.();
        return;
      }
    }
    this.onTick?.(this.pairId, price);
  }
}
