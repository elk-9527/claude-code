// Video Speed Controller - content script
// 含 B站 / YouTube 专项兼容

const MAX_SPEED = 32;
const MIN_SPEED = 0.1;
let currentSpeed = 1.0;

const STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
function nextStep(cur, dir) {
  if (dir > 0) {
    for (const s of STEPS) if (s > cur + 0.001) return s;
    return MAX_SPEED;
  } else {
    for (let i = STEPS.length - 1; i >= 0; i--) if (STEPS[i] < cur - 0.001) return STEPS[i];
    return MIN_SPEED;
  }
}

/* ── 平台检测 ── */
const IS_BILI = location.hostname.includes('bilibili.com');
const IS_YT   = location.hostname.includes('youtube.com');

/* ── YouTube: 绕过限速，直接操作原生 video ── */
// YouTube 在 video 上设了 playbackRate 监听器，会把值夹回 [0.25,2]。
// 解法：在原型层面绕过它的 setter，直接调原生。
let nativePlaybackRateSet = null;
let nativePlaybackRateGet = null;
function hookPlaybackRate() {
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  if (!desc || !desc.configurable) return;
  nativePlaybackRateSet = desc.set;
  nativePlaybackRateGet = desc.get;
  Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
    configurable: true,
    enumerable: desc.enumerable,
    get() { return nativePlaybackRateGet.call(this); },
    set(value) {
      // 外部（播放器）想把速度改回去时，若用户设了非 1x，忽略
      if (currentSpeed !== 1.0 && Math.abs(value - currentSpeed) > 0.01) {
        nativePlaybackRateSet.call(this, currentSpeed);
      } else {
        nativePlaybackRateSet.call(this, value);
      }
    },
  });
}

/* ── B站: 通过其官方 player API 同步速度 ── */
// bilibili player 暴露 window.player 对象，有 setPlaybackRate() 方法
function biliSetSpeed(speed) {
  try {
    // 新版 bpx-player
    const bpx = document.querySelector('.bpx-player-container');
    if (bpx && bpx.__vue_app__) {
      // 尝试通过 vue 实例拿播放器核心
    }
    // 通用：直接用 window.player（旧版/大多数页面都有）
    if (window.player && typeof window.player.setPlaybackRate === 'function') {
      window.player.setPlaybackRate(speed);
    }
    // 备用：事件通知 bpx-player
    document.dispatchEvent(new CustomEvent('bpx_player_set_playback_rate', { detail: { rate: speed } }));
  } catch (e) {}
}

/* ── 内核硬限制 ──
   Chromium 媒体管线把 playbackRate 的有效上限夹在 16x，
   设更高的值会被静默截断。超过 16x 时改用「定时推进 currentTime」
   补足缺失的时间，实现等效快进（跳帧式，无声音）。            */
const NATIVE_MAX = 16;
let boostTimer = null;

function stopBoost() {
  if (boostTimer) {
    clearInterval(boostTimer);
    boostTimer = null;
  }
}

// 设置单个媒体元素的 playbackRate（绕过站点 setter）
function setRate(v, rate) {
  try {
    if (nativePlaybackRateSet) nativePlaybackRateSet.call(v, rate);
    else v.playbackRate = rate;
  } catch (e) {}
}

function startBoost(targetSpeed) {
  stopBoost();
  // 媒体本身跑满 16x，剩余倍率靠定时器跳进度补
  const extra = targetSpeed - NATIVE_MAX; // 每秒需额外推进的秒数
  const TICK = 250; // ms，每秒补 4 次，越密越平滑但越耗性能
  boostTimer = setInterval(() => {
    document.querySelectorAll('video').forEach((v) => {
      if (v.paused || v.ended || !isFinite(v.duration)) return;
      try {
        const next = v.currentTime + (extra * TICK) / 1000;
        // 不越过缓冲末尾，避免卡死
        v.currentTime = Math.min(next, v.duration - 0.1);
      } catch (e) {}
    });
  }, TICK);
}

/* ── 核心：应用速度 ── */
function applySpeed(speed) {
  speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
  speed = Math.round(speed * 100) / 100;
  currentSpeed = speed;

  // 实际写入 playbackRate 的值：最高 16x（再高内核也只认 16）
  const nativeRate = Math.min(speed, NATIVE_MAX);
  document.querySelectorAll('video, audio').forEach((v) => setRate(v, nativeRate));

  // 超过 16x：启动跳帧补足；否则停掉补足定时器
  if (speed > NATIVE_MAX) startBoost(speed);
  else stopBoost();

  // B站额外同步 player API（让内置速度菜单同步显示，避免UI错位）
  if (IS_BILI) biliSetSpeed(nativeRate);

  // YouTube: 同步触发其 rate change 事件（让 YT 的进度条等不崩）
  if (IS_YT) {
    document.querySelectorAll('video').forEach((v) => {
      try { v.dispatchEvent(new Event('ratechange')); } catch (e) {}
    });
  }

  updateBar();
  flashBar();
  return currentSpeed;
}

/* ── MutationObserver：新插入的视频自动应用速度 ── */
const observer = new MutationObserver(() => {
  ensureBarIfVideo();
  if (currentSpeed !== 1.0) {
    const nativeRate = Math.min(currentSpeed, NATIVE_MAX);
    document.querySelectorAll('video, audio').forEach((v) => {
      if (Math.abs(v.playbackRate - nativeRate) > 0.01) {
        setRate(v, nativeRate);
      }
    });
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

/* ── 键盘快捷键 ── */
document.addEventListener('keydown', (e) => {
  if (!e.shiftKey) return;
  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.target && e.target.isContentEditable) return;
  if (e.code === 'Period')      { applySpeed(nextStep(currentSpeed, 1));  e.preventDefault(); }
  else if (e.code === 'Comma') { applySpeed(nextStep(currentSpeed, -1)); e.preventDefault(); }
  else if (e.code === 'Slash') { applySpeed(1.0);                         e.preventDefault(); }
});

/* ══════════════ 悬浮控制条 (Shadow DOM) ══════════════ */
let host = null, shadow = null, speedLabel = null, hideTimer = null;

function buildBar() {
  if (host) return;
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:80px;left:16px;z-index:2147483647;all:initial;';
  shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .bar{display:flex;align-items:center;gap:4px;
      background:rgba(20,20,30,0.92);color:#fff;
      font-family:'Segoe UI',sans-serif;font-size:13px;
      border-radius:10px;padding:4px;user-select:none;
      box-shadow:0 4px 16px rgba(0,0,0,.4);
      opacity:.28;transition:opacity .25s;cursor:default}
    .bar:hover,.bar.flash{opacity:1}
    .handle{cursor:move;padding:0 6px;font-size:14px;color:#89b4fa;touch-action:none}
    .speed{min-width:52px;text-align:center;font-weight:bold;font-size:15px;
      color:#89b4fa;cursor:move;touch-action:none}
    button{all:unset;box-sizing:border-box;width:26px;height:26px;border-radius:6px;
      background:#313244;color:#fff;text-align:center;line-height:26px;
      cursor:pointer;font-size:14px;transition:background .15s}
    button:hover{background:#89b4fa;color:#1e1e2e}
    .presets{display:flex;gap:3px;margin-left:4px;max-width:0;overflow:hidden;transition:max-width .25s}
    .bar:hover .presets,.bar.flash .presets{max-width:320px}
    .presets button{width:auto;padding:0 7px;font-size:12px}
    .close{background:transparent;color:#a6adc8;font-size:13px}
    .close:hover{background:#f38ba8;color:#fff}
    .site-tag{font-size:10px;color:#f9e2af;padding:0 4px;opacity:.8}
  `;
  shadow.appendChild(style);

  // 平台标签（方便用户确认当前兼容模式）
  const siteTag = IS_BILI ? '<span class="site-tag">B站</span>'
                : IS_YT   ? '<span class="site-tag">YT</span>'
                : '';

  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.innerHTML = `
    <span class="handle" title="拖动">⠿</span>
    ${siteTag}
    <button data-act="slower" title="减速 (Shift+,)">−</button>
    <span class="speed">1.0x</span>
    <button data-act="faster" title="加速 (Shift+.)">+</button>
    <button data-act="reset"  title="重置 (Shift+/)">↺</button>
    <span class="presets">
      <button data-set="2">2x</button>
      <button data-set="4">4x</button>
      <button data-set="8">8x</button>
      <button data-set="16">16x</button>
      <button data-set="32">32x</button>
    </span>
    <button class="close" data-act="close" title="隐藏">✕</button>
  `;
  shadow.appendChild(bar);
  speedLabel = bar.querySelector('.speed');

  bar.addEventListener('click', (e) => {
    const act = e.target.dataset.act, setv = e.target.dataset.set;
    if      (act === 'faster') applySpeed(nextStep(currentSpeed, 1));
    else if (act === 'slower') applySpeed(nextStep(currentSpeed, -1));
    else if (act === 'reset')  applySpeed(1.0);
    else if (act === 'close')  host.style.display = 'none';
    else if (setv)             applySpeed(parseFloat(setv));
  });

  setupDrag(bar.querySelector('.handle'));
  setupDrag(bar.querySelector('.speed'));
  (document.body || document.documentElement).appendChild(host);

  chrome.storage.local.get('barPos', ({ barPos }) => {
    if (barPos) { host.style.left = barPos.left + 'px'; host.style.top = barPos.top + 'px'; }
  });
  updateBar();
}

function setupDrag(el) {
  let dragging = false, offX = 0, offY = 0;
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    const r = host.getBoundingClientRect();
    offX = e.clientX - r.left; offY = e.clientY - r.top;
    el.setPointerCapture(e.pointerId); e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    host.style.left = Math.max(0, Math.min(window.innerWidth  - 60, e.clientX - offX)) + 'px';
    host.style.top  = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - offY)) + 'px';
  });
  el.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false; el.releasePointerCapture(e.pointerId);
    chrome.storage.local.set({ barPos: { left: parseInt(host.style.left), top: parseInt(host.style.top) } });
  });
}

function updateBar() { if (speedLabel) speedLabel.textContent = currentSpeed + 'x'; }
function flashBar() {
  if (!shadow) return;
  const bar = shadow.querySelector('.bar');
  bar.classList.add('flash');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => bar.classList.remove('flash'), 1500);
}

function ensureBarIfVideo() {
  if (document.querySelector('video')) buildBar();
}

/* ── popup 通信 ── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if      (msg.type === 'getSpeed')   sendResponse({ speed: currentSpeed });
  else if (msg.type === 'setSpeed')   sendResponse({ speed: applySpeed(msg.speed) });
  else if (msg.type === 'toggleBar') {
    if (host) host.style.display = host.style.display === 'none' ? 'block' : 'none';
    else buildBar();
    sendResponse({ ok: true });
  }
  return true;
});

hookPlaybackRate();
ensureBarIfVideo();
