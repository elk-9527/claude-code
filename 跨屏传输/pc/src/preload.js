'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 暴露给主控制面板 (index.html)
contextBridge.exposeInMainWorld('api', {
  refreshDevices: () => ipcRenderer.invoke('refresh-devices'),
  connect: (serial) => ipcRenderer.invoke('connect', serial),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  ping: () => ipcRenderer.invoke('ping'),
  minimize: () => ipcRenderer.send('window-min'),
  close: () => ipcRenderer.send('window-close'),
  // 主进程 -> 渲染层 状态推送
  on: (channel, cb) => {
    const allowed = ['connecting', 'connected', 'disconnected', 'error', 'crossing', 'device-status', 'latency'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});

// 暴露给穿越覆盖层 (overlay.html)
contextBridge.exposeInMainWorld('overlay', {
  onShow: (cb) => ipcRenderer.on('overlay-show', (_e, p) => cb(p)),
  send: (ev) => ipcRenderer.send('cross-event', ev),
});
