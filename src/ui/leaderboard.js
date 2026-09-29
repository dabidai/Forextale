// 龙虎榜：注册代号、自动上报战绩、拉取动态排行（服务端不可用时优雅降级为单机模式）
const KEY = 'forextale_player';
const $ = (id) => document.getElementById(id);
const fmt$ = (v) => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function getPlayer() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? null;
  } catch {
    return null;
  }
}

function savePlayer(p) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export async function register(name) {
  const cur = getPlayer();
  const res = await fetch('/api/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: cur?.token, name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '注册失败');
  savePlayer({ token: data.token, name: data.name, best: data.best });
  return data;
}

let lastSync = 0;
let lastSig = '';

// 上报当前权益（内部节流 3s；无变化 15s 内跳过；战役模式由调用方跳过）
export async function syncScore(equity, trades, open = false) {
  const cur = getPlayer();
  if (!cur) return;
  const now = Date.now();
  if (now - lastSync < 3000) return;
  const sig = `${equity}|${trades}|${open ? 1 : 0}`;
  if (sig === lastSig && now - lastSync < 15000) return; // 空仓且没变化：偶尔报一次保活即可
  lastSync = now;
  lastSig = sig;
  try {
    await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: cur.token, equity, trades }),
    });
  } catch {
    // 单机模式：静默失败，下次再试
  }
}

async function fetchBoard(token) {
  const res = await fetch('/api/leaderboard' + (token ? `?token=${encodeURIComponent(token)}` : ''));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '加载失败');
  return data;
}

/* ---------- 弹窗 UI ---------- */

let refreshTimer = null;
let getStats = () => ({ equity: 10000, trades: 0, open: false });

function rowEl(r, i) {
  const stale = Date.now() - r.updated_at > 30000; // 超过 30s 没心跳视为离线，权益冻结在最后一次上报
  const div = document.createElement('div');
  div.className = 'board-row' + (r.mine ? ' me' : '') + (stale ? ' offline' : '');
  const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}`;
  const pnl = r.last - 10000;
  const when = new Date(r.updated_at);
  const tm = `${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const left = document.createElement('div');
  left.className = 'br-l';
  const rk = document.createElement('b');
  rk.className = 'br-rank';
  rk.textContent = medal;
  const nm = document.createElement('span');
  nm.className = 'br-name';
  nm.textContent = r.name; // 昵称来自其他玩家，必须 textContent 防注入
  left.append(rk, nm);
  const right = document.createElement('div');
  right.className = 'br-r';
  const cur = document.createElement('b');
  cur.textContent = fmt$(r.last);
  const sub = document.createElement('span');
  sub.className = 'br-sub' + (pnl >= 0 ? ' up' : ' down');
  sub.textContent = `${fmt$(pnl)} · 巅峰 ${fmt$(r.best)} · ${r.trades}笔 · ${tm}${stale ? ' · 离线' : ''}`;
  right.append(cur, sub);
  div.append(left, right);
  return div;
}

async function refreshBoard() {
  const p = getPlayer();
  const box = $('boardList');
  try {
    const data = await fetchBoard(p?.token);
    box.textContent = '';
    if (!data.list.length) {
      box.textContent = '还没有人上榜，第一名就是你';
      return;
    }
    data.list.forEach((r, i) => box.appendChild(rowEl(r, i)));
    $('boardMe').classList.toggle('hide', !data.me);
    if (data.me) {
      $('boardMe').textContent =
        `我：${data.me.name} ｜ No.${data.me.rank}/${data.total} ｜ 当前 ${fmt$(data.me.last)}（巅峰 ${fmt$(data.me.best)}）`;
    }
    $('boardSub').textContent = `按当前总资产实时排名 · ${data.total} 名交易员已上榜 · 成绩自报仅供娱乐`;
  } catch (e) {
    box.textContent = '';
    const tip = document.createElement('div');
    tip.className = 'empty';
    tip.textContent = '龙虎榜需要服务端支持：用 `npm start`（node tools/server.mjs）启动后即可联机排行。';
    box.appendChild(tip);
  }
}

function showNameForm(prefill = '') {
  $('nameInput').value = prefill;
  $('nameErr').classList.add('hide');
  $('nameForm').classList.remove('hide');
  $('boardBody').classList.add('hide');
  setTimeout(() => $('nameInput').focus(), 50);
}

async function submitName() {
  const btn = $('nameGo');
  btn.disabled = true;
  try {
    await register($('nameInput').value);
    $('nameForm').classList.add('hide');
    $('boardBody').classList.remove('hide');
    await refreshBoard();
  } catch (e) {
    $('nameErr').textContent = e.message;
    $('nameErr').classList.remove('hide');
  } finally {
    btn.disabled = false;
  }
}

function openBoard() {
  $('boardModal').classList.remove('hide');
  const p = getPlayer();
  if (p) {
    $('boardBody').classList.remove('hide');
    $('nameForm').classList.add('hide');
    refreshBoard();
  } else {
    showNameForm();
  }
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!$('boardModal').classList.contains('hide') && getPlayer()) refreshBoard();
  }, 2000);
}

function closeBoard() {
  $('boardModal').classList.add('hide');
  clearInterval(refreshTimer);
}

export function initLeaderboard(getStatsFn) {
  getStats = getStatsFn;
  $('btnBoard').onclick = openBoard;
  $('boardClose').onclick = closeBoard;
  $('nameGo').onclick = submitName;
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitName(); });
  $('nameSkip').onclick = () => closeBoard();
  $('boardRename').onclick = () => showNameForm(getPlayer()?.name || '');
  $('boardRefresh').onclick = () => refreshBoard();
}

// 页面隐藏/交易平仓时调用
export function syncNow() {
  const { equity, trades, open } = getStats();
  syncScore(equity, trades, open);
}
