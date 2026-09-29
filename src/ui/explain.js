// 术语点词解释：点击带 data-term 的词，底部弹出一句解释 + 小例子
export const TERMS = {
  pip: {
    t: '点（pip）',
    d: '汇率的最小计价单位，是外汇里衡量波动和盈亏的尺子。',
    e: 'EUR/USD 从 1.0850 涨到 1.0851，就是涨了 1 点。0.2 手 EUR/USD 每点约值 $2。',
  },
  lot: {
    t: '手数（lot）',
    d: '交易量的单位，1 手 = 100,000 份基础货币。手数越大，每点盈亏越大。',
    e: '0.2 手 EUR/USD = 20,000 欧元，波动 1 点约 $2；1 手就是每点 $10。',
  },
  leverage: {
    t: '杠杆',
    d: '用少量保证金撬动更大仓位的倍数。放大收益，也同倍放大亏损。',
    e: '10× 杠杆下，$2,000 保证金就能开 $20,000 的仓位；但亏起来也是 10 倍速。',
  },
  margin: {
    t: '保证金',
    d: '开仓时锁定的押金 = 仓位价值 ÷ 杠杆。平仓后归还，亏损从余额里扣。',
    e: '$20,000 的 EUR/USD 仓位，10× 杠杆需要约 $2,170 保证金。',
  },
  notional: {
    t: '名义价值',
    d: '保证金 × 杠杆 = 你实际控制的仓位大小。盈亏都按这个大数字结算，所以杠杆才会放大收益和风险。',
    e: '$1,000 保证金开 20× 杠杆，名义价值 $20,000——价格波动 1%，你的盈亏就是 $200。',
  },
  long: {
    t: '做多（买涨）',
    d: '先买后卖：预期基础货币升值。涨了赚差价，跌了亏。',
    e: '在 1.0850 买涨 EUR/USD，涨到 1.0880 平仓，赚 30 点。',
  },
  short: {
    t: '做空（买跌）',
    d: '先卖后买：预期基础货币贬值。跌了赚，涨了亏——外汇里做空和做多一样自然。',
    e: '在 149.50 做空 USD/JPY，跌到 149.20 平仓，赚 30 点。',
  },
  sl: {
    t: '止损（SL）',
    d: '亏损到设定价位就自动平仓，是给每笔交易预设的「安全气囊」。',
    e: '买涨后挂 20 点止损：走势反了最多亏 20 点，睡得着觉。',
  },
  tp: {
    t: '止盈（TP）',
    d: '盈利到设定价位自动平仓落袋，不用盯盘也不贪心。',
    e: '买涨后挂 30 点止盈：价格一到，利润自动进账。',
  },
  equity: {
    t: '权益',
    d: '此刻账户的真实总值 = 余额 + 所有持仓的浮动盈亏。',
    e: '余额 $10,000，持仓浮亏 $80，权益就是 $9,920。',
  },
  free: {
    t: '可用余额',
    d: '权益减去已用保证金，是还能用来开新仓的钱。',
    e: '权益 $10,000，已用保证金 $2,170，可用约 $7,830。',
  },
  blowup: {
    t: '爆仓',
    d: '权益跌破已用保证金的 80% 强平线，系统强制平掉所有持仓。',
    e: '重仓 + 高杠杆时最容易发生。轻仓、带止损，就离它远远的。',
  },
  float: {
    t: '浮动盈亏',
    d: '持仓还没平掉，盈亏跟着现价实时变化，平仓那一刻才真正落袋。',
    e: '卡片上的 +$12.40 只是「账面」的，点了平仓才算数。',
  },
  candle: {
    t: 'K 线',
    d: '一根蜡烛记录一段时间的开盘、收盘、最高、最低四个价格。',
    e: '红蜡烛=收盘比开盘高（涨），绿蜡烛=收盘比开盘低（跌）。本游戏 1.5 秒一根。',
  },
  demo: {
    t: '模拟盘',
    d: '全程虚拟资金，行情由本地算法生成，不涉及任何真实货币。',
    e: '随便亏，亏的是数字；学到的经验是你自己的。',
  },
};

export function initExplain() {
  const sheet = document.getElementById('termSheet');
  const title = document.getElementById('termTitle');
  const body = document.getElementById('termBody');
  const example = document.getElementById('termExample');
  const close = () => sheet.classList.add('hide');

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-term]');
    if (!el) return;
    ev.stopPropagation();
    const term = TERMS[el.dataset.term];
    if (!term) return;
    title.textContent = term.t;
    body.textContent = term.d;
    example.textContent = '举个例子：' + term.e;
    sheet.classList.remove('hide');
  });
  sheet.querySelector('.sheet-scrim').addEventListener('click', close);
  document.getElementById('termClose').addEventListener('click', close);
}
