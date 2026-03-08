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
let currentDirection = 'top-down';

// DOM 元素
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const loadingDiv = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
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
const dirButtons = document.querySelectorAll('.dir-btn');

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
 * 加载 OpenCV.js，使用 fetch + ReadableStream 显示下载进度
 * 如果浏览器不支持 ReadableStream，回退到普通 script 标签加载
 */
function loadOpenCv() {
  const OPENCV_URL = 'https://docs.opencv.org/4.9.0/opencv.js';

  // 检查是否支持 ReadableStream（用于显示进度）
  if (typeof ReadableStream === 'undefined' || typeof Response === 'undefined') {
    loadOpenCvFallback(OPENCV_URL);
    return;
  }

  fetch(OPENCV_URL)
    .then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      // 无法获取大小或不支持 body stream，回退
      if (!total || !response.body) {
        loadingText.textContent = '正在加载 OpenCV.js...';
        return response.text();
      }

      let loaded = 0;
      const reader = response.body.getReader();
      const chunks = [];

      function pump() {
        return reader.read().then(({ done, value }) => {
          if (done) return;
          chunks.push(value);
          loaded += value.length;
          const pct = Math.round((loaded / total) * 100);
          const loadedMB = (loaded / 1024 / 1024).toFixed(1);
          const totalMB = (total / 1024 / 1024).toFixed(1);
          progressBar.style.width = pct + '%';
          progressText.textContent = loadedMB + ' / ' + totalMB + ' MB';
          loadingText.textContent = '正在加载 OpenCV.js... ' + pct + '%';
          return pump();
        });
      }

      return pump().then(() => {
        const blob = new Blob(chunks);
        return blob.text();
      });
    })
    .then(scriptText => {
      if (!scriptText) return;
      progressBar.style.width = '100%';
      loadingText.textContent = '正在初始化 OpenCV...';
      progressText.textContent = '';

      const script = document.createElement('script');
      script.textContent = scriptText;
      document.body.appendChild(script);
      waitForOpenCv();
    })
    .catch(err => {
      console.error('Fetch OpenCV failed:', err);
      // fetch 失败时回退到 script 标签
      loadOpenCvFallback(OPENCV_URL);
    });
}

/**
 * 回退方案：用 script 标签加载（无进度显示）
 */
function loadOpenCvFallback(url) {
  loadingText.textContent = '正在加载 OpenCV.js...';
  progressText.textContent = '';
  const script = document.createElement('script');
  script.async = true;
  script.src = url;
  script.onload = () => {
    progressBar.style.width = '100%';
    loadingText.textContent = '正在初始化 OpenCV...';
    waitForOpenCv();
  };
  script.onerror = () => {
    loadingText.textContent = '加载失败，请刷新重试';
  };
  document.body.appendChild(script);
}

/**
 * 等待 OpenCV.js 运行时初始化完成
 */
function waitForOpenCv() {
  const check = () => {
    if (typeof cv !== 'undefined') {
      // OpenCV.js 4.x 工厂模式：cv 是一个函数，调用后返回 Promise
      if (typeof cv === 'function') {
        cv().then((instance) => {
          window.cv = instance;
          onOpenCvReady();
        });
        return;
      }
      // 旧模式：cv 直接是对象
      if (cv.Mat) {
        onOpenCvReady();
      } else if (cv.onRuntimeInitialized !== undefined) {
        cv.onRuntimeInitialized = onOpenCvReady;
      } else {
        setTimeout(check, 50);
      }
    } else {
      setTimeout(check, 50);
    }
  };
  check();
}

/**
 * OpenCV.js 初始化完成
 */
function onOpenCvReady() {
  cvReady = true;
  loadingText.textContent = '正在启动摄像头...';
  progressBar.style.width = '100%';
  tryStart();
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
    tracker = new BallTracker({
      countLineRatio: countLineRatio,
      direction: currentDirection,
    });
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

  const src = cv.matFromImageData(imageData);
  const balls = detectYellowBalls(src, currentParams);

  if (showDebug) {
    const mask = getDebugMask(src, currentParams);
    drawDebugMask(mask);
    mask.delete();
  }

  src.delete();

  // 缩放回原始分辨率
  const scaleX = canvas.width / PROCESS_WIDTH;
  const scaleY = canvas.height / PROCESS_HEIGHT;

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
  drawOverlay(result.tracked, canvas.width, canvas.height);
  countDisplay.textContent = '计数: ' + result.count;

  // FPS
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
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = PROCESS_WIDTH;
  tempCanvas.height = PROCESS_HEIGHT;
  const tempCtx = tempCanvas.getContext('2d');

  const imgData = tempCtx.createImageData(PROCESS_WIDTH, PROCESS_HEIGHT);
  const data = imgData.data;

  for (let i = 0; i < mask.rows * mask.cols; i++) {
    if (mask.data[i] > 0) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 204;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 100;
    }
  }

  tempCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
}

/**
 * 绘制检测叠加层（检测框、计数线）
 */
function drawOverlay(trackedBalls, width, height) {
  const isHoriz = (currentDirection === 'top-down' || currentDirection === 'bottom-up');
  const linePos = isHoriz
    ? height * countLineRatio
    : width * countLineRatio;

  // 绘制计数线
  ctx.beginPath();
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)';
  ctx.lineWidth = 2;

  if (isHoriz) {
    ctx.moveTo(0, linePos);
    ctx.lineTo(width, linePos);
  } else {
    ctx.moveTo(linePos, 0);
    ctx.lineTo(linePos, height);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // 计数线标签
  ctx.fillStyle = 'rgba(0, 255, 255, 0.6)';
  ctx.font = '12px sans-serif';
  if (isHoriz) {
    ctx.fillText('计数线', 8, linePos - 6);
  } else {
    ctx.save();
    ctx.translate(linePos + 14, 20);
    ctx.fillText('计数线', 0, 0);
    ctx.restore();
  }

  // 绘制方向箭头指示
  ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
  ctx.font = '24px sans-serif';
  const arrowMap = { 'top-down': '↓', 'bottom-up': '↑', 'left-right': '→', 'right-left': '←' };
  if (isHoriz) {
    ctx.fillText(arrowMap[currentDirection], width / 2 - 8, linePos - 12);
  } else {
    ctx.fillText(arrowMap[currentDirection], linePos + 8, height / 2);
  }

  // 绘制每个跟踪球体
  for (const ball of trackedBalls) {
    const color = ball.counted ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 0, 0.8)';

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(ball.x, ball.y, ball.width, ball.height);

    ctx.beginPath();
    ctx.arc(ball.centerX, ball.centerY, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.fillStyle = color;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('#' + ball.id, ball.x, ball.y - 6);
  }
}

// === UI 事件绑定 ===

settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('show');
  settingsBtn.classList.toggle('active');
});

resetBtn.addEventListener('click', () => {
  if (tracker) {
    tracker.reset();
    countDisplay.textContent = '计数: 0';
  }
});

sensitivitySlider.addEventListener('input', () => {
  const val = parseInt(sensitivitySlider.value);
  sensitivityVal.textContent = val;
  const hsvParams = sensitivityToParams(val);
  currentParams = { ...currentParams, ...hsvParams };
});

countlineSlider.addEventListener('input', () => {
  const val = parseInt(countlineSlider.value);
  countlineVal.textContent = val + '%';
  countLineRatio = val / 100;
  if (tracker) {
    tracker.setCountLineRatio(countLineRatio);
  }
});

debugToggle.addEventListener('change', () => {
  showDebug = debugToggle.checked;
});

sizeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    sizeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentParams.minAreaRatio = sizeToMinArea(btn.dataset.size);
  });
});

// 方向按钮
dirButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    dirButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDirection = btn.dataset.dir;
    if (tracker) {
      tracker.setDirection(currentDirection);
    }
  });
});

// 页面加载完成后启动
document.addEventListener('DOMContentLoaded', () => {
  loadOpenCv();
  startCamera();
});

// 页面可见性变化
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    isRunning = false;
  } else if (cvReady && cameraReady) {
    isRunning = true;
    requestAnimationFrame(processFrame);
  }
});
