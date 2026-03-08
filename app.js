/**
 * 主应用逻辑
 * 摄像头初始化、主检测循环、UI 交互
 */

// 全局状态
let cvReady = false;
let cameraReady = false;
let tracker = null;
let isRunning = false;

// 检测参数
let currentParams = {
  ...sensitivityToParams(5),
  minAreaRatio: sizeToMinArea('medium'),
  maxAreaRatio: 0.35,
};
let showDebug = false;
let countLineRatio = 0.7;

// DOM 元素
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const loadingDiv = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const countDisplay = document.getElementById('count-display');
const fpsDisplay = document.getElementById('fps-display');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const resetBtn = document.getElementById('reset-btn');
const sensitivitySlider = document.getElementById('sensitivity');
const sensitivityVal = document.getElementById('sensitivity-val');
const countlineSlider = document.getElementById('countline');
const countlineVal = document.getElementById('countline-val');
const debugToggle = document.getElementById('debug-toggle');
const sizeButtons = document.querySelectorAll('.size-btn');

// FPS 计算
let frameCount = 0;
let lastFpsTime = performance.now();
let currentFps = 0;

// 处理用的 canvas（降采样）
const processCanvas = document.createElement('canvas');
const processCtx = processCanvas.getContext('2d', { willReadFrequently: true });
const PROCESS_WIDTH = 320;
const PROCESS_HEIGHT = 240;
processCanvas.width = PROCESS_WIDTH;
processCanvas.height = PROCESS_HEIGHT;

/**
 * OpenCV.js 加载完成回调
 */
function onOpenCvReady() {
  // OpenCV.js 可能需要一点时间初始化
  if (typeof cv !== 'undefined' && cv.Mat) {
    cvReady = true;
    loadingText.textContent = '正在启动摄像头...';
    tryStart();
  } else {
    // 等待 cv 模块初始化
    const checkCv = () => {
      if (typeof cv !== 'undefined') {
        if (cv.Mat) {
          cvReady = true;
          loadingText.textContent = '正在启动摄像头...';
          tryStart();
        } else if (cv.onRuntimeInitialized !== undefined) {
          cv.onRuntimeInitialized = () => {
            cvReady = true;
            loadingText.textContent = '正在启动摄像头...';
            tryStart();
          };
        }
      } else {
        setTimeout(checkCv, 100);
      }
    };
    checkCv();
  }
}

// 如果 opencv.js 用 Module 模式加载
if (typeof Module !== 'undefined') {
  Module.onRuntimeInitialized = () => {
    cvReady = true;
    loadingText.textContent = '正在启动摄像头...';
    tryStart();
  };
}

/**
 * 启动摄像头
 */
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 60, min: 30 },
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();
    cameraReady = true;

    // 设置 canvas 尺寸匹配视频
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    tryStart();
  } catch (err) {
    loadingText.textContent = '无法访问摄像头: ' + err.message;
    console.error('Camera error:', err);
  }
}

/**
 * 尝试启动主循环
 */
function tryStart() {
  if (cvReady && cameraReady && !isRunning) {
    isRunning = true;
    tracker = new BallTracker({ countLineY: countLineRatio });
    loadingDiv.style.display = 'none';
    requestAnimationFrame(processFrame);
  }
}

/**
 * 主处理循环
 */
function processFrame(timestamp) {
  if (!isRunning) return;

  // 绘制视频到主 canvas
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 降采样绘制到处理 canvas
  processCtx.drawImage(video, 0, 0, PROCESS_WIDTH, PROCESS_HEIGHT);
  const imageData = processCtx.getImageData(0, 0, PROCESS_WIDTH, PROCESS_HEIGHT);

  // 创建 OpenCV Mat
  const src = cv.matFromImageData(imageData);

  // 检测黄色球
  const balls = detectYellowBalls(src, currentParams);

  // 调试掩码显示
  if (showDebug) {
    const mask = getDebugMask(src, currentParams);
    // 将掩码叠加到画面上
    drawDebugMask(mask);
    mask.delete();
  }

  src.delete();

  // 跟踪与计数
  const scaleX = canvas.width / PROCESS_WIDTH;
  const scaleY = canvas.height / PROCESS_HEIGHT;

  // 将检测结果缩放回原始分辨率
  const scaledBalls = balls.map(b => ({
    ...b,
    centerX: b.centerX * scaleX,
    centerY: b.centerY * scaleY,
    x: b.x * scaleX,
    y: b.y * scaleY,
    width: b.width * scaleX,
    height: b.height * scaleY,
  }));

  const result = tracker.update(scaledBalls, canvas.width, canvas.height);

  // 绘制可视化
  drawOverlay(result.tracked, canvas.width, canvas.height);

  // 更新计数
  countDisplay.textContent = '计数: ' + result.count;

  // 更新 FPS
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    currentFps = Math.round(frameCount * 1000 / (now - lastFpsTime));
    fpsDisplay.textContent = currentFps + ' FPS';
    frameCount = 0;
    lastFpsTime = now;
  }

  requestAnimationFrame(processFrame);
}

/**
 * 绘制调试掩码叠加
 */
function drawDebugMask(mask) {
  // 创建一个与画布相同大小的临时 canvas
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = PROCESS_WIDTH;
  tempCanvas.height = PROCESS_HEIGHT;
  const tempCtx = tempCanvas.getContext('2d');

  const imgData = tempCtx.createImageData(PROCESS_WIDTH, PROCESS_HEIGHT);
  const data = imgData.data;

  for (let i = 0; i < mask.rows * mask.cols; i++) {
    const val = mask.data[i];
    if (val > 0) {
      data[i * 4] = 255;     // R
      data[i * 4 + 1] = 204; // G
      data[i * 4 + 2] = 0;   // B
      data[i * 4 + 3] = 100; // A (半透明)
    }
  }

  tempCtx.putImageData(imgData, 0, 0);

  // 绘制到主 canvas（放大）
  ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
}

/**
 * 绘制检测叠加层（检测框、计数线）
 */
function drawOverlay(trackedBalls, width, height) {
  const countLineY = height * countLineRatio;

  // 绘制计数线
  ctx.beginPath();
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)';
  ctx.lineWidth = 2;
  ctx.moveTo(0, countLineY);
  ctx.lineTo(width, countLineY);
  ctx.stroke();
  ctx.setLineDash([]);

  // 计数线标签
  ctx.fillStyle = 'rgba(0, 255, 255, 0.6)';
  ctx.font = '12px sans-serif';
  ctx.fillText('计数线', 8, countLineY - 6);

  // 绘制每个跟踪球体
  for (const ball of trackedBalls) {
    const color = ball.counted ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 0, 0.8)';

    // 边界框
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(ball.x, ball.y, ball.width, ball.height);

    // 中心点
    ctx.beginPath();
    ctx.arc(ball.centerX, ball.centerY, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // ID 标签
    ctx.fillStyle = color;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('#' + ball.id, ball.x, ball.y - 6);
  }
}

// === UI 事件绑定 ===

// 设置按钮
settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('show');
  settingsBtn.classList.toggle('active');
});

// 重置按钮
resetBtn.addEventListener('click', () => {
  if (tracker) {
    tracker.reset();
    countDisplay.textContent = '计数: 0';
  }
});

// 颜色灵敏度滑块
sensitivitySlider.addEventListener('input', () => {
  const val = parseInt(sensitivitySlider.value);
  sensitivityVal.textContent = val;
  const hsvParams = sensitivityToParams(val);
  currentParams = { ...currentParams, ...hsvParams };
});

// 计数线位置滑块
countlineSlider.addEventListener('input', () => {
  const val = parseInt(countlineSlider.value);
  countlineVal.textContent = val + '%';
  countLineRatio = val / 100;
  if (tracker) {
    tracker.setCountLineRatio(countLineRatio);
  }
});

// 调试开关
debugToggle.addEventListener('change', () => {
  showDebug = debugToggle.checked;
});

// 最小球大小按钮
sizeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    sizeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const size = btn.dataset.size;
    currentParams.minAreaRatio = sizeToMinArea(size);
  });
});

// 页面加载完成后启动摄像头
document.addEventListener('DOMContentLoaded', () => {
  startCamera();
});

// 处理页面可见性变化（节省电量）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    isRunning = false;
  } else if (cvReady && cameraReady) {
    isRunning = true;
    requestAnimationFrame(processFrame);
  }
});
