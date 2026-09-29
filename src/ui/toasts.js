// 最小动效包：事件卡、平仓结算（数字滚动）、爆仓（红屏+震动）、升级横幅、轻提示
const $ = (id) => document.getElementById(id);

export function toast(msg, ms = 2200) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hide');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hide'), ms);
}

// 突发事件卡：顶部滑入，自动消失
export function showEventCard({ tag = '突发', title, body, ms = 7000 }) {
  const el = $('eventCard');
  el.innerHTML = `<span class="tag">${tag}</span><h4>${title}</h4><p>${body}</p>`;
  el.classList.remove('hide');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hide'), ms);
  el.onclick = () => el.classList.add('hide');
}

const fmt$ = (v) => (v < 0 ? '-$' : '+$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 平仓结算卡：大数字滚动 + 按盈亏着色
export function showSettlement({ pnl, reason }) {
  const el = $('settle');
  const win = pnl > 0;
  el.innerHTML = `<div class="sc ${win ? 'big' : ''}">
    <div class="sc-reason">${reason}</div>
    <div class="num ${win ? 'up' : pnl < 0 ? 'down' : ''}">$0.00</div>
    <div class="sc-note">${win ? '利润落袋 🎉' : pnl < 0 ? '止损是最好的朋友' : '保本出局'}</div>
  </div>`;
  el.classList.remove('hide');
  const numEl = el.querySelector('.num');
  const t0 = performance.now(), dur = 650;
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    numEl.textContent = fmt$(pnl * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hide'), 2200);
  el.onclick = () => el.classList.add('hide');
}

// 爆仓：红屏 + 震动 + 说明
export function showLiquidation({ lost, left }) {
  const el = $('liqOverlay');
  $('liqDetail').textContent =
    `强制平仓总盈亏 ${fmt$(lost)} ｜ 账户剩余 $${Math.max(0, left).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  el.classList.remove('hide');
  document.body.classList.remove('shake');
  void document.body.offsetWidth; // 重置动画
  document.body.classList.add('shake');
  if (navigator.vibrate) navigator.vibrate([80, 40, 120]);
}

// 升级横幅
export function showLevelUp({ lv, title, unlocks }) {
  const el = $('lvToast');
  const items = unlocks.map((u) => `<li>${u}</li>`).join('');
  el.innerHTML = `<b>🎉 升级！Lv.${lv} ${title}</b>${items ? `<ul>${items}</ul>` : ''}`;
  el.classList.remove('hide');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hide'), 4500);
}
