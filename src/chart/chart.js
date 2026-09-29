// Canvas 手绘 K 线：缩放（滚轮/双指）、拖动回看、现价线、持仓开仓/止损/止盈参考线
// K 线数据由 market 原地维护（push/shift），图表直接持有引用，每帧重画
const PAD = { l: 6, r: 60, t: 10, b: 22 };
const C = {
  up: '#e0564b', down: '#2f9e77',
  grid: 'rgba(120,110,80,.13)', axis: '#98a39a', ink: '#33413a',
  cross: 'rgba(51,65,58,.45)',
};

export class CandleChart {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.candles = [];   // [[o,h,l,c],...]
    this.live = null;    // 正在生成的 K 线 {o,h,l,c}
    this.price = null;
    this.lastDir = 0;
    this.cfg = { digits: 5, startedAt: Date.now(), base: 0 };
    this.overlays = [];  // [{price,color,dash,label}]
    this.view = { count: 60, right: 0 };
    this.hover = null;
    this._raf = 0;
    this._pointers = new Map();
    this._drag = null;
    this._pinch = null;

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', (e) => this._up(e));
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.request(); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._zoom(e.deltaY > 0 ? 1.18 : 0.85);
    }, { passive: false });
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
    this._resize();
  }

  configure(cfg) { Object.assign(this.cfg, cfg); }

  setOverlays(list) { this.overlays = list || []; this.request(); }

  _resize() {
    const box = this.cv.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(120, box.width);
    this.h = Math.max(100, box.height);
    this.cv.width = Math.round(this.w * dpr);
    this.cv.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.request();
  }

  request() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
  }

  _zoom(f) {
    const n = this.candles.length + (this.live ? 1 : 0);
    this.view.count = Math.round(Math.min(160, Math.max(15, this.view.count * f)));
    this._clampRight(n);
    this.request();
  }

  _clampRight(n) {
    this.view.right = Math.max(0, Math.min(this.view.right, Math.max(0, n - 8)));
  }

  _down(e) {
    this.cv.setPointerCapture(e.pointerId);
    this._pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (this._pointers.size === 2) {
      const [a, b] = [...this._pointers.values()];
      this._pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), count: this.view.count };
      this._drag = null;
    } else if (this._pointers.size === 1) {
      this._drag = { x: e.offsetX, right: this.view.right, moved: false };
    }
  }

  _move(e) {
    if (this._pointers.has(e.pointerId)) {
      this._pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this._pinch && this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.view.count = Math.round(Math.min(160, Math.max(15, this._pinch.count * (this._pinch.d / d))));
        this.request();
      } else if (this._drag) {
        const dx = e.offsetX - this._drag.x;
        if (Math.abs(dx) > 3) this._drag.moved = true;
        const cw = this._plotW() / this.view.count;
        const n = this.candles.length + (this.live ? 1 : 0);
        this.view.right = Math.max(0, Math.min(this._drag.right + dx / cw, Math.max(0, n - 8)));
        this.hover = null;
        this.request();
      }
    } else if (e.pointerType === 'mouse') {
      this.hover = { x: e.offsetX, y: e.offsetY };
      this.request();
    }
  }

  _up(e) {
    this._pointers.delete(e.pointerId);
    if (this._pointers.size < 2) this._pinch = null;
    if (this._pointers.size === 0) this._drag = null;
  }

  _plotW() { return this.w - PAD.l - PAD.r; }
  _plotH() { return this.h - PAD.t - PAD.b; }

  hoverCandle() {
    if (!this.hover) return null;
    const n = this.candles.length + (this.live ? 1 : 0);
    const start = n - this.view.count - this.view.right;
    const cw = this._plotW() / this.view.count;
    const i = Math.floor((this.hover.x - PAD.l) / cw);
    const idx = start + i;
    if (idx < 0 || idx >= n) return null;
    return idx < this.candles.length ? this.candles[idx] : this.live;
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const n = this.candles.length + (this.live ? 1 : 0);
    this._clampRight(n);

    // 可见区间
    const start = Math.max(0, n - this.view.count - this.view.right);
    const end = n - this.view.right;
    const vis = [];
    for (let i = start; i < end; i++) vis.push(i < this.candles.length ? this.candles[i] : this.live);

    // Y 轴范围
    let lo = Infinity, hi = -Infinity;
    for (const c of vis) { if (c[2] < lo) lo = c[2]; if (c[1] > hi) hi = c[1]; }
    if (this.price != null) { lo = Math.min(lo, this.price); hi = Math.max(hi, this.price); }
    if (!isFinite(lo)) { lo = (this.price || 1) - 0.001; hi = (this.price || 1) + 0.001; }
    let span = hi - lo || ((this.price || 1) * 0.002);
    for (const ov of this.overlays) {
      if (ov.price < lo - span * 0.8 || ov.price > hi + span * 0.8) continue;
      lo = Math.min(lo, ov.price); hi = Math.max(hi, ov.price);
    }
    span = hi - lo || 0.001;
    lo -= span * 0.08; hi += span * 0.08;
    const yOf = (p) => PAD.t + ((hi - p) / (hi - lo)) * this._plotH();
    const pw = this._plotW(), ph = this._plotH();
    const cw = pw / this.view.count;

    // 网格与价格标签
    ctx.font = '10px system-ui, sans-serif';
    const step = this._niceStep((hi - lo) / 4);
    ctx.strokeStyle = C.grid; ctx.fillStyle = C.axis; ctx.lineWidth = 1;
    for (let p = Math.ceil(lo / step) * step; p < hi; p += step) {
      const y = yOf(p);
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillText(p.toFixed(this.cfg.digits), PAD.l + pw + 5, y + 3);
    }

    // 蜡烛（对齐物理像素栅格：影线与实体边缘锐利，和实盘软件一致）
    const dpr = window.devicePixelRatio || 1;
    const snap = (v) => Math.round(v * dpr) / dpr;
    const bw = Math.max(1, cw * 0.7);
    for (let k = 0; k < vis.length; k++) {
      const [o, h, l, c] = vis[k];
      const x = snap(PAD.l + (k + 0.5) * cw);
      const up = c >= o;
      const col = up ? C.up : C.down;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, snap(yOf(h)));
      ctx.lineTo(x, snap(yOf(l)));
      ctx.stroke();
      const yo = yOf(o), yc = yOf(c);
      const top = snap(Math.min(yo, yc));
      const bottom = snap(Math.max(yo, yc));
      const bodyTop = top;
      const bodyH = Math.max(1 / dpr, bottom - top); // 十字星保底 1 物理像素
      ctx.fillRect(snap(x - bw / 2), bodyTop, Math.max(1 / dpr, snap(x + bw / 2) - snap(x - bw / 2)), bodyH);
    }

    // 参考线（开仓/止损/止盈）
    for (const ov of this.overlays) {
      const y = yOf(ov.price);
      if (y < PAD.t - 4 || y > PAD.t + ph + 4) continue;
      ctx.save();
      ctx.strokeStyle = ov.color; ctx.setLineDash(ov.dash || []); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ov.color;
      ctx.textAlign = 'left';
      ctx.fillText(ov.label || '', PAD.l + 4, y - 3);
      ctx.restore();
    }

    // 现价线 + 价签
    if (this.price != null) {
      const y = yOf(this.price);
      const col = this.lastDir > 0 ? C.up : this.lastDir < 0 ? C.down : C.ink;
      ctx.save();
      ctx.strokeStyle = col; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      const tag = this.price.toFixed(this.cfg.digits);
      const tw = ctx.measureText(tag).width + 8;
      ctx.fillRect(PAD.l + pw + 2, y - 8, tw, 16);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      ctx.fillText(tag, PAD.l + pw + 6, y + 3.5);
      ctx.restore();
    }

    // 时间标签（战役回放为大颗粒分钟，显示历史日期）
    ctx.fillStyle = C.axis; ctx.textAlign = 'center';
    const k = Math.max(1, Math.round(this.view.count / 5));
    const big = (this.cfg.candleMs || 1500) >= 60000;
    const fmt = (t) => big
      ? `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      : `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    for (let i = start; i < end; i++) {
      const gi = this.cfg.base + i;
      if (gi % k !== 0) continue;
      const x = PAD.l + (i - start + 0.5) * cw;
      ctx.fillText(fmt(new Date(this.cfg.startedAt + gi * this.cfg.candleMs)), x, this.h - 6);
    }

    // 十字光标（鼠标）
    if (this.hover) {
      const hc = this.hoverCandle();
      if (hc) {
        const i = vis.indexOf(hc);
        if (i >= 0) {
          const x = PAD.l + (i + 0.5) * cw;
          ctx.strokeStyle = C.cross; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ph); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  _niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1e-6)));
    const m = raw / p;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
  }
}
