// 种子化 PRNG（mulberry32）：行情可复现，存档/读档后续接同一随机序列
export class Prng {
  constructor(seed = 1, state = null) {
    this.a = (state ?? seed) >>> 0;
  }
  next() {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // Box-Muller 标准正态
  gauss() {
    const u = this.next() || 1e-12;
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  get state() {
    return this.a >>> 0;
  }
}
