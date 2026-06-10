'use strict';
/**
 * 跨屏协同 PC 端 - 主进程
 * 职责:
 *  1. 管理 adb(检测设备 / 建立 USB 隧道 forward)
 *  2. 通过隧道与平板 APK 的 TCP 服务通信(NDJSON)
 *  3. 管理穿越覆盖层窗口,把鼠键事件转成协议指令发往平板
 */

const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const net = require('net');
const { spawn, execFile } = require('child_process');

// 平板 APK 内 TCP 服务端口(见 PROTOCOL.md)
const DEVICE_PORT = 5566;
// PC 本地随机端口,adb forward 到设备端口
let LOCAL_PORT = 0;

let mainWin = null;     // 主控制面板窗口
let overlayWin = null;  // 穿越时的全屏透明覆盖窗口
let sock = null;        // 与平板的 TCP 连接
let recvBuf = '';       // NDJSON 拆包缓冲
let device = null;      // { name, model, w, h }
let connected = false;
let crossing = false;   // 是否正处于「已穿越到平板」状态

// ---------- adb 封装 ----------
// adb 已在 PATH(D:\platform-tools\adb.exe);也允许通过环境变量覆盖
const ADB = process.env.CROSSSCREEN_ADB || 'adb';

function adb(args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(ADB, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}

// 列出已通过 USB 连接、且授权的设备
async function listDevices() {
  const { stdout } = await adb(['devices', '-l']);
  const lines = stdout.split('\n').slice(1);
  const out = [];
  for (const line of lines) {
    const m = line.trim().match(/^(\S+)\s+(\S+)(.*)$/);
    if (!m) continue;
    const [, serial, state, rest] = m;
    if (state !== 'device') continue; // 跳过 unauthorized / offline
    const modelMatch = rest.match(/model:(\S+)/);
    out.push({ serial, model: modelMatch ? modelMatch[1] : serial });
  }
  return out;
}

// 给某设备建立 USB 隧道:本地随机端口 -> 设备 5566
async function setupForward(serial) {
  // tcp:0 让 adb 分配一个空闲本地端口并回显
  const { stdout, err, stderr } = await adb(['-s', serial, 'forward', 'tcp:0', `tcp:${DEVICE_PORT}`]);
  if (err) throw new Error('adb forward 失败: ' + (stderr || err.message));
  LOCAL_PORT = parseInt(stdout, 10);
  if (!LOCAL_PORT) throw new Error('未能获取 forward 端口: ' + stdout);
  return LOCAL_PORT;
}

async function removeForwards() {
  await adb(['forward', '--remove-all']);
}

// ---------- 与平板的 TCP 连接 ----------
function connectSocket() {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: '127.0.0.1', port: LOCAL_PORT }, () => {
      sock = s;
      connected = true;
      send({ type: 'hello', name: require('os').hostname(), version: app.getVersion() });
      resolve();
    });
    s.setNoDelay(true);
    s.on('data', onData);
    s.on('error', (e) => { reject(e); cleanupSocket(); });
    s.on('close', () => { cleanupSocket(); });
  });
}

function cleanupSocket() {
  connected = false;
  crossing = false;
  device = null;
  stopEdgeWatch();
  if (sock) { try { sock.destroy(); } catch (_) {} sock = null; }
  recvBuf = '';
  if (overlayWin) hideOverlay();
  sendUI('disconnected', {});
}

function send(obj) {
  if (!sock || !connected) return;
  try { sock.write(JSON.stringify(obj) + '\n'); } catch (_) {}
}

// 拆 NDJSON 包
function onData(chunk) {
  recvBuf += chunk.toString('utf8');
  let idx;
  while ((idx = recvBuf.indexOf('\n')) >= 0) {
    const line = recvBuf.slice(0, idx);
    recvBuf = recvBuf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { continue; }
    handleDeviceMsg(msg);
  }
}

function handleDeviceMsg(msg) {
  switch (msg.type) {
    case 'welcome':
      device = { name: msg.name, model: msg.model, w: msg.w, h: msg.h };
      sendUI('connected', device);
      startEdgeWatch();
      break;
    case 'screen':
      if (device) { device.w = msg.w; device.h = msg.h; }
      break;
    case 'status':
      sendUI('device-status', msg);
      break;
    case 'pong':
      sendUI('latency', { ms: Date.now() - msg.t });
      break;
  }
}

// ---------- 连接编排 ----------
async function doConnect(serial) {
  try {
    sendUI('connecting', {});
    await setupForward(serial);
    await connectSocket();
  } catch (e) {
    cleanupSocket();
    sendUI('error', { message: e.message });
  }
}

async function doDisconnect() {
  cleanupSocket();
  await removeForwards();
}

// ---------- 右边缘穿越检测(纯 Electron,无原生 hook) ----------
// 已连接且未穿越时,轮询全局鼠标位置;触到主屏右边缘则进入穿越。
let edgeTimer = null;
function startEdgeWatch() {
  stopEdgeWatch();
  edgeTimer = setInterval(() => {
    if (!connected || crossing) return;
    const disp = screen.getPrimaryDisplay();
    const { x, width, y, height } = disp.bounds;
    const rightEdge = x + width - 2;
    const pt = screen.getCursorScreenPoint();
    if (pt.x >= rightEdge) {
      // 用触边时的纵向比例作为进入平板的 y,横向从左侧少许进入
      const relY = Math.max(0, Math.min(1, (pt.y - y) / height));
      enterCrossing(0.04, relY);
    }
  }, 30);
}
function stopEdgeWatch() { if (edgeTimer) clearInterval(edgeTimer); edgeTimer = null; }

// ---------- 穿越覆盖层 ----------
// 进入平板控制:弹出全屏透明置顶窗口接管鼠键
function enterCrossing(initX = 0.02, initY = 0.5) {
  if (!connected || crossing) return;
  crossing = true;
  send({ type: 'enter', x: initX, y: initY });
  showOverlay();
  sendUI('crossing', { on: true });
}

function leaveCrossing() {
  if (!crossing) return;
  crossing = false;
  send({ type: 'leave' });
  hideOverlay();
  sendUI('crossing', { on: false });
}

function showOverlay() {
  if (!overlayWin) return;
  const disp = screen.getPrimaryDisplay();
  const { x, y, width, height } = disp.bounds;
  overlayWin.setBounds({ x, y, width, height });
  overlayWin.showInactive();
  overlayWin.setIgnoreMouseEvents(false);
  overlayWin.focus();
  overlayWin.webContents.send('overlay-show', { devW: device?.w, devH: device?.h });
}

function hideOverlay() {
  if (overlayWin) overlayWin.hide();
}

// ---------- 窗口 ----------
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 420,
    height: 620,
    resizable: false,
    title: '跨屏协同',
    backgroundColor: '#00000000',
    titleBarStyle: 'hiddenInset',
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.on('closed', () => { mainWin = null; });
}

function createOverlayWindow() {
  overlayWin = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
}

// ---------- IPC(来自渲染层 / 覆盖层) ----------
ipcMain.handle('refresh-devices', async () => {
  try { return { ok: true, devices: await listDevices() }; }
  catch (e) { return { ok: false, message: e.message }; }
});
ipcMain.handle('connect', async (_e, serial) => { await doConnect(serial); return { ok: true }; });
ipcMain.handle('disconnect', async () => { await doDisconnect(); return { ok: true }; });
ipcMain.handle('ping', async () => { send({ type: 'ping', t: Date.now() }); return { ok: true }; });

// 覆盖层把归一化鼠键事件转发上来
ipcMain.on('cross-event', (_e, ev) => {
  if (!crossing) return;
  switch (ev.kind) {
    case 'cursor': send({ type: 'cursor', x: ev.x, y: ev.y }); break;
    case 'tap':    send({ type: 'tap', x: ev.x, y: ev.y }); break;
    case 'longpress': send({ type: 'longpress', x: ev.x, y: ev.y }); break;
    case 'swipe':  send({ type: 'swipe', x1: ev.x1, y1: ev.y1, x2: ev.x2, y2: ev.y2, duration: ev.duration }); break;
    case 'text':   send({ type: 'text', value: ev.value }); break;
    case 'key':    send({ type: 'key', code: ev.code }); break;
    case 'leave':  leaveCrossing(); break;
  }
});

ipcMain.on('window-min', () => mainWin && mainWin.minimize());
ipcMain.on('window-close', () => app.quit());

function sendUI(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}

// ---------- 生命周期 ----------
app.whenReady().then(() => {
  createMainWindow();
  createOverlayWindow();

  // 热键:Ctrl+Alt+Right 手动进入穿越;Esc 在覆盖层里退回(覆盖层内部处理)
  globalShortcut.register('Control+Alt+Right', () => enterCrossing());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  await removeForwards();
});

app.on('window-all-closed', () => { app.quit(); });
