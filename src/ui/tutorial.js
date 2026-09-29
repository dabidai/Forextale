// 交互式引导第一单：聚光灯 + 跟做，代替前置文字教程（可跳过，支持断点续传）
import { bus } from '../core/bus.js';

const $ = (id) => document.getElementById(id);

const STEPS = [
  {
    target: '#chartCard', title: '欢迎来到你的交易室',
    body: '这里是《汇市物语》模拟交易室。图上每根蜡烛是 1.5 秒的行情：<b class="up-t">红蜡烛＝在涨</b>，<b class="down-t">绿蜡烛＝在跌</b>。放心玩，这是纯模拟盘，亏了也不心疼。',
    btn: '带我开始',
  },
  {
    target: '#btnBuy', title: '第一单：买涨',
    body: '直觉时间——猜猜欧元接下来是涨是跌？我们先赌它涨：点这颗红色「买涨」按钮（行话叫<b>做多</b>）。',
    wait: 'open',
  },
  {
    target: '#posList .pos', title: '你的单子活了',
    body: '这张卡片就是你的<b>持仓</b>，浮盈浮亏实时刷新。我已替你挂好「自动保护」：亏到 <b class="down-t">−20 点</b>自动砍单，赚 <b class="up-t">+30 点</b>自动落袋——先学会活着，再谈赚钱。',
    btn: '知道了',
  },
  {
    target: '#posList .pos .btn-close', title: '落袋为安',
    body: '看到浮盈变成红色了吗？点卡片上的「平仓」，把利润装进口袋。就算你不动手，到价止盈也会自动帮你平。',
    wait: 'close',
  },
  { title: '出师了', body: '', btn: '开始闯荡', center: true },
];

export class Tutorial {
  constructor(save) {
    this.save = save;
    this.layer = $('tutLayer');
    this.active = false;
    this.off = null;
    this.targetEl = null;
    $('tutNext').addEventListener('click', () => {
      const s = STEPS[this.step];
      if (s && s.btn) this.advance();
    });
    $('tutSkip').addEventListener('click', () => this.done());
    window.addEventListener('resize', () => { if (this.active) this.place(); });
  }

  start(step = 0) {
    if (this.save.tutorial.done) return;
    let s = step;
    // 断点续传保护：要求持仓存在的步骤，若已无持仓则退回开仓步骤
    if ((s === 2 || s === 3) && !document.querySelector('#posList .pos')) s = 1;
    this.active = true;
    this.layer.classList.remove('hide');
    document.body.classList.add('tut-lock');
    this.go(s);
  }

  go(n) {
    this.step = n;
    this.save.tutorial.step = n;
    const s = STEPS[n];
    $('tutStep').textContent = `第 ${n + 1} 步 · 共 ${STEPS.length} 步`;
    $('tutTitle').textContent = s.title;
    $('tutBody').innerHTML = s.body ?? '';
    $('tutNext').textContent = s.btn || '下一步';
    $('tutNext').classList.toggle('hide', !s.btn);
    $('tutSkip').classList.toggle('hide', n === STEPS.length - 1);
    this._clearTarget();
    if (this.off) { this.off(); this.off = null; }
    if (s.wait === 'open') this.off = bus.on('trade:opened', () => this.advance());
    if (s.wait === 'close') this.off = bus.on('trade:closed', (r) => {
      this.lastPnl = r.pnl;
      setTimeout(() => this.advance(), 1400);
    });
    this._setTarget(s);
    this.place();
  }

  advance() {
    const n = this.step + 1;
    if (n >= STEPS.length) { this.done(); return; }
    if (n === STEPS.length - 1) this._fillFinal();
    this.go(n);
  }

  _fillFinal() {
    const win = (this.lastPnl ?? 0) >= 0;
    STEPS[STEPS.length - 1].body = win
      ? '第一笔盈利到手！之后每一单都会默认带好这层保护。多练几单、攒够战绩，就能解锁新货币对和更高杠杆。祝你在汇市顺风顺水！'
      : '第一单虽然小亏，但止损把损失稳稳挡住了——这正是风控的意义。多练几单、攒够战绩，就能解锁新货币对和更高杠杆。';
  }

  _setTarget(s) {
    if (!s.target) return;
    const el = document.querySelector(s.target);
    if (!el) return;
    el.classList.add('tut-target');
    this.targetEl = el;
  }

  _clearTarget() {
    if (this.targetEl) {
      this.targetEl.classList.remove('tut-target');
      this.targetEl = null;
    }
  }

  place() {
    const spot = $('tutSpot'), card = $('tutCard');
    const s = STEPS[this.step];
    if (!s.target || !this.targetEl) {
      spot.classList.add('hide');
      card.classList.add('center');
      return;
    }
    spot.classList.remove('hide');
    card.classList.remove('center');
    const r = this.targetEl.getBoundingClientRect();
    spot.style.left = r.left - 6 + 'px';
    spot.style.top = r.top - 6 + 'px';
    spot.style.width = r.width + 12 + 'px';
    spot.style.height = r.height + 12 + 'px';
    card.style.visibility = 'hidden';
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let left = r.left + r.width / 2 - cw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - cw - 8));
    let top = r.bottom + 14;
    if (top + ch > window.innerHeight - 8) top = r.top - ch - 14;
    if (top < 8) top = 8;
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    card.style.visibility = 'visible';
  }

  done() {
    if (this.off) { this.off(); this.off = null; }
    this._clearTarget();
    this.active = false;
    this.layer.classList.add('hide');
    document.body.classList.remove('tut-lock');
    this.save.tutorial.done = true;
    this.save.tutorial.step = -1;
    bus.emit('tut:done');
  }
}
