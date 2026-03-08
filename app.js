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
 * 加载 OpenCV.js，依次尝试多个 CDN 源
 */
function loadOpenCv() {
  const OPENCV_SOURCES = [
    {
      js: 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/opencv.js',
      base: 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/'
    },
    {
      js: 'https://docs.opencv.org/4.9.0/opencv.js',
      base: 'https://docs.opencv.org/4.9.0/'
    }
  ];

  let urlIndex = 0;

  function tryNextSource() {
    if (urlIndex >= OPENCV_SOURCES.length) {
      loadingText.textContent = '所有源加载失败，请检查网络后刷新重试';
      return;
    }
    const source = OPENCV_SOURCES[urlIndex];
    urlIndex++;
    console.log('尝试加载 OpenCV.js:', source.js);
    loadingText.textContent = '正在加载 OpenCV.js... (源 ' + urlIndex + '/' + OPENCV_SOURCES.length + ')';
    progressBar.style.width = '0%';
    progressText.textContent = '';

    loadOpenCvFromSource(source, tryNextSource);
  }

  tryNextSource();
}

/**
 * 从指定源加载 OpenCV.js，失败时调用 onFail 回调
 */
function loadOpenCvFromSource(source, onFail) {
  // 配置 Module 以解决 WASM 文件路径问题
  window.Module = window.Module || {};
  window.Module.locateFile = function(filename) {
    if (filename.endsWith('.wasm') || filename.endsWith('.data')) {
      return source.base + filename;
    }
    return filename;
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = source.js;

  // 30 秒超时保护
  const timeout = setTimeout(() => {
    console.warn('加载超时:', source.js);
    script.onload = null;
    script.onerror = null;
    try { document.body.removeChild(script); } catch(e) {}
    delete window.Module.locateFile;
    onFail();
  }, 30000);

  script.onload = () => {
    clearTimeout(timeout);
    progressBar.style.width = '100%';
    loadingText.textContent = '正在初始化 OpenCV...';
    progressText.textContent = '';
    waitForOpenCv(onFail);
  };
  script.onerror = () => {
    clearTimeout(timeout);
    console.warn('加载失败:', source.js);
    try { document.body.removeChild(script); } catch(e) {}
    delete window.Module.locateFile;
    onFail();
  };
  document.body.appendChild(script);
}

/**
 * 等待 OpenCV.js 运行时初始化完成
 * @param {Function} onFail - 初始化超时时的回调（尝试下一个源）
 */
function waitForOpenCv(onFail) {
  const startTime = Date.now();
  const TIMEOUT = 60000; // 60 秒超时

  const check = () => {
    // 超时保护
    if (Date.now() - startTime > TIMEOUT) {
      console.warn('OpenCV.js 初始化超时');
      if (onFail) {
        onFail();
      } else {
        loadingText.textContent = '初始化超时，请刷新重试';
      }
      return;
    }

    if (typeof cv !== 'undefined') {
      // OpenCV.js 4.x 工厂模式：cv 是一个函数，调用后返回 Promise
      if (typeof cv === 'function') {
        cv().then((instance) => {
          window.cv = instance;
          onOpenCvReady();
        }).catch((err) => {
          console.error('OpenCV.js 初始化失败:', err);
          if (onFail) onFail();
          else loadingText.textContent = '初始化失败，请刷新重试';
        });
        return;
      }
      // 旧模式：cv 直接是对象
      if (cv.Mat) {
        onOpenCvReady();
      } else if (cv.onRuntimeInitialized !== undefined) {
        cv.onRuntimeInitialized = onOpenCvReady;
      } else {
        setTimeout(check, 100);
      }
    } else {
      setTimeout(check, 100);
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
