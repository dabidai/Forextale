// 龙虎榜数据层：node:sqlite（Node ≥22.5 内置，零 npm 依赖）
// 排名依据：last = 当前总权益（实时榜，客户端约 3s 心跳上报）；best = 历史最高，保留展示
import { DatabaseSync } from 'node:sqlite';

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      token      TEXT PRIMARY KEY,
      name       TEXT    NOT NULL,
      best       REAL    NOT NULL DEFAULT 10000,
      last       REAL    NOT NULL DEFAULT 10000,
      trades     INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_players_best ON players(best DESC);
    CREATE INDEX IF NOT EXISTS idx_players_last ON players(last DESC);
  `);

  const q = {
    get: db.prepare('SELECT * FROM players WHERE token = ?'),
    upsertName: db.prepare(`
      INSERT INTO players (token, name, best, last, trades, updated_at, created_at)
      VALUES (?, ?, 10000, 10000, 0, ?, ?)
      ON CONFLICT(token) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
    `),
    sync: db.prepare(`
      UPDATE players SET best = MAX(best, ?), last = ?, trades = ?, updated_at = ?
      WHERE token = ?
    `),
    rank: db.prepare('SELECT COUNT(*) + 1 AS rk FROM players WHERE last > ?'),
    total: db.prepare('SELECT COUNT(*) AS n FROM players'),
    top: db.prepare(`
      SELECT token, name, best, last, trades, updated_at FROM players
      ORDER BY last DESC, updated_at ASC LIMIT ?
    `),
  };

  return {
    // 注册 / 改名：同 token 视为同一玩家
    getOrCreatePlayer(token, name, now) {
      q.upsertName.run(token, name, now, now);
      return q.get.get(token);
    },
    getPlayer(token) {
      return q.get.get(token) ?? null;
    },
    // 上报当前权益：last 实时刷新（实时榜排名依据），best 只取历史最高保留
    sync(token, equity, trades, now) {
      if (!q.get.get(token)) return null;
      q.sync.run(equity, equity, trades, now, token);
      return q.get.get(token);
    },
    rankOf(last) {
      return q.rank.get(last).rk;
    },
    total() {
      return q.total.get().n;
    },
    top(n) {
      return q.top.all(n);
    },
    // 榜单里标记「这一行是不是我」：token 只留在服务端比对，不下发
    topFor(n, myToken) {
      return q.top.all(n).map((r) => ({ ...r, mine: myToken != null && r.token === myToken }));
    },
  };
}
