const PRESETS = [1, 1.5, 2, 3, 4, 8, 16, 32];
const slider = document.getElementById('slider');
const display = document.getElementById('display');
const presetsEl = document.getElementById('presets');

function render(speed) {
  display.textContent = speed + 'x';
  slider.value = speed;
  document.querySelectorAll('.presets button').forEach((b) => {
    b.classList.toggle('active', parseFloat(b.dataset.speed) === parseFloat(speed));
  });
}

// 获取当前活动标签页并发送消息
async function sendToTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    // content script 可能尚未注入
    return null;
  }
}

function setSpeed(speed) {
  speed = Math.round(speed * 100) / 100;
  render(speed);
  sendToTab({ type: 'setSpeed', speed });
  chrome.storage.local.set({ lastSpeed: speed });
}

// 构建预设按钮
PRESETS.forEach((s) => {
  const btn = document.createElement('button');
  btn.textContent = s + 'x';
  btn.dataset.speed = s;
  btn.addEventListener('click', () => setSpeed(s));
  presetsEl.appendChild(btn);
});

slider.addEventListener('input', () => setSpeed(parseFloat(slider.value)));

// 显示/隐藏页面悬浮条
document.getElementById('toggleBar').addEventListener('click', () => {
  sendToTab({ type: 'toggleBar' });
});

// 初始化: 读取当前页面速度
(async () => {
  const resp = await sendToTab({ type: 'getSpeed' });
  if (resp && resp.speed != null) {
    render(resp.speed);
  } else {
    const { lastSpeed } = await chrome.storage.local.get('lastSpeed');
    render(lastSpeed || 1);
  }
})();
