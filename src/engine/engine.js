// 交易引擎：账户、保证金、开平仓、止盈止损、爆仓、等级解锁
// P0 简化：无点差/滑点/隔夜利息（P1 加入），开平仓均按当前中间价成交
import { pairById, LOT } from '../market/pairs.js';

export const LEVELS = [
  { lv: 1, title: '见习交易员', maxLev: 10, pairs: ['EURUSD'], need: null },
  { lv: 2, title: '初级交易员', maxLev: 20, pairs: ['EURUSD', 'USDJPY'], need: { trades: 3 } },
  { lv: 3, title: '正式交易员', maxLev: 50, pairs: ['EURUSD', 'USDJPY', 'GBPUSD'], need: { trades: 8, profit: 200 }, advanced: true },
  { lv: 4, title: '资深交易员', maxLev: 100, pairs: ['*'], need: { trades: 15, profit: 600 }, advanced: true },
];

export const AUTOPROTECT = { slPips: 20, tpPips: 30 };

export class Engine {
  constructor(state) {
    this.cap = state.cap || 100; // 杠杆上限（战役模式可单独压低）
    this.s = state; // 即存档中的账户部分
  }

  static newState() {
    return {
      balance: 10000,
      level: 1,
      tradeCount: 0,
      wins: 0,
      totalPnl: 0,
      protectionLeft: 3, // 新手保护期：前 3 笔平仓交易
      posSeq: 1,
      positions: [],
      closed: [],
    };
  }

  get level() { return this.s.level; }
  maxLev() { return Math.min(LEVELS[this.level - 1].maxLev, this.cap); }
  isAdvanced() { return !!LEVELS[this.level - 1].advanced; }
  unlockedPairs() {
    const ps = LEVELS[this.level - 1].pairs;
    return ps.includes('*') ? null : ps; // null = 全部
  }
  isPairUnlocked(id) {
    const ps = this.unlockedPairs();
    return !ps || ps.includes(id);
  }

  // 保证金（美元）= 基础货币仓位折算美元 / 杠杆
  // 交叉盘（如 EUR/CHF）基础货币按其美元直盘（basePair）折算
  marginOf(pairId, units, lev, price, prices = null) {
    const cfg = pairById(pairId);
    if (cfg.base === 'USD') return units / lev;
    if (cfg.quote === 'USD') return (units * price) / lev;
    return (units * prices[cfg.basePair]) / lev;
  }

  // 浮动盈亏（美元）：直盘直接算；USD/JPY 等按现价折回美元；
  // 交叉盘盈亏为报价货币，按报价货币的美元直盘（quotePair）折算
  pnlOf(pos, price, prices = null) {
    const cfg = pairById(pos.pairId);
    const diff = (price - pos.entry) * pos.dir;
    if (cfg.quote === 'USD') return diff * pos.units;
    if (cfg.base === 'USD') return (diff * pos.units) / price;
    return (diff * pos.units) / prices[cfg.quotePair];
  }

  floating(pos, price, prices = null) { return this.pnlOf(pos, price, prices); }

  usedMargin() {
    return this.s.positions.reduce((m, p) => m + p.margin, 0);
  }

  equity(prices) {
    return this.s.balance + this.s.positions.reduce((sum, p) => sum + this.pnlOf(p, prices[p.pairId], prices), 0);
  }

  freeMargin(prices) {
    return this.equity(prices) - this.usedMargin();
  }

  // 自动保护的止损/止盈价
  // 由投入保证金金额反推手数（0.01 手步进，最低 0.01 手）
  // XXX/USD：金额 × 杠杆 ÷ 现价 = 基础货币量；USD/XXX：金额 × 杠杆
  lotsFromMoney(pairId, money, lev, price) {
    const cfg = pairById(pairId);
    const units = cfg.base === 'USD' ? money * lev : (money * lev) / price;
    return Math.max(0.01, Math.round((units / LOT) * 100) / 100);
  }

  autoSlTp(pairId, dir, entry) {
    const { pip } = pairById(pairId);
    const { slPips, tpPips } = AUTOPROTECT;
    return dir > 0
      ? { sl: entry - slPips * pip, tp: entry + tpPips * pip }
      : { sl: entry + slPips * pip, tp: entry - tpPips * pip };
  }

  open({ pairId, dir, units, lev, sl = null, tp = null }, price, prices) {
    if (!this.isPairUnlocked(pairId)) return { ok: false, err: 'locked' };
    if (lev > this.maxLev()) lev = this.maxLev();
    const cfg = pairById(pairId);
    const margin = this.marginOf(pairId, units, lev, price, prices);
    if (margin > this.freeMargin(prices) - 1e-9) return { ok: false, err: 'margin' };

    // 方向合法性：多头需 sl < 开仓价 < tp，空头相反
    const valid = (v, low, high) => v == null || (v > low && v < high);
    if (dir > 0) {
      if (!valid(sl, 0, price) || !valid(tp, price, Infinity)) return { ok: false, err: 'sltp' };
    } else {
      if (!valid(sl, price, Infinity) || !valid(tp, 0, price)) return { ok: false, err: 'sltp' };
    }

    const pos = {
      id: this.s.posSeq++,
      pairId,
      dir,
      units,
      lev,
      entry: price,
      margin,
      sl, tp,
      openedAt: Date.now(),
    };
    this.s.positions.push(pos);
    return { ok: true, pos };
  }

  close(id, price, reason, prices = null) {
    const i = this.s.positions.findIndex((p) => p.id === id);
    if (i < 0) return null;
    const pos = this.s.positions[i];
    const pnl = this.pnlOf(pos, price, prices);
    this.s.positions.splice(i, 1);
    this.s.balance += pnl;
    this.s.tradeCount++;
    if (pnl > 0) this.s.wins++;
    this.s.totalPnl += pnl;
    if (this.s.protectionLeft > 0) this.s.protectionLeft--;
    this.s.closed.unshift({
      pairId: pos.pairId, dir: pos.dir, units: pos.units,
      entry: pos.entry, exit: price, pnl, reason, t: Date.now(),
    });
    if (this.s.closed.length > 30) this.s.closed.length = 30;
    return { pnl, pos, reason, promotions: this._promote() };
  }

  // 止盈/止损触发检测（按触发价成交，P0 无滑点）+ 爆仓检测
  checkTick(pairId, price, prices) {
    const ev = [];
    for (const p of [...this.s.positions]) {
      if (p.pairId !== pairId) continue;
      if (p.sl != null && ((p.dir > 0 && price <= p.sl) || (p.dir < 0 && price >= p.sl))) {
        ev.push({ type: 'close', id: p.id, price: p.sl, reason: '止损' });
      } else if (p.tp != null && ((p.dir > 0 && price >= p.tp) || (p.dir < 0 && price <= p.tp))) {
        ev.push({ type: 'close', id: p.id, price: p.tp, reason: '止盈' });
      }
    }
    if (this.s.positions.length) {
      const um = this.usedMargin();
      if (um > 0 && this.equity(prices) <= um * 0.8) ev.push({ type: 'blowup' });
    }
    return ev;
  }

  // 爆仓：按当前价强平所有持仓
  liquidate(prices) {
    const results = [];
    for (const p of [...this.s.positions]) {
      results.push(this.close(p.id, prices[p.pairId], '爆仓', prices));
    }
    return results;
  }

  _promote() {
    const got = [];
    while (this.level < LEVELS.length) {
      const next = LEVELS[this.level];
      const { trades = 0, profit = 0 } = next.need || {};
      if (this.s.tradeCount >= trades && this.s.totalPnl >= profit) {
        this.s.level++;
        got.push(next);
      } else break;
    }
    return got;
  }
}
