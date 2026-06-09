// content.js - 视频加速核心脚本
(function () {
  'use strict';

  const processedVideos = new WeakSet();
  const classMap = new Map(); // video -> speed-label element pair

  // ========== 注入 CSS 样式 ==========
  function injectStyles() {
    if (document.getElementById('vsc-styles')) return;
    const style = document.createElement('style');
    style.id = 'vsc-styles';
    style.textContent = `
      .vsc-speed-badge {
        position: absolute;
        top: 8px;
        left: 8px;
        background: rgba(0,0,0,0.75);
        color: #a6e3a1;
        font-size: 14px;
        font-weight: bold;
        font-family: "Microsoft YaHei", sans-serif;
        padding: 4px 10px;
        border-radius: 6px;
        z-index: 2147483647;
        pointer-events: none;
        transition: opacity 0.3s;
        letter-spacing: 1px;
      }
      .vsc-speed-controller {
        position: absolute;
        bottom: 8px;
        right: 8px;
        background: rgba(0,0,0,0.8);
        border-radius: 8px;
        padding: 6px 10px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 6px;
        font-family: "Microsoft YaHei", sans-serif;
        transition: opacity 0.3s;
      }
      .vsc-speed-controller button {
        background: #313244;
        color: #cdd6f4;
        border: none;
        border-radius: 4px;
        width: 28px;
        height: 28px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        line-height: 1;
      }
      .vsc-speed-controller button:hover { background: #45475a; }
      .vsc-speed-controller .vsc-speed-display {
        color: #a6e3a1;
        font-weight: bold;
        font-size: 13px;
        min-width: 52px;
        text-align: center;
        cursor: pointer;
        user-select: none;
      }
      .vsc-speed-controller .vsc-speed-display:hover { text-decoration: underline; }
    `;
    document.head.appendChild(style);
  }

  // ========== 创建 UI 组件 ==========
  function createBadge(video, parent) {
    const badge = document.createElement('div');
    badge.className = 'vsc-speed-badge';
    badge.textContent = video.playbackRate.toFixed(1) + 'x';
    badge.style.opacity = '0';
    parent.appendChild(badge);
    return badge;
  }

  function createController(video, wrapper) {
    const ctrl = document.createElement('div');
    ctrl.className = 'vsc-speed-controller';
    ctrl.style.opacity = '0';

    const dec = document.createElement('button');
    dec.textContent = '−';
    dec.title = '减速 (Q)';

    const display = document.createElement('span');
    display.className = 'vsc-speed-display';
    display.textContent = video.playbackRate.toFixed(1) + 'x';
    display.title = '点击输入速度';

    const inc = document.createElement('button');
    inc.textContent = '+';
    inc.title = '加速 (E)';

    const reset = document.createElement('button');
    reset.textContent = '1×';
    reset.title = '重置为1x (R)';
    reset.style.width = '32px';
    reset.style.fontSize = '12px';

    ctrl.appendChild(dec);
    ctrl.appendChild(display);
    ctrl.appendChild(inc);
    ctrl.appendChild(reset);
    wrapper.appendChild(ctrl);

    // 事件绑定
    dec.addEventListener('click', (e) => {
      e.stopPropagation();
      changeSpeed(video, -0.25);
    });
    inc.addEventListener('click', (e) => {
      e.stopPropagation();
      changeSpeed(video, +0.25);
    });
    reset.addEventListener('click', (e) => {
      e.stopPropagation();
      setSpeed(video, 1.0);
    });
    display.addEventListener('click', (e) => {
      e.stopPropagation();
      const input = prompt('输入播放速度 (0.25 - 32)：', video.playbackRate);
      if (input !== null) {
        const val = parseFloat(input);
        if (!isNaN(val) && val >= 0.25 && val <= 32) {
          setSpeed(video, val);
        }
      }
    });

    return { controller: ctrl, display, badge: null };
  }

  // ========== 速度控制 ==========
  function setSpeed(video, speed) {
    const clamped = Math.max(0.25, Math.min(32, speed));
    video.playbackRate = clamped;
    updateUI(video, clamped);
    return clamped;
  }

  function changeSpeed(video, delta) {
    const current = video.playbackRate;
    // 智能步长：高速时步长大，低速时步长小
    let step = delta > 0
      ? (current >= 16 ? 4 : current >= 8 ? 2 : current >= 4 ? 1 : current >= 2 ? 0.5 : 0.25)
      : (current > 16 ? 4 : current > 8 ? 2 : current > 4 ? 1 : current > 2 ? 0.5 : 0.25);
    setSpeed(video, delta > 0 ? current + step : current - step);
  }

  function updateUI(video, speed) {
    const entry = classMap.get(video);
    if (!entry) return;
    const text = speed.toFixed(speed < 2 ? 2 : 1) + 'x';
    if (entry.display) entry.display.textContent = text;
    if (entry.badge) entry.badge.textContent = text;
  }

  // ========== 包装视频元素 ==========
  function wrapVideo(video) {
    if (processedVideos.has(video)) return;
    processedVideos.add(video);

    // 确保 video 有父容器且 position 被正确设置
    const parent = video.parentElement;
    if (!parent) return;

    // 如果父容器不是定位元素，且没有 wrapper，创建一个
    let wrapper = parent;
    const parentStyle = getComputedStyle(parent);
    if (parentStyle.position === 'static' || parent.tagName === 'BODY') {
      wrapper = document.createElement('div');
      wrapper.className = 'vsc-video-wrapper';
      wrapper.style.cssText = 'position:relative;display:inline-block;line-height:0;';
      parent.insertBefore(wrapper, video);
      wrapper.appendChild(video);
    } else if (parentStyle.position === 'static') {
      parent.style.position = 'relative';
    }

    const badge = createBadge(video, wrapper);
    const { controller, display } = createController(video, wrapper);

    classMap.set(video, { display, badge, controller });

    // 鼠标悬停显示/隐藏
    let hideTimer;
    wrapper.addEventListener('mouseenter', () => {
      badge.style.opacity = '1';
      controller.style.opacity = '1';
      clearTimeout(hideTimer);
    });
    wrapper.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(() => {
        badge.style.opacity = '0';
        controller.style.opacity = '0';
      }, 1500);
    });
  }

  // ========== 键盘快捷键 ==========
  document.addEventListener('keydown', (e) => {
    // 不拦截输入框内的按键
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;

    const videos = document.querySelectorAll('video');
    if (videos.length === 0) return;

    // 找到当前最可能的目标视频（优先正在播放的）
    let target = null;
    for (const v of videos) {
      if (!v.paused && !v.ended) { target = v; break; }
    }
    if (!target) target = videos[0];

    switch (e.key.toUpperCase()) {
      case 'D':
        // D = 加速
        e.preventDefault();
        changeSpeed(target, 0.25);
        break;
      case 'S':
        // S = 减速
        e.preventDefault();
        changeSpeed(target, -0.25);
        break;
      case 'R':
        // R = 重置为1x
        e.preventDefault();
        setSpeed(target, 1.0);
        break;
      case 'E':
        // E = 加速（备选）
        e.preventDefault();
        changeSpeed(target, 0.25);
        break;
    }
  });

  // ========== 监听来自 popup 的消息 ==========
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'setSpeed') {
      const videos = document.querySelectorAll('video');
      if (videos.length === 0) {
        sendResponse({ ok: false, msg: 'no video found' });
        return;
      }
      let target = null;
      for (const v of videos) {
        if (!v.paused && !v.ended) { target = v; break; }
      }
      if (!target) target = videos[0];
      setSpeed(target, msg.speed);
      sendResponse({ ok: true, speed: target.playbackRate });
    } else if (msg.action === 'getSpeed') {
      const videos = document.querySelectorAll('video');
      if (videos.length === 0) {
        sendResponse({ ok: false });
        return;
      }
      let target = null;
      for (const v of videos) {
        if (!v.paused && !v.ended) { target = v; break; }
      }
      if (!target) target = videos[0];
      sendResponse({ ok: true, speed: target.playbackRate });
    }
  });

  // ========== 初始化：扫描页面中的 video 元素 ==========
  function scanVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(v => wrapVideo(v));
  }

  // 页面加载后扫描
  injectStyles();
  scanVideos();

  // MutationObserver 监听新增的 video 元素（SPA 页面 / 动态加载）
  const observer = new MutationObserver((mutations) => {
    let foundNew = false;
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeName === 'VIDEO') {
          wrapVideo(node);
          foundNew = true;
        } else if (node.querySelectorAll) {
          const videos = node.querySelectorAll('video');
          videos.forEach(v => wrapVideo(v));
          if (videos.length > 0) foundNew = true;
        }
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
