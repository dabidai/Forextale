# 汇市物语（Forextale）

原创外汇模拟交易科普小游戏：用几分钟学会「做多、做空、杠杆、止损」，在纯模拟盘里亲历外汇经典时刻。纯模拟、无真实资金、无需注册。

- 设计文档：[docs/PLAN.md](docs/PLAN.md) ｜ P0 数值草案：[docs/NUMBERS.md](docs/NUMBERS.md)
- 当前进度：**P0 / M1 核心循环**

## 本地运行

```bash
npm start        # node tools/server.mjs → http://localhost:8123（静态站点 + 龙虎榜 API）
npm test         # 冒烟测试（node 原生，无依赖）
```

ESM 模块不能直接双击 HTML 打开，需要静态服务器。

## 部署到服务器

完整步骤（上传 → systemd 常驻 → nginx 反代 → HTTPS → 备份）见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。要点：任意 Node ≥ 22.5 机器上 `node tools/server.mjs` 即可，零 npm 依赖；数据库为单文件 SQLite，备份即拷贝。

## 龙虎榜 API

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/player` | POST | 注册/改名 `{name, token?}` → `{token, rank, total}` |
| `/api/sync` | POST | 上报 `{token, equity, trades}`，服务端记历史最高 |
| `/api/leaderboard` | GET | `?token=` 可选，返回前 50 名 + 我的排名 |

## 结构

```
index.html / styles.css      入口与样式
src/core/                    PRNG（可复现随机）、localStorage 存档、事件总线
src/market/                  货币对定义、种子化模拟行情（漂移/冲击/新手保护/事件注入）
src/engine/                  账户、保证金、多空开平仓、止盈止损、爆仓、等级解锁
src/chart/                   Canvas 手绘 K 线（缩放/拖动/现价线/持仓线）
src/ui/                      面板、动效包、事件卡、结算/爆仓弹窗、点词解释、引导第一单
tools/serve.mjs              本地静态服务器（零依赖）
tests/smoke.mjs              冒烟测试
```

## 免责声明

模拟游戏，行情与数据均为虚构，不构成任何投资建议。
