'use strict';
// 主控制面板渲染逻辑

const $ = (id) => document.getElementById(id);
let selectedSerial = null;
let isConnected = false;

// 窗口控制
$('btn-min').onclick = () => window.api.minimize();
$('btn-close').onclick = () => window.api.close();

// 刷新设备列表
async function refresh() {
  const res = await window.api.refreshDevices();
  const list = $('deviceList');
  if (!res.ok) {
    list.innerHTML = `<div class="empty">无法调用 adb：${res.message}</div>`;
    return;
  }
  if (!res.devices.length) {
    list.innerHTML = `<div class="empty">未检测到设备，请插上 USB 数据线<br/>并在平板上允许「USB 调试」</div>`;
    selectedSerial = null;
    $('btn-connect').disabled = true;
    return;
  }
  list.innerHTML = '';
  for (const d of res.devices) {
    const el = document.createElement('div');
    el.className = 'device-item';
    el.innerHTML = `
      <span class="device-icon">📱</span>
      <span class="device-meta">
        <span class="device-name">${d.model}</span>
        <span class="device-serial">${d.serial}</span>
      </span>`;
    el.onclick = () => selectDevice(d.serial, el);
    list.appendChild(el);
  }
  // 默认选中第一个
  selectDevice(res.devices[0].serial, list.firstChild);
}

function selectDevice(serial, el) {
  selectedSerial = serial;
  document.querySelectorAll('.device-item').forEach((n) => n.classList.remove('selected'));
  if (el) el.classList.add('selected');
  $('btn-connect').disabled = isConnected;
}

$('btn-refresh').onclick = refresh;

$('btn-connect').onclick = () => {
  if (!selectedSerial) return;
  window.api.connect(selectedSerial);
};
$('btn-disconnect').onclick = () => window.api.disconnect();

// ---------- 状态回调 ----------
window.api.on('connecting', () => {
  $('statusCard').hidden = false;
  setStatus('amber', '正在建立 USB 隧道…');
});

window.api.on('connected', (dev) => {
  isConnected = true;
  setStatus('green', `已连接 · ${dev.model || dev.name}`);
  $('subtitle').textContent = `${dev.w}×${dev.h} · USB 直连`;
  $('logoRing').classList.add('live');
  $('logoRing').querySelector('.logo-glyph').textContent = '✓';
  $('btn-connect').hidden = true;
  $('btn-disconnect').hidden = false;
  $('crossTip').hidden = false;
  // 启动心跳
  startPing();
});

window.api.on('disconnected', () => {
  isConnected = false;
  setStatus('red', '已断开');
  $('subtitle').textContent = '用 USB 连接你的平板';
  $('logoRing').classList.remove('live');
  $('logoRing').querySelector('.logo-glyph').textContent = '⇆';
  $('btn-connect').hidden = false;
  $('btn-connect').disabled = !selectedSerial;
  $('btn-disconnect').hidden = true;
  $('crossTip').hidden = true;
  $('latencyText').textContent = '';
  stopPing();
});

window.api.on('error', (e) => {
  $('statusCard').hidden = false;
  setStatus('red', '错误：' + e.message);
});

window.api.on('crossing', (s) => {
  if (s.on) setStatus('green', '🖱️ 已穿越到平板（鼠标回到左边缘退回）');
  else if (isConnected) setStatus('green', '已连接');
});

window.api.on('device-status', (s) => {
  const hints = $('permHints');
  const items = [];
  if (!s.accessibility) items.push('<span class="warn">⚠ 平板未开启「无障碍」服务，无法控制</span>');
  if (!s.overlay) items.push('<span class="warn">⚠ 平板未授予「悬浮窗」权限，看不到光标</span>');
  hints.innerHTML = items.join('');
});

window.api.on('latency', (l) => {
  $('latencyText').textContent = l.ms >= 0 ? `${l.ms} ms` : '';
});

function setStatus(color, text) {
  $('statusDot').className = 'dot ' + color;
  $('statusText').textContent = text;
}

// 心跳
let pingTimer = null;
function startPing() { stopPing(); pingTimer = setInterval(() => window.api.ping(), 2000); }
function stopPing() { if (pingTimer) clearInterval(pingTimer); pingTimer = null; }

// 启动即刷新,并每 3 秒自动刷新设备列表(未连接时)
refresh();
setInterval(() => { if (!isConnected) refresh(); }, 3000);
