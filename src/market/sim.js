// 种子化模拟行情：漂移制度切换 + 偶发冲击 + 新手保护修饰 + 剧情事件注入
// 每 150ms 一个子跳，10 个子跳合成一根 1.5s K 线；同一种子序列完全可复现
import { Prng } from '../core/prng.js';
import { PAIRS } from './pairs.js';

export const TICK_MS = 150;
export const TICKS_PER_CANDLE = 10;
const CANDLE_KEEP = 420; // 每对最多保留约 10 分钟历史
const SHOCK_P = 0.02;    // 每根 K 线的冲击概率

export class SimMarket {
  constructor() {
    this.prng = null;
    this.st = {};        // 每对：{ candles:[[o,h,l,c]...], drift, base(被裁剪数), tickN, shockTick }
    this.last = {};      // 每对最新价
    this.forming = {};   // 正在生成的 K 线
    this.aftermath = {}; // 事件余波：{ mult, left }
    this.modifier = null; // 新手保护：{ pairId, volMult, drift }
    this.onTick = null;
    this.onCandle = null;
    this._timer = null;
  }

  init(seed) {
    this.prng = new Prng(seed);
    this.st = {};
    this.last = {};
    this.forming = {};
    this.aftermath = {};
    for (const cfg of PAIRS) {
      this.st[cfg.id] = { candles: [], drift: 0, base: 0, tickN: 0, shockTick: 0 };
      this.last[cfg.id] = cfg.start;
    }
  }

  load(m) {
    this.prng = new Prng(0, m.rngState);
    this.st = {};
    this.last = {};
    this.forming = {};
    for (const cfg of PAIRS) {
      const s = m.pairs?.[cfg.id];
      this.st[cfg.id] = s
        ? { candles: s.candles, drift: s.drift, base: s.base, tickN: 0, shockTick: 0 }
        : { candles: [], drift: 0, base: 0, tickN: 0, shockTick: 0 };
      const cs = this.st[cfg.id].candles;
      this.last[cfg.id] = cs.length ? cs[cs.length - 1][3] : cfg.start;
    }
    this.aftermath = {};
  }

  export() {
    const pairs = {};
    for (const cfg of PAIRS) {
      const s = this.st[cfg.id];
      pairs[cfg.id] = { candles: s.candles, drift: s.drift, base: s.base };
    }
    return { rngState: this.prng.state, pairs };
  }

  start() {
    this.stop();
    this._timer = setInterval(() => this.step(), TICK_MS);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  series(pairId) {
    return this.st[pairId].candles;
  }

  // 剧情事件：立即跳变 + 一段高波动余波
  injectShock(pairId, pips, { volMult = 2.2, candles = 8 } = {}) {
    const cfg = PAIRS.find((p) => p.id === pairId);
    const jump = pips * cfg.pip;
    this.last[pairId] += jump;
    const f = this.forming[pairId];
    if (f) {
      f[3] = this.last[pairId];
      if (f[3] > f[1]) f[1] = f[3];
      if (f[3] < f[2]) f[2] = f[3];
    }
    this.aftermath[pairId] = { mult: volMult, left: candles };
    this.onTick?.(pairId, this.last[pairId]);
  }

  // 推进一个子跳（所有货币对）；测试也可直接调用
  step() {
    for (const cfg of PAIRS) this._advance(cfg);
  }

  _advance(cfg) {
    const id = cfg.id;
    const s = this.st[id];
    // 正在生成的 K 线统一用数组 [o,h,l,c]，与已提交 K 线同构
    if (!this.forming[id]) {
      const o = this.last[id];
      this.forming[id] = [o, o, o, o];
    }

    if (s.tickN === 0) {
      // 新 K 线：更新漂移制度，掷一次冲击
      s.drift = s.drift * 0.96 + this.prng.gauss() * cfg.vol * 0.15;
      s.drift = Math.max(-cfg.vol * 0.9, Math.min(cfg.vol * 0.9, s.drift));
      s.shockTick = this.prng.next() < SHOCK_P ? (this.prng.next() < 0.5 ? -1 : 1) * (3 + this.prng.next() * 5) : 0;
    }

    const am = this.aftermath[id];
    let volMult = am ? am.mult : 1;
    let drift = s.drift;
    if (this.modifier && this.modifier.pairId === id) {
      volMult *= this.modifier.volMult;
      drift = this.modifier.drift; // 新手保护期：覆盖漂移（温和趋势）
    }

    const step = drift / TICKS_PER_CANDLE + (cfg.vol * volMult) / Math.sqrt(TICKS_PER_CANDLE) * this.prng.gauss();
    let price = this.last[id] + step;
    if (s.tickN === 0 && s.shockTick) price += s.shockTick * cfg.vol * volMult;

    const f = this.forming[id];
    f[3] = price;
    if (price > f[1]) f[1] = price;
    if (price < f[2]) f[2] = price;
    this.last[id] = price;

    s.tickN++;
    if (s.tickN >= TICKS_PER_CANDLE) {
      s.candles.push(f);
      if (s.candles.length > CANDLE_KEEP) {
        s.candles.shift();
        s.base++;
      }
      s.tickN = 0;
      s.shockTick = 0;
      this.forming[id] = null;
      if (am) {
        am.left--;
        if (am.left <= 0) delete this.aftermath[id];
      }
      this.onCandle?.(id, f);
    }
    this.onTick?.(id, price);
  }
}
