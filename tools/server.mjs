// 汇市物语服务端：静态站点 + 龙虎榜 API（node:sqlite，零 npm 依赖）
// 部署：任意 Node ≥22.5 机器上 `node tools/server.mjs`，SQLite 文件自动生成于 data/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openDb } from './db.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = process.env.PORT || 8123;
const HOST = process.env.HOST || '0.0.0.0'; // 生产环境建议 HOST=127.0.0.1，由 nginx 对外
const DB_PATH = process.env.DB || join(ROOT, 'data', 'forextale.db');

let lb = null;
try {
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  lb = openDb(DB_PATH);
  console.log('龙虎榜数据库 →', DB_PATH);
} catch (e) {
  console.warn('SQLite 不可用（需 Node ≥22.5），降级为纯静态服务：', e.message);
}

/* ---------- 龙虎榜 API ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(obj));
}

function cleanName(v) {
  const s = String(v ?? '').trim().slice(0, 12);
  return /^[\u4e00-\u9fa5a-zA-Z0-9_\-. ]+$/.test(s) ? s : null;
}

function cleanNum(v, lo, hi, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 8192) throw new Error('请求体过大');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// 简单限流：同 token 上报最小间隔 1.5s（休闲自榜，防手滑刷屏即可）
const lastSeen = new Map();
function tooFast(token) {
  const now = Date.now();
  if (now - (lastSeen.get(token) || 0) < 1500) return true;
  lastSeen.set(token, now);
  if (lastSeen.size > 5000) lastSeen.clear();
  return false;
}

async function api(req, res, url) {
  if (!lb) return json(res, 503, { error: '龙虎榜未启用（服务端需要 Node ≥22.5）' });
  const now = Date.now();

  if (url.pathname === '/api/player' && req.method === 'POST') {
    const body = await readBody(req);
    const name = cleanName(body.name);
    if (!name) return json(res, 400, { error: '代号限 1–12 个字符（中英文、数字、下划线）' });
    const token = typeof body.token === 'string' && /^[a-f0-9-]{8,64}$/i.test(body.token)
      ? body.token
      : randomUUID();
    const p = lb.getOrCreatePlayer(token, name, now);
    return json(res, 200, { token, name: p.name, best: p.best, last: p.last, trades: p.trades, rank: lb.rankOf(p.best), total: lb.total() });
  }

  if (url.pathname === '/api/sync' && req.method === 'POST') {
    const body = await readBody(req);
    const token = String(body.token ?? '');
    if (!lb.getPlayer(token)) return json(res, 404, { error: '请先注册代号' });
    if (tooFast(token)) return json(res, 200, { throttled: true });
    const equity = cleanNum(body.equity, 0, 1e9, 10000);
    const trades = Math.round(cleanNum(body.trades, 0, 1e6, 0));
    const p = lb.sync(token, equity, trades, now);
    return json(res, 200, { best: p.best, last: p.last, rank: lb.rankOf(p.best), total: lb.total() });
  }

  if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
    const token = url.searchParams.get('token');
    const list = lb.topFor(50, token);
    const p = token ? lb.getPlayer(token) : null;
    return json(res, 200, {
      list,
      me: p ? { name: p.name, best: p.best, last: p.last, trades: p.trades, rank: lb.rankOf(p.best) } : null,
      total: lb.total(),
      updatedAt: now,
    });
  }

  return json(res, 404, { error: 'not found' });
}

/* ---------- 静态站点 ---------- */

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const file = join(ROOT, normalize(path).replace(/^[/\\]+/, ''));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch (e) {
    if (url.pathname.startsWith('/api/')) {
      json(res, 400, { error: e.message || 'bad request' });
    } else {
      res.writeHead(404).end('Not Found');
    }
  }
}).listen(PORT, HOST, () => {
  console.log(`汇市物语（含龙虎榜） → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
