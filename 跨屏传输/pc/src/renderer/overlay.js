'use strict';
/**
 * 穿越覆盖层逻辑:
 *  - 接管鼠标:移动 -> cursor;按下抬起 -> tap / longpress / swipe
 *  - 接管键盘:可打印字符 -> text;特殊键 -> key
 *  - 鼠标移到本窗口最左边缘 或 按 Esc -> leave 退回 PC
 *  坐标统一归一化到 [0,1] 再发给主进程
 */

const ghost = document.getElementById('ghost');
const edge = document.getElementById('edge');

let W = window.innerWidth;
let H = window.innerHeight;
window.addEventListener('resize', () => { W = window.innerWidth; H = window.innerHeight; });

window.overlay.onShow(() => {
  W = window.innerWidth; H = window.innerHeight;
  // 进入时把光标放到左侧一点,避免立刻触发退回
  moveGhost(W * 0.04, H * 0.5);
});

function nx(px) { return Math.max(0, Math.min(1, px / W)); }
function ny(px) { return Math.max(0, Math.min(1, px / H)); }

function moveGhost(px, py) {
  ghost.style.left = px + 'px';
  ghost.style.top = py + 'px';
}

// ---------- 鼠标 ----------
let down = false;
let downX = 0, downY = 0, downT = 0;
let lastSendT = 0;
let longPressTimer = null;

document.addEventListener('mousemove', (e) => {
  moveGhost(e.clientX, e.clientY);

  // 左边缘回退(留 4px 触发带)
  if (e.clientX <= 4) {
    edge.style.opacity = '1';
    window.overlay.send({ kind: 'leave' });
    return;
  } else {
    edge.style.opacity = '0';
  }

  // 节流发送光标(约 120fps 上限,实际受 mousemove 频率)
  const now = performance.now();
  if (now - lastSendT > 8) {
    lastSendT = now;
    window.overlay.send({ kind: 'cursor', x: nx(e.clientX), y: ny(e.clientY) });
  }
});

document.addEventListener('mousedown', (e) => {
  down = true;
  downX = e.clientX; downY = e.clientY; downT = performance.now();
  // 长按检测
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    if (down) {
      window.overlay.send({ kind: 'longpress', x: nx(downX), y: ny(downY) });
      down = false; // 已消费
    }
  }, 550);
});

document.addEventListener('mouseup', (e) => {
  clearTimeout(longPressTimer);
  if (!down) return;
  down = false;
  const dx = e.clientX - downX;
  const dy = e.clientY - downY;
  const dist = Math.hypot(dx, dy);
  const dt = performance.now() - downT;
  if (dist > 18) {
    // 滑动
    window.overlay.send({
      kind: 'swipe',
      x1: nx(downX), y1: ny(downY),
      x2: nx(e.clientX), y2: ny(e.clientY),
      duration: Math.min(800, Math.max(80, Math.round(dt))),
    });
  } else {
    // 单击
    window.overlay.send({ kind: 'tap', x: nx(e.clientX), y: ny(e.clientY) });
  }
});

// 滚轮 -> 反向滑动(向下滚 = 内容上移 = 手指上滑)
let wheelAccum = 0, wheelTimer = null;
document.addEventListener('wheel', (e) => {
  wheelAccum += e.deltaY;
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => {
    const cx = nx(e.clientX);
    const cy = ny(e.clientY);
    const amount = Math.max(-0.4, Math.min(0.4, wheelAccum / 1200));
    window.overlay.send({
      kind: 'swipe',
      x1: cx, y1: cy,
      x2: cx, y2: Math.max(0, Math.min(1, cy - amount)),
      duration: 200,
    });
    wheelAccum = 0;
  }, 40);
}, { passive: true });

// ---------- 键盘 ----------
const SPECIAL = {
  Escape: '__LEAVE__',
  Backspace: 'DEL',
  Enter: 'ENTER',
  Tab: 'TAB',
};

document.addEventListener('keydown', (e) => {
  // Esc 退回
  if (e.key === 'Escape') {
    e.preventDefault();
    window.overlay.send({ kind: 'leave' });
    return;
  }
  // 系统导航热键:Alt+← 返回 / Alt+Home 主页 / Alt+↑ 多任务
  if (e.altKey) {
    if (e.key === 'ArrowLeft') { send('key', { code: 'BACK' }); return e.preventDefault(); }
    if (e.key === 'ArrowUp') { send('key', { code: 'RECENTS' }); return e.preventDefault(); }
    if (e.key === 'Home') { send('key', { code: 'HOME' }); return e.preventDefault(); }
  }
  const sp = SPECIAL[e.key];
  if (sp && sp !== '__LEAVE__') {
    e.preventDefault();
    send('key', { code: sp });
    return;
  }
  // 可打印单字符
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    send('text', { value: e.key });
  }
});

function send(kind, extra) { window.overlay.send(Object.assign({ kind }, extra)); }
