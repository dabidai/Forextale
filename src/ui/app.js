// 主装配：行情 → 引擎 → 图表/UI 的全部接线，存档调度，序章事件，PWA 注册
import { loadSave, writeSave, clearSave } from '../core/store.js';
import { bus } from '../core/bus.js';
import { PAIRS, pairById, LOT } from '../market/pairs.js';
import { SimMarket } from '../market/sim.js';
import { Engine, LEVELS } from '../engine/engine.js';
import { CandleChart } from '../chart/chart.js';
import { BATTLES, judgeBattle } from '../battle/battles.js';
import { ReplayMarket } from '../battle/replay.js';
import { initExplain } from './explain.js';
import { initLeaderboard, syncNow } from './leaderboard.js';
import { toast, showEventCard, showSettlement, showLiquidation, showLevelUp } from './toasts.js';
import { Tutorial } from './tutorial.js';

const $ = (id) => document.getElementById(id);
const fmtMoney = (v, sign = false) =>
  (sign && v > 0 ? '+' : v < 0 ? '−' : '') + '$' +
  Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const app = {
  save: null, engine: null, market: null, chart: null, tut: null,
  prices: {},        // 每对最新价
  prev: {},          // 上一跳价格（判涨跌色）
  pairId: 'EURUSD',
  lots: 0.2,
  lev: 10,
  sizing: 'money',   // 仓位模式：'money' 按金额 | 'lots' 按手数
  money: null,       // 按金额模式下的投入保证金（null = 首次从手数换算）
  candlesSeen: 0,    // 本次会话 EUR/USD K 线数（序章事件计时用）
  saveTick: 0,
  posRefs: new Map(),
  lastEquity: null,
  mode: null,        // 战役模式：{ battle, state }；null = 模拟盘
  simMarket: null,   // 战役期间寄存的模拟盘行情
  mainEngine: null,  // 战役期间寄存的主账户引擎
  battlePending: null,
  pendingEnd: false, // 战役爆仓后待结算
};

/* ---------- 新局与续档 ---------- */

function newGame() {
  const seed = (Math.random() * 4294967296) >>> 0;
  app.save = {
    v: 1, seed, startedAt: Date.now(),
    tutorial: { step: 0, done: false },
    prologueFired: false,
    settings: { autoProtect: true },
    market: null,
    ...Engine.newState(),
  };
  bootEngine(seed);
}

function resume(save) {
  app.save = save;
  bootEngine(save.seed);
  if (save.market) app.market.load(save.market);
}

function bootEngine(seed) {
  app.engine = new Engine(app.save);
  app.market = new SimMarket();
  app.market.init(seed);
}

function saveNow() {
  app.save.market = app.market.export();
  writeSave(app.save);
}

/* ---------- 行情接线 ---------- */

function wireMarket() {
  for (const cfg of PAIRS) app.prices[cfg.id] = app.market.last[cfg.id];

  app.market.onTick = (id, price) => {
    app.prices[id] = price;
    if (id === app.pairId) {
      app.chart.live = app.market.forming[id];
      app.chart.price = price;
      app.chart.lastDir = Math.sign(price - (app.prev[id] ?? price));
      app.chart.request();
      updatePriceUI(price);
    }
    app.prev[id] = price;
    updatePosLive();

    // 引擎结算：止盈/止损/爆仓
    for (const ev of app.engine.checkTick(id, price, app.prices)) {
      if (ev.type === 'close') {
        const r = app.engine.close(ev.id, ev.price, ev.reason, app.prices);
        if (r) onClosed(r);
      } else if (ev.type === 'blowup') {
        const results = app.engine.liquidate(app.prices);
        const lost = results.reduce((s, r) => s + r.pnl, 0);
        renderPositions(); renderHistory(); updateMoney();
        showLiquidation({ lost, left: app.save.balance });
        for (const r of results) for (const p of r.promotions) onLevelUp(p);
        saveNow();
        bus.emit('trade:closed', { pnl: lost, reason: '爆仓' });
      }
    }
    updateMoney();
  };

  app.market.onCandle = (id) => {
    if (id === 'EURUSD') app.candlesSeen++;
    if (id === app.pairId) app.chart.request();
    if (++app.saveTick >= 4) { app.saveTick = 0; saveNow(); }
    if (app.saveTick % 2 === 0 && !inBattle()) syncNow(); // 约 3 秒一次实时榜心跳
    updateMarginEst();
    renderSize();
    prologueCheck();
  };
}

function prologueCheck() {
  const s = app.save;
  if (s.prologueFired || !s.tutorial.done || app.candlesSeen < 12) return;
  s.prologueFired = true;
  app.market.injectShock('EURUSD', 55, { volMult: 2.2, candles: 8 });
  showEventCard({
    tag: '突发 · 剧情',
    title: '美联储意外降息 50 基点',
    body: '市场完全没料到这个幅度。降息削弱美元资产的吸引力，美元应声走弱——EUR/USD 几秒内跳涨，这就是「消息行情」。手里拿着多单的玩家，现在正在偷着乐。',
  });
  saveNow();
}

/* ---------- 资金与价格展示 ---------- */

function updateMoney() {
  const eq = app.engine.equity(app.prices);
  const el = $('equityVal');
  el.textContent = fmtMoney(eq);
  if (app.lastEquity != null && eq !== app.lastEquity) {
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(eq > app.lastEquity ? 'flash-up' : 'flash-down');
  }
  app.lastEquity = eq;
  $('balanceVal').textContent = fmtMoney(app.engine.s.balance);
  $('freeVal').textContent = fmtMoney(app.engine.freeMargin(app.prices));
  $('levelBadge').textContent = inBattle() ? `⚔ 战役中` : `Lv.${app.engine.level}`;
  $('levelBadge').title = LEVELS[app.engine.level - 1].title;
}

function updatePriceUI(price) {
  const cfg = pairById(app.pairId);
  const el = $('priceBig');
  el.textContent = price.toFixed(cfg.digits);
  const dir = Math.sign(price - (app.prev[app.pairId] ?? price));
  el.classList.toggle('up', dir > 0);
  el.classList.toggle('down', dir < 0);
  const st = app.market.st[app.pairId];
  const ref = st.candles.length ? st.candles[0][0] : cfg.start;
  const chg = (price / ref - 1) * 100;
  const chgEl = $('priceChg');
  chgEl.textContent = `${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}%`;
  chgEl.classList.toggle('up', chg >= 0);
  chgEl.classList.toggle('down', chg < 0);
  updateChartInfo();
}

function updateChartInfo() {
  const cfg = pairById(app.pairId);
  const c = app.chart.hoverCandle() || app.chart.live;
  const info = $('chartInfo');
  if (!c) { info.textContent = '红＝涨 · 绿＝跌 · 滚轮/双指缩放，拖动回看'; return; }
  info.innerHTML =
    `开 <b>${c[0].toFixed(cfg.digits)}</b> 高 <b class="up-t">${c[1].toFixed(cfg.digits)}</b>` +
    ` 低 <b class="down-t">${c[2].toFixed(cfg.digits)}</b> 收 <b>${c[3].toFixed(cfg.digits)}</b>`;
}

/* ---------- 图表参考线 ---------- */

function buildOverlays() {
  const list = [];
  for (const p of app.engine.s.positions) {
    if (p.pairId !== app.pairId || list.length > 8) continue;
    list.push({ price: p.entry, color: '#d9a13b', dash: [2, 3], label: '开仓' });
    if (p.sl != null) list.push({ price: p.sl, color: '#e0564b', dash: [5, 4], label: '止损' });
    if (p.tp != null) list.push({ price: p.tp, color: '#2f9e77', dash: [5, 4], label: '止盈' });
  }
  app.chart.setOverlays(list);
}

/* ---------- 品种 / 手数 / 杠杆 / 保护 ---------- */

function renderPairChips() {
  const box = $('pairChips');
  box.innerHTML = '';
  if (inBattle()) {
    const cfg = pairById(app.pairId);
    const b = document.createElement('span');
    b.className = 'chip on';
    b.textContent = cfg.symbol;
    b.title = cfg.intro;
    box.appendChild(b);
    return;
  }
  for (const cfg of PAIRS) {
    if (!app.engine.isPairUnlocked(cfg.id) || cfg.battleOnly) continue;
    const b = document.createElement('button');
    b.className = 'chip' + (cfg.id === app.pairId ? ' on' : '');
    b.textContent = cfg.symbol;
    b.title = cfg.name + '：' + cfg.intro;
    b.onclick = () => switchPair(cfg.id);
    box.appendChild(b);
  }
}

function switchPair(id) {
  app.pairId = id;
  const cfg = pairById(id);
  const st = app.market.st[id];
  renderPairChips();
  app.chart.candles = st.candles;
  app.chart.live = app.market.forming[id];
  app.chart.price = app.prices[id];
  app.chart.view = { count: 60, right: 0 };
  app.chart.configure({
    digits: cfg.digits,
    startedAt: inBattle() ? app.mode.battle.startDate : app.save.startedAt,
    // 时间标签的毫秒粒度：模拟盘 1.5s/根；战役按史实分钟/根映射真实日期
    candleMs: inBattle() ? app.mode.battle.minutesPerCandle * 60000 : 1500,
    base: st.base,
  });
  $('buySub').textContent = `做多 ${cfg.symbol}`;
  $('sellSub').textContent = `做空 ${cfg.symbol}`;
  $('priceBig').textContent = app.prices[id].toFixed(cfg.digits);
  buildOverlays();
  updatePriceUI(app.prices[id]);
  updateMarginEst();
  renderSize();
}

const LOT_STEPS = [0.01, 0.05, 0.1, 0.2, 0.5, 1.0];
const MONEY_STEPS = [100, 500, 1000, 2000, 5000];

function persistSize() {
  app.save.settings.sizingMode = app.sizing;
  app.save.settings.money = app.money;
  saveNow();
}

// 仓位总渲染：金额⇄手数双模式，两套控件切换 + 换算行
function renderSize() {
  const moneyMode = app.sizing === 'money';
  $('moneyStepper').classList.toggle('hide', !moneyMode);
  $('moneyChips').classList.toggle('hide', !moneyMode);
  $('lotStepper').classList.toggle('hide', moneyMode);
  $('lotChips').classList.toggle('hide', moneyMode);
  $('modeMoney').classList.toggle('on', moneyMode);
  $('modeLots').classList.toggle('on', !moneyMode);
  const price = app.prices[app.pairId];
  if (moneyMode) {
    if (app.money == null) {
      // 老玩家首次进入金额模式：按现有手数的保证金起步
      app.money = Math.round(app.engine.marginOf(app.pairId, app.lots * LOT, app.lev, price, app.prices));
    }
    app.money = Math.max(10, Math.min(app.money, Math.max(10, Math.floor(app.engine.equity(app.prices) * 0.95))));
    app.lots = app.engine.lotsFromMoney(app.pairId, app.money, app.lev, price);
    $('moneyVal').textContent = '$' + Math.round(app.money).toLocaleString('en-US');
    $('sizeConv').textContent = `≈ ${app.lots.toFixed(2)} 手`;
  } else {
    const m = app.engine.marginOf(app.pairId, app.lots * LOT, app.lev, price, app.prices);
    $('sizeConv').textContent = `≈ ${fmtMoney(m)} 保证金`;
  }
  renderLots();
  renderMoneyChips();
  updateMarginEst();
}

function renderMoneyChips() {
  const box = $('moneyChips');
  box.innerHTML = '';
  const maxAfford = app.engine.equity(app.prices) * 0.95;
  for (const v of MONEY_STEPS) {
    const b = document.createElement('button');
    b.textContent = '$' + v.toLocaleString('en-US');
    b.disabled = v > maxAfford;
    b.className = v === app.money ? 'on' : '';
    b.onclick = () => { app.money = v; renderSize(); persistSize(); };
    box.appendChild(b);
  }
  // MAX：梭哈按钮（约 95% 可用）
  const maxBtn = document.createElement('button');
  maxBtn.textContent = 'MAX';
  maxBtn.className = 'max-chip';
  maxBtn.onclick = () => { app.money = Math.max(10, Math.floor(maxAfford)); renderSize(); persistSize(); };
  box.appendChild(maxBtn);
  $('moneyVal').textContent = '$' + Math.round(app.money).toLocaleString('en-US');
}

function stepMoney(d) {
  const step = app.money >= 2000 ? 500 : app.money >= 500 ? 100 : 50;
  const maxAfford = Math.max(10, Math.floor(app.engine.equity(app.prices) * 0.95));
  app.money = Math.max(10, Math.min(app.money + d * step, maxAfford));
  renderSize();
  persistSize();
}

function setSizing(mode) {
  if (app.sizing === mode) return;
  const price = app.prices[app.pairId];
  if (mode === 'money') {
    // 手数 → 金额：按当前手数的占用保证金起步
    app.money = Math.round(app.engine.marginOf(app.pairId, app.lots * LOT, app.lev, price, app.prices));
  } else {
    app.lots = app.engine.lotsFromMoney(app.pairId, app.money, app.lev, price);
  }
  app.sizing = mode;
  renderSize();
  persistSize();
}

function renderLots() {
  const box = $('lotChips');
  box.innerHTML = '';
  const price = app.prices[app.pairId];
  const maxAfford = app.engine.equity(app.prices) * 0.95;
  for (const l of LOT_STEPS) {
    const b = document.createElement('button');
    b.textContent = l.toFixed(2);
    const m = app.engine.marginOf(app.pairId, l * LOT, app.lev, price, app.prices);
    b.disabled = m > maxAfford;
    b.className = l === app.lots ? 'on' : '';
    b.onclick = () => { app.lots = l; renderSize(); };
    box.appendChild(b);
  }
  $('lotVal').textContent = app.lots.toFixed(2);
}

function stepLot(d) {
  const i = LOT_STEPS.indexOf(app.lots);
  const next = LOT_STEPS[Math.max(0, Math.min(LOT_STEPS.length - 1, (i < 0 ? 3 : i) + d))];
  app.lots = next;
  renderSize();
}

function renderLev() {
  const box = $('levChips');
  box.innerHTML = '';
  for (const l of [10, 20, 50, 100]) {
    if (l > app.engine.maxLev()) continue;
    const b = document.createElement('button');
    b.textContent = l + '×';
    b.className = l === app.lev ? 'on' : '';
    b.onclick = () => { app.lev = l; renderLev(); renderSize(); };
    box.appendChild(b);
  }
}

function renderAdv() {
  const adv = app.engine.isAdvanced();
  $('levField').classList.toggle('hide', !adv);
  $('sltpInputs').classList.toggle('hide', !adv);
  $('protSummary').classList.toggle('hide', adv);
  $('protToggle').checked = app.save.settings.autoProtect;
  if (adv) app.lev = Math.min(app.lev, app.engine.maxLev());
}

function updateMarginEst() {
  const price = app.prices[app.pairId];
  if (!price) return;
  const cfg = pairById(app.pairId);
  const units = app.lots * LOT;
  const m = app.engine.marginOf(app.pairId, units, app.lev, price, app.prices);
  $('marginEst').textContent = fmtMoney(m);
  // 名义价值：实际控制的仓位规模（美元）
  const notional = cfg.base === 'USD' ? units : units * price;
  $('notionalEst').textContent = fmtMoney(notional);
  // 约可承受反向波动：80% 爆仓线 ÷ 杠杆（单仓位视角的风险教育指标）
  const tol = (0.8 / app.lev) * 100;
  $('tolEst').textContent = `≈ ${tol.toFixed(1)}%`;
}

function renderProtChip() {
  const n = app.save.protectionLeft;
  const el = $('protChip');
  el.classList.toggle('hide', n <= 0);
  el.textContent = `🛡 新手保护中 · 剩 ${n} 单`;
  app.market.modifier = n > 0 ? { pairId: 'EURUSD', volMult: 0.55, drift: 0.8 * pairById('EURUSD').pip } : null;
}

/* ---------- 持仓与历史 ---------- */

function renderPositions() {
  const box = $('posList');
  box.innerHTML = '';
  app.posRefs.clear();
  $('posCount').textContent = app.engine.s.positions.length;
  if (!app.engine.s.positions.length) {
    box.innerHTML = '<div class="empty">暂无持仓，去开第一单吧</div>';
    buildOverlays(); // 清掉已平仓持仓留在图表上的参考线
    return;
  }
  for (const p of app.engine.s.positions) {
    const cfg = pairById(p.pairId);
    const row = document.createElement('div');
    row.className = 'pos';
    row.innerHTML = `
      <div class="pos-top">
        <b>${cfg.symbol}</b>
        <span class="dir ${p.dir > 0 ? 'up' : 'down'}">${p.dir > 0 ? '买涨' : '买跌'} ${(p.units / LOT).toFixed(2)}手</span>
        <span class="term-inline sm" data-term="float">浮盈</span><b class="pnl">–</b>
        <button class="btn-close">平仓</button>
      </div>
      <div class="pos-sub">
        开仓 ${p.entry.toFixed(cfg.digits)} → 现价 <span class="cur">–</span>
        <span class="pips">–</span>
        ｜ 止损 ${p.sl != null ? p.sl.toFixed(cfg.digits) : '无'}
        · 止盈 ${p.tp != null ? p.tp.toFixed(cfg.digits) : '无'}
      </div>`;
    row.querySelector('.btn-close').onclick = () => manualClose(p.id);
    box.appendChild(row);
    app.posRefs.set(p.id, {
      pnl: row.querySelector('.pnl'),
      cur: row.querySelector('.cur'),
      pips: row.querySelector('.pips'),
      cfg,
    });
  }
  updatePosLive();
  buildOverlays();
}

function updatePosLive() {
  for (const [id, ref] of app.posRefs) {
    const p = app.engine.s.positions.find((x) => x.id === id);
    if (!p) continue;
    const price = app.prices[p.pairId];
    const pnl = app.engine.floating(p, price, app.prices);
    ref.pnl.textContent = fmtMoney(pnl, true);
    ref.pnl.classList.toggle('up', pnl > 0);
    ref.pnl.classList.toggle('down', pnl < 0);
    ref.cur.textContent = price.toFixed(ref.cfg.digits);
    const pips = ((price - p.entry) / ref.cfg.pip) * p.dir;
    ref.pips.textContent = `(${pips >= 0 ? '+' : '−'}${Math.abs(pips).toFixed(1)}点)`;
  }
}

function renderHistory() {
  const box = $('histList');
  box.innerHTML = '';
  if (!app.save.closed.length) {
    box.innerHTML = '<div class="empty">还没有平仓记录</div>';
    return;
  }
  for (const c of app.save.closed) {
    const cfg = pairById(c.pairId);
    const div = document.createElement('div');
    div.className = 'hist';
    const tm = new Date(c.t);
    div.innerHTML = `
      <b>${cfg.symbol}</b><span class="dir ${c.dir > 0 ? 'up' : 'down'}">${c.dir > 0 ? '买涨' : '买跌'} ${(c.units / LOT).toFixed(2)}手</span>
      <b class="pnl ${c.pnl > 0 ? 'up' : c.pnl < 0 ? 'down' : ''}">${fmtMoney(c.pnl, true)}</b>
      <span class="rs">${c.reason}</span>
      <span class="tm">${String(tm.getHours()).padStart(2, '0')}:${String(tm.getMinutes()).padStart(2, '0')}</span>`;
    box.appendChild(div);
  }
}

function setTab(t) {
  $('tabOpen').classList.toggle('on', t === 'open');
  $('tabHist').classList.toggle('on', t === 'hist');
  $('posList').classList.toggle('hide', t !== 'open');
  $('histList').classList.toggle('hide', t !== 'hist');
}

/* ---------- 交易动作 ---------- */

function tryOpen(dir) {
  const id = app.pairId;
  const cfg = pairById(id);
  const price = app.prices[id];
  let sl = null, tp = null;
  if (!app.engine.isAdvanced() || app.save.settings.autoProtect) {
    ({ sl, tp } = app.engine.autoSlTp(id, dir, price));
  } else {
    const sp = parseFloat($('slInput').value) || null;
    const tpp = parseFloat($('tpInput').value) || null;
    if (sp) sl = dir > 0 ? price - sp * cfg.pip : price + sp * cfg.pip;
    if (tpp) tp = dir > 0 ? price + tpp * cfg.pip : price - tpp * cfg.pip;
  }
  const r = app.engine.open({ pairId: id, dir, units: app.lots * LOT, lev: app.lev, sl, tp }, price, app.prices);
  if (!r.ok) {
    const msg = { margin: '可用余额不足：试试调低手数或杠杆', sltp: '止损/止盈的方向不对', locked: '该货币对还未解锁' }[r.err] || '无法开仓';
    toast(msg);
    return;
  }
  const btn = dir > 0 ? $('btnBuy') : $('btnSell');
  btn.classList.remove('pressed'); void btn.offsetWidth; btn.classList.add('pressed');
  renderPositions();
  $('posCount').textContent = app.engine.s.positions.length;
  saveNow();
  bus.emit('trade:opened', r.pos);
}

function manualClose(id) {
  const p = app.engine.s.positions.find((x) => x.id === id);
  if (!p) return;
  const r = app.engine.close(id, app.prices[p.pairId], '手动平仓', app.prices);
  if (r) onClosed(r);
}

function onClosed(r) {
  renderPositions();
  renderHistory();
  renderProtChip();
  if (r.reason !== '爆仓') showSettlement({ pnl: r.pnl, reason: r.reason });
  for (const p of r.promotions) onLevelUp(p);
  updateMoney();
  if (!inBattle()) { saveNow(); syncNow(); } // 战役账户不落主档、不上榜
  bus.emit('trade:closed', r);
}

function onLevelUp(lvl) {
  const unlocks = [];
  for (const cfg of PAIRS) if (cfg.unlockLv === lvl.lv) unlocks.push(`解锁新货币对：${cfg.symbol}（${cfg.name}）`);
  unlocks.push(`杠杆上限提升至 ${lvl.maxLev}×`);
  if (lvl.advanced) unlocks.push('进阶下单面板已开放');
  showLevelUp({ lv: lvl.lv, title: lvl.title, unlocks });
  renderPairChips(); renderLev(); renderAdv();
  if (app.engine.isPairUnlocked(app.pairId) === false) switchPair('EURUSD');
  updateMoney();
}

/* ---------- 经典战役 ---------- */

function inBattle() { return !!app.mode; }

function renderBattleList() {
  const box = $('battleItems');
  box.innerHTML = '';
  const recs = app.save.battleResults || {};
  for (const b of BATTLES) {
    const rec = recs[b.id];
    const div = document.createElement('button');
    div.className = 'battle-item';
    div.innerHTML = `
      <b>⚔ ${b.title}</b>
      <span>${b.sub} · ${pairById(b.pairId).symbol}</span>
      <em>${rec && rec.plays ? `最佳 ${fmtMoney(rec.bestPnl, true)} · 参战 ${rec.plays} 次` : '未挑战'}</em>`;
    div.onclick = () => showBattleIntro(b);
    box.appendChild(div);
  }
}

function showBattleIntro(b) {
  $('biTitle').textContent = `⚔ ${b.title}`;
  $('biSub').textContent = `${b.sub} · ${pairById(b.pairId).name}（${pairById(b.pairId).symbol}）`;
  $('biBrief').textContent = b.briefing;
  $('biGoal').textContent =
    `本金 $${b.capital.toLocaleString()} · 杠杆上限 ${b.maxLev}× · 结算收益 ≥ +${Math.round(b.winPct * 100)}% 记为胜利；行情为按史实演绎的教学重演`;
  app.battlePending = b;
  $('battleModal').classList.add('hide');
  $('battleIntroModal').classList.remove('hide');
}

function startBattle(b) {
  $('battleIntroModal').classList.add('hide');
  if (!b) return;
  if (app.engine.s.positions.length) {
    toast('请先平掉模拟盘的持仓，再进入战役');
    return;
  }
  saveNow(); // 出征前存好主盘
  app.mainEngine = app.engine;
  app.simMarket = app.market;
  const state = { ...Engine.newState(), balance: b.capital, level: 4, cap: b.maxLev, protectionLeft: 0 };
  app.engine = new Engine(state);
  app.mode = { battle: b, state };
  app.market.stop();
  app.market = new ReplayMarket(b);
  app.prices = {}; app.prev = {};
  Object.assign(app.prices, app.market.prices());
  switchPair(b.pairId);
  wireReplay(b);
  app.market.start();
  $('battleTitle').textContent = `⚔ ${b.title} · ${pairById(b.pairId).symbol}`;
  $('battleProgFill').style.width = '0%';
  $('battleBar').classList.remove('hide');
  renderPositions(); renderHistory(); renderProtChip(); updateMoney(); renderLev(); renderAdv(); setTab('open');
  toast('战役开始！史实事件将随行情推进逐一上演');
}

function wireReplay(battle) {
  app.market.onTick = (id, price) => {
    Object.assign(app.prices, app.market.prices());
    if (id === app.pairId) {
      app.chart.live = app.market.forming[id];
      app.chart.price = price;
      app.chart.lastDir = Math.sign(price - (app.prev[id] ?? price));
      app.chart.request();
      updatePriceUI(price);
    }
    app.prev[id] = price;
    updatePosLive();

    for (const ev of app.engine.checkTick(id, price, app.prices)) {
      if (ev.type === 'close') {
        const r = app.engine.close(ev.id, ev.price, ev.reason, app.prices);
        if (r) onClosed(r);
      } else if (ev.type === 'blowup') {
        const results = app.engine.liquidate(app.prices);
        const lost = results.reduce((s, r) => s + r.pnl, 0);
        renderPositions(); updateMoney();
        app.pendingEnd = true;
        showLiquidation({ lost, left: app.mode.state.balance });
      }
    }
    updateMoney();
  };
  app.market.onCandle = () => {
    app.chart.request();
    const pct = Math.min(100, Math.round((app.market.st[battle.pairId].candles.length / battle.length) * 100));
    $('battleProgFill').style.width = pct + '%';
    updateMarginEst();
    renderLots();
  };
  app.market.onNews = (a) => showEventCard({ tag: '史实', title: a.title, body: a.note, ms: 8000 });
  app.market.onEnd = () => endBattle('战役结束');
}

function endBattle(reason) {
  if (!app.mode) return;
  const { battle, state } = app.mode;
  app.pendingEnd = false;
  for (const p of [...state.positions]) {
    app.engine.close(p.id, app.prices[p.pairId], '战役结束', app.prices);
  }
  const verdict = judgeBattle(battle, state.balance, reason === '爆仓');

  // 收兵回模拟盘
  app.mode = null;
  app.engine = app.mainEngine;
  app.market = app.simMarket;
  app.prices = {}; app.prev = {};
  for (const cfg of PAIRS) app.prices[cfg.id] = app.market.last[cfg.id];
  app.market.start();
  $('battleBar').classList.add('hide');
  switchPair('EURUSD');
  renderPositions(); renderHistory(); renderProtChip(); updateMoney(); renderLev(); renderAdv();

  // 战绩记入主档
  app.save.battleResults ??= {};
  const rec = app.save.battleResults[battle.id] || { plays: 0, wins: 0, bestPnl: -Infinity };
  rec.plays++;
  if (verdict.win) rec.wins++;
  rec.bestPnl = Math.max(rec.bestPnl, verdict.pnl);
  app.save.battleResults[battle.id] = rec;
  saveNow();

  const icon = verdict.grade === '胜利' ? '🏆' : verdict.grade === '爆仓' ? '💥' : '🛡';
  $('brTitle').textContent = `${icon} ${verdict.grade}｜${battle.title}`;
  $('brPnl').textContent = fmtMoney(verdict.pnl, true);
  $('brPnl').className = 'num ' + (verdict.pnl > 0 ? 'up' : verdict.pnl < 0 ? 'down' : '');
  $('brEpilogue').textContent = verdict.win ? battle.epilogueWin : battle.epilogueLose;
  $('brBest').textContent = `历史最佳 ${fmtMoney(rec.bestPnl, true)} · 参战 ${rec.plays} 次`;
  $('battleResultModal').classList.remove('hide');
}

/* ---------- 弹窗与菜单 ---------- */

function wireMenus() {
  const show = (id, on = true) => $(id).classList.toggle('hide', !on);
  $('btnMenu').onclick = () => show('menuModal');
  $('miClose').onclick = () => show('menuModal', false);
  $('miAbout').onclick = () => show('aboutModal');
  $('abClose').onclick = () => show('aboutModal', false);
  $('miRestart').onclick = () => show('confirmModal');
  $('cfNo').onclick = () => show('confirmModal', false);
  $('cfYes').onclick = () => { clearSave(); location.reload(); };
  $('btnBattle').onclick = () => { renderBattleList(); show('battleModal'); };
  $('battleClose').onclick = () => show('battleModal', false);
  $('biGo').onclick = () => startBattle(app.battlePending);
  $('biCancel').onclick = () => show('battleIntroModal', false);
  $('brClose').onclick = () => show('battleResultModal', false);
  $('battleQuit').onclick = () => endBattle('主动结束');
  $('liqOk').onclick = () => {
    show('liqOverlay', false);
    if (inBattle() && app.pendingEnd) endBattle('爆仓');
  };
  $('tabOpen').onclick = () => setTab('open');
  $('tabHist').onclick = () => setTab('hist');
  $('lotMinus').onclick = () => stepLot(-1);
  $('lotPlus').onclick = () => stepLot(1);
  $('modeMoney').onclick = () => setSizing('money');
  $('modeLots').onclick = () => setSizing('lots');
  $('moneyMinus').onclick = () => stepMoney(-1);
  $('moneyPlus').onclick = () => stepMoney(1);
  $('btnBuy').onclick = () => tryOpen(1);
  $('btnSell').onclick = () => tryOpen(-1);
  $('protToggle').onchange = (e) => { app.save.settings.autoProtect = e.target.checked; saveNow(); };
  $('levelBadge').onclick = () => {
    const lv = app.engine.level;
    const next = LEVELS[lv];
    if (!next) { toast(`已是最高等级：Lv.${lv}`); return; }
    const { trades = 0, profit = 0 } = next.need || {};
    toast(`Lv.${lv} ${LEVELS[lv - 1].title} ｜ 下一级还需 ${Math.max(0, trades - app.save.tradeCount)} 笔、累计盈亏再 +${fmtMoney(Math.max(0, profit - app.save.totalPnl)).replace('$', '$')}`);
  };
}

/* ---------- 启动 ---------- */

function init() {
  initExplain();
  wireMenus();

  const saved = loadSave();
  saved ? resume(saved) : newGame();
  // 仓位模式设置（旧存档无此字段 → 默认按金额、金额从现有手数换算）
  app.sizing = app.save.settings.sizingMode || 'money';
  app.money = app.save.settings.money ?? null;

  app.chart = new CandleChart($('chartCanvas'));
  wireMarket();
  switchPair('EURUSD');
  renderAdv();
  renderLev();
  renderSize();
  renderPositions();
  renderHistory();
  renderProtChip();
  updateMoney();
  setTab('open');

  app.market.start();
  saveNow();

  if (!app.save.tutorial.done) {
    app.tut = new Tutorial(app.save);
    setTimeout(() => app.tut.start(app.save.tutorial.step ?? 0), 350);
  }
  bus.on('tut:done', () => { saveNow(); toast('教程完成！再完成 2 笔交易就能解锁 USD/JPY'); renderProtChip(); });

  // 页面隐藏时兜底存档 + 上报战绩
  document.addEventListener('visibilitychange', () => { if (document.hidden) { saveNow(); syncNow(); } });
  window.addEventListener('pagehide', () => { saveNow(); syncNow(); });

  // 龙虎榜：注册/排行/自动上报
  initLeaderboard(() => ({
    equity: app.engine.equity(app.prices),
    trades: app.save.tradeCount,
    open: app.save.positions.length > 0,
  }));

  // PWA（仅 http/https 下生效）
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // 调试钩子（测试用，不影响正常玩法）
  window.__ft = {
    save: () => app.save,
    engine: () => app.engine,
    market: () => app.market,
    prices: () => app.prices,
    saveNow,
    firePrologue: () => { app.candlesSeen = 12; prologueCheck(); },
  };
}

init();
