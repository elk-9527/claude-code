// popup.js - 弹窗逻辑
const slider = document.getElementById('speedSlider');
const speedDisplay = document.getElementById('speedDisplay');
const resetBtn = document.getElementById('resetBtn');
const presetBtns = document.getElementById('presetBtns');
const rangeLabels = document.querySelectorAll('.range-labels span');

let currentSpeed = 1.0;

// 从 storage 加载当前速度
chrome.storage.local.get(['speed'], (res) => {
  currentSpeed = res.speed || 1.0;
  updateUI(currentSpeed);
});

// 设置到当前页面
function setSpeed(speed) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0] || !tabs[0].id) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'setSpeed', speed: speed }, (resp) => {
      if (chrome.runtime.lastError) {
        // content script 未加载，静默失败
        console.log('content script not loaded on this page');
      }
    });
  });
  currentSpeed = speed;
  chrome.storage.local.set({ speed: speed });
  updateUI(speed);
}

function updateUI(speed) {
  speedDisplay.textContent = parseFloat(speed.toFixed(2));
  slider.value = speed;
  updateActiveBtn(speed);
}

function updateActiveBtn(speed) {
  presetBtns.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', parseFloat(b.dataset.speed) === speed);
  });
}

// 滑条事件
slider.addEventListener('input', () => {
  const speed = parseFloat(slider.value);
  speedDisplay.textContent = speed.toFixed(2);
  updateActiveBtn(speed);
});

slider.addEventListener('change', () => {
  setSpeed(parseFloat(slider.value));
});

// 预设按钮
presetBtns.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    setSpeed(parseFloat(btn.dataset.speed));
  });
});

// 范围标签点击
rangeLabels.forEach(label => {
  label.addEventListener('click', () => {
    setSpeed(parseFloat(label.dataset.speed));
  });
});

// 重置按钮
resetBtn.addEventListener('click', () => {
  setSpeed(1.0);
});
