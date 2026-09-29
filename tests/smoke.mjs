// 冒烟测试：node tests/smoke.mjs（无依赖，直接跑引擎/行情/存档的纯逻辑）
import assert from 'node:assert/strict';

// store.js 用到 localStorage，先打桩再动态 import
globalThis.localStorage = {
  _m: {},
  getItem(k) { return this._m[k] ?? null; },
  setItem(k, v) { this._m[k] = String(v); },
  removeItem(k) { delete this._m[k]; },
};

const { Prng } = await import('../src/core/prng.js');
const { SimMarket, TICKS_PER_CANDLE } = await import('../src/market/sim.js');
const { Engine, LEVELS } = await import('../src/engine/engine.js');
const { PAIRS } = await import('../src/market/pairs.js');
const { loadSave, writeSave, clearSave } = await import('../src/core/store.js');

let n = 0;
const ok = (name) => console.log(`  ✓ ${name} (#${++n})`);

/* 1. PRNG 确定性与状态续接 */
{
  const a = new Prng(42), b = new Prng(42);
  const s1 = Array.from({ length: 5 }, () => a.next());
  const s2 = Array.from({ length: 5 }, () => b.next());
  assert.deepEqual(s1, s2);
  const c = new Prng(0, b.state); // 从 b 的状态续接
  assert.equal(a.next(), c.next());
  assert.equal(a.next(), c.next());
  ok('PRNG：同种子序列一致，状态可序列化续接');
}

/* 2. 行情：确定性 + OHLC 合法性 */
{
  const run = () => {
    const m = new SimMarket();
    m.init(7);
    for (let i = 0; i < TICKS_PER_CANDLE * 60; i++) m.step(); // 60 根 K 线
    return m.st.EURUSD.candles.map((c) => c.slice());
  };
  const r1 = run(), r2 = run();
  assert.deepEqual(r1, r2);
  assert.equal(r1.length, 60);
  for (const [o, h, l, c] of r1) {
    assert.ok(h >= Math.max(o, c) - 1e-12, 'high >= max(open,close)');
    assert.ok(l <= Math.min(o, c) + 1e-12, 'low <= min(open,close)');
    for (const v of [o, h, l, c]) assert.ok(Number.isFinite(v) && v > 0);
  }
  ok(`行情：同种子完全可复现，60 根 K 线 OHLC 合法（末价 ${r1[59][3].toFixed(5)}）`);
}

/* 3. 引擎：EUR/USD 做多盈亏与保证金 */
{
  const e = new Engine(Engine.newState());
  const prices = { EURUSD: 1.0850 };
  const r = e.open({ pairId: 'EURUSD', dir: 1, units: 10000, lev: 10 }, 1.0850, prices);
  assert.ok(r.ok);
  assert.ok(Math.abs(e.usedMargin() - 1085) < 0.01, `margin=${e.usedMargin()}`);
  const c = e.close(r.pos.id, 1.0870, '手动平仓');
  assert.ok(Math.abs(c.pnl - 20) < 1e-9, `pnl=${c.pnl}`); // 20 点 × $1/点
  assert.ok(Math.abs(e.s.balance - 10020) < 1e-9);
  ok('引擎：EUR/USD 多单 0.1 手 10×，保证金 $1085，+20 点 = +$20');
}

/* 4. 引擎：USD/JPY 做空盈亏（按现价折算美元） */
{
  const e = new Engine(Engine.newState());
  e.s.level = 2; // USD/JPY 需 Lv.2 解锁
  const prices = { USDJPY: 149.5 };
  const r = e.open({ pairId: 'USDJPY', dir: -1, units: 10000, lev: 10 }, 149.5, prices);
  assert.ok(r.ok);
  const c = e.close(r.pos.id, 149.0, '止盈');
  assert.ok(Math.abs(c.pnl - 5000 / 149.0) < 1e-9, `pnl=${c.pnl}`);
  ok(`引擎：USD/JPY 空单 50 点 = $${c.pnl.toFixed(2)}（日元按现价折算）`);
}

/* 5. 止损触发 */
{
  const e = new Engine(Engine.newState());
  const prices = { EURUSD: 1.0850 };
  const r = e.open({ pairId: 'EURUSD', dir: 1, units: 10000, lev: 10, sl: 1.0830, tp: 1.0880 }, 1.0850, prices);
  const evs = e.checkTick('EURUSD', 1.0829, prices);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].reason, '止损');
  const c = e.close(evs[0].id, evs[0].price, evs[0].reason);
  assert.ok(Math.abs(c.pnl + 20) < 1e-9);
  ok('引擎：跌破止损价触发止损，−20 点 = −$20');
}

/* 6. 止盈触发（空头方向） */
{
  const e = new Engine(Engine.newState());
  const prices = { EURUSD: 1.0850 };
  const r = e.open({ pairId: 'EURUSD', dir: -1, units: 10000, lev: 10, sl: 1.0870, tp: 1.0820 }, 1.0850, prices);
  const evs = e.checkTick('EURUSD', 1.0819, prices);
  assert.equal(evs[0].reason, '止盈');
  ok('引擎：空头到价触发止盈');
}

/* 7. 保证金不足拒绝开仓 */
{
  const e = new Engine(Engine.newState());
  e.s.balance = 100;
  const prices = { EURUSD: 1.0850 };
  const r = e.open({ pairId: 'EURUSD', dir: 1, units: 10000, lev: 10 }, 1.0850, prices);
  assert.equal(r.ok, false);
  assert.equal(r.err, 'margin');
  ok('引擎：可用余额不足时拒绝开仓');
}

/* 8. 爆仓：权益 ≤ 已用保证金 × 80% */
{
  const e = new Engine(Engine.newState());
  e.s.balance = 2000;
  const prices = { EURUSD: 1.0850 };
  const r = e.open({ pairId: 'EURUSD', dir: 1, units: 15000, lev: 10 }, 1.0850, prices); // 保证金 1627.5
  assert.ok(r.ok);
  prices.EURUSD = 1.0850 - 0.047; // −470 点 → 亏 $705 → 权益 1295 < 80% 线（1302）
  const evs = e.checkTick('EURUSD', prices.EURUSD, prices);
  assert.ok(evs.some((x) => x.type === 'blowup'));
  e.liquidate(prices);
  assert.equal(e.s.positions.length, 0);
  assert.ok(Math.abs(e.s.balance - 1295) < 0.01, `balance=${e.s.balance}`);
  ok(`引擎：爆仓强平全部持仓，剩余权益 $${e.s.balance.toFixed(2)}`);
}

/* 9. 等级解锁与新手保护消耗 */
{
  const e = new Engine(Engine.newState());
  const prices = { EURUSD: 1.0850 };
  let promos = [];
  for (let i = 0; i < 3; i++) {
    const r = e.open({ pairId: 'EURUSD', dir: 1, units: 10000, lev: 10 }, 1.0850, prices);
    const c = e.close(r.pos.id, 1.0870, '止盈');
    promos = c.promotions;
    assert.equal(e.s.protectionLeft, 3 - (i + 1));
  }
  assert.equal(e.level, 2);
  assert.equal(promos.length, 1);
  assert.ok(promos[0].pairs.includes('USDJPY'));
  assert.equal(e.maxLev(), 20);
  assert.ok(e.isPairUnlocked('USDJPY') && !e.isPairUnlocked('GBPUSD'));
  ok(`等级：3 笔后升 Lv.2，解锁 USD/JPY、20×，保护期剩 ${e.s.protectionLeft} 单`);
}

/* 10. 等级上限 */
{
  const e = new Engine(Engine.newState());
  e.s.tradeCount = 99;
  e.s.totalPnl = 99999;
  e._promote();
  assert.equal(e.level, LEVELS.length);
  assert.equal(e.maxLev(), 100);
  assert.ok(e.isPairUnlocked('USDCHF')); // Lv.4 pairs = '*'
  ok('等级：条件全满足时升满级并解锁全部货币对');
}

/* 11. 存档读写与清档 */
{
  clearSave();
  assert.equal(loadSave(), null);
  const obj = { v: 1, seed: 123, balance: 8888, positions: [{ id: 1 }], market: { rngState: 7, pairs: {} } };
  assert.ok(writeSave(obj));
  const back = loadSave();
  assert.deepEqual(back, obj);
  clearSave();
  assert.equal(loadSave(), null);
  ok('存档：写入/读取 round-trip 一致，可清档');
}

/* 12. 行情 export/load 续跑 */
{
  const m = new SimMarket();
  m.init(99);
  for (let i = 0; i < TICKS_PER_CANDLE * 20; i++) m.step();
  const snapshot = m.export();
  const m2 = new SimMarket();
  m2.init(99);
  m2.load(snapshot);
  assert.deepEqual(m2.st.EURUSD.candles, m.st.EURUSD.candles);
  assert.ok(Number.isFinite(m2.last.EURUSD));
  const before = m2.last.EURUSD;
  for (let i = 0; i < TICKS_PER_CANDLE; i++) m2.step();
  assert.notEqual(m2.last.EURUSD, before);
  ok('行情：export/load 恢复 K 线与随机状态，可继续推进');
}

/* 13. 新手保护修饰生效 */
{
  const m = new SimMarket();
  m.init(5);
  m.modifier = { pairId: 'EURUSD', volMult: 0.55, drift: 0.00008 };
  let up = 0;
  const start = m.last.EURUSD;
  for (let i = 0; i < TICKS_PER_CANDLE * 120; i++) m.step(); // 漂移累计 +96 点，噪声 σ≈21 点
  const cs = m.st.EURUSD.candles;
  for (const [, , , c] of cs) if (c > start) up++;
  assert.ok(cs[cs.length - 1][3] > start, '保护期结束后价格应高于起点');
  assert.ok(up / cs.length > 0.55, `涨占比=${up}/${cs.length}`);
  ok(`行情：新手保护期漂移向上（末价 ${cs[cs.length - 1][3].toFixed(5)} > 起点，涨占比 ${Math.round(up / cs.length * 100)}%）`);
}

/* 14. 货币对配置完整性 */
{
  for (const p of PAIRS) {
    assert.ok(p.pip > 0 && p.vol > 0 && p.start > 0);
    assert.ok(Number.isInteger(p.digits));
    assert.ok(p.battleOnly || (p.unlockLv >= 1 && p.unlockLv <= 4));
  }
  ok(`货币对：${PAIRS.length} 个配置完整`);
}

/* 15. 交叉盘保证金与盈亏（EUR/CHF，战役用） */
{
  const e = new Engine(Engine.newState());
  e.s.level = 4; // EURCHF 为战役专用对，满级全解锁
  const prices = { EURCHF: 1.2000, EURUSD: 1.1700, USDCHF: 1.0000 };
  const r = e.open({ pairId: 'EURCHF', dir: -1, units: 20000, lev: 20 }, 1.2000, prices);
  assert.ok(r.ok, '交叉盘开仓');
  // 保证金 = 20000 × EURUSD 1.17 / 20 = $1,170
  assert.ok(Math.abs(e.usedMargin() - 1170) < 0.01, `margin=${e.usedMargin()}`);
  // 跌到 1.03：盈亏 CHF = (1.03 − 1.20) × (−1) × 20000 = 3,400 CHF
  const pnl = e.floating(r.pos, 1.0300, { EURCHF: 1.0300, USDCHF: 0.9000 });
  assert.ok(Math.abs(pnl - 3400 / 0.9) < 0.01, `pnl=${pnl}`);
  ok(`引擎：EUR/CHF 空单 0.2 手 20×，保证金 $1,170，黑天鹅浮盈 $${pnl.toFixed(0)}`);
}

/* 16. 战役回放：确定性 + 锚点吸附 + 长度 */
{
  const { BATTLES } = await import('../src/battle/battles.js');
  const { ReplayMarket, SUBTICKS } = await import('../src/battle/replay.js');
  const b = BATTLES[0];
  const run = () => {
    const m = new ReplayMarket(b);
    for (let i = 0; i < b.length * SUBTICKS; i++) m.step();
    return m.st[b.pairId].candles.map((c) => c.slice());
  };
  const c1 = run(), c2 = run();
  assert.deepEqual(c1, c2, '同种子回放完全一致');
  assert.equal(c1.length, b.length);
  for (const a of b.anchors) {
    assert.ok(Math.abs(c1[a.c][3] - a.p) < 1e-9, `锚点吸附 c=${a.c}`);
    assert.ok(c1[a.c][1] >= a.p - 1e-12 && c1[a.c][2] <= a.p + 1e-12, '锚点K线含锚价');
  }
  ok(`战役回放：${b.title} ${b.length} 根 K 线确定性重演，${b.anchors.length} 个史实锚点吸附`);
}

/* 17. 战役胜负判定 */
{
  const { BATTLES, judgeBattle } = await import('../src/battle/battles.js');
  const b = BATTLES[0];
  assert.equal(judgeBattle(b, b.capital * 1.06, false).grade, '胜利');
  assert.equal(judgeBattle(b, b.capital * 1.02, false).grade, '存活');
  assert.equal(judgeBattle(b, 800, true).grade, '爆仓');
  assert.equal(judgeBattle(b, 0, false).grade, '爆仓');
  ok('战役判定：胜利 / 存活 / 爆仓三档正确');
}

/* 18. 龙虎榜数据层：注册/改名/同步/排行 */
{
  const { openDb } = await import('../tools/db.mjs');
  const db = openDb(':memory:');
  const now = Date.now();
  const p1 = db.getOrCreatePlayer('token-aaaa-1111', '小明', now);
  assert.equal(p1.best, 10000, '新玩家初始 1 万');
  db.getOrCreatePlayer('token-aaaa-1111', '小明二代', now + 1); // 同 token 改名
  const s1 = db.sync('token-aaaa-1111', 10850, 4, now + 2);
  assert.equal(s1.best, 10850, '上报创出新高');
  const s2 = db.sync('token-aaaa-1111', 9300, 5, now + 3);
  assert.equal(s2.best, 10850, '回撤不降榜');
  assert.equal(s2.last, 9300, '记录当前权益');
  assert.equal(db.getPlayer('token-aaaa-1111').name, '小明二代', '改名生效');
  db.getOrCreatePlayer('token-bbbb-2222', '索罗斯门徒', now + 4);
  db.sync('token-bbbb-2222', 12345, 9, now + 5);
  db.getOrCreatePlayer('token-cccc-3333', '英镑猎手', now + 6);
  db.sync('token-cccc-3333', 10850, 2, now + 7); // 与小明并列
  const board = db.topFor(50, 'token-aaaa-1111');
  assert.equal(board[0].name, '索罗斯门徒');
  assert.equal(board[1].mine, true, '标记出我自己那一行');
  assert.equal(board[2].mine, false);
  assert.equal(db.rankOf(12345), 1);
  assert.equal(db.rankOf(10850), 2, '并列同分同名次');
  assert.equal(db.total(), 3);
  ok('龙虎榜：注册/改名/同步取最高/按最高资产从大到小排名 ✓');
}

/* 19. 金额 ⇄ 手数换算 */
{
  const e = new Engine(Engine.newState());
  // EUR/USD 1.0850：$1,000 保证金 10× → 单位 = 1000×10/1.085 ≈ 9216.6 → 0.09 手
  assert.equal(e.lotsFromMoney('EURUSD', 1000, 10, 1.0850), 0.09);
  // USD/JPY（基础货币是美元）：$1,000 × 10× = 10,000 单位 → 0.10 手
  assert.equal(e.lotsFromMoney('USDJPY', 1000, 10, 149.5), 0.10);
  // 极小金额保底 0.01 手
  assert.equal(e.lotsFromMoney('EURUSD', 5, 10, 1.0850), 0.01);
  // 反向验证：0.09 手 EUR/USD 的保证金 ≈ $977（≈ 1000，四舍五入损耗）
  const m = e.marginOf('EURUSD', 0.09 * 100000, 10, 1.0850);
  assert.ok(m > 900 && m <= 1000, `margin=${m}`);
  ok(`金额⇄手数换算：$1000 → 0.09 手 → 占用保证金 $${m.toFixed(0)}`);
}

console.log(`\n全部 ${n} 项冒烟测试通过 ✅`);
