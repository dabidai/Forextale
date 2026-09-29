// 货币对定义与解锁等级（数值草案见 docs/NUMBERS.md）
export const LOT = 100000; // 1 手 = 100,000 基础货币

export const PAIRS = [
  {
    id: 'EURUSD', symbol: 'EUR/USD', name: '欧元/美元',
    base: 'EUR', quote: 'USD', pip: 0.0001, digits: 5,
    start: 1.0850, vol: 0.00035, unlockLv: 1,
    intro: '全球交易量最大的货币对，波动相对温和，适合新手。',
  },
  {
    id: 'USDJPY', symbol: 'USD/JPY', name: '美元/日元',
    base: 'USD', quote: 'JPY', pip: 0.01, digits: 3,
    start: 149.50, vol: 0.035, unlockLv: 2,
    intro: '套息交易的热门品种，日本央行议息日常有巨震。',
  },
  {
    id: 'GBPUSD', symbol: 'GBP/USD', name: '英镑/美元',
    base: 'GBP', quote: 'USD', pip: 0.0001, digits: 5,
    start: 1.2650, vol: 0.00045, unlockLv: 3,
    intro: '比欧元更猛的波动，绰号「Cable」。',
  },
  {
    id: 'AUDUSD', symbol: 'AUD/USD', name: '澳元/美元',
    base: 'AUD', quote: 'USD', pip: 0.0001, digits: 5,
    start: 0.6550, vol: 0.00032, unlockLv: 4,
    intro: '商品货币，跟着铁矿石和大宗商品走。',
  },
  {
    id: 'USDCHF', symbol: 'USD/CHF', name: '美元/瑞郎',
    base: 'USD', quote: 'CHF', pip: 0.0001, digits: 5,
    start: 0.8850, vol: 0.00030, unlockLv: 4,
    intro: '避险瑞郎：全球一恐慌，它就受追捧。',
  },
  {
    id: 'EURCHF', symbol: 'EUR/CHF', name: '欧元/瑞郎',
    base: 'EUR', quote: 'CHF', pip: 0.0001, digits: 5,
    start: 1.2000, vol: 0.00030, unlockLv: 99, battleOnly: true,
    basePair: 'EURUSD', quotePair: 'USDCHF',
    intro: '经典战役专用战场：2015 瑞郎脱钩黑天鹅。',
  },
];

export const pairById = (id) => PAIRS.find((p) => p.id === id);
