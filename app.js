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
const landscapeToggle = document.getElementById('landscape-toggle');
const wideAngleToggle = document.getElementById('wide-angle-toggle');
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
 * 加载本地自托管的 OpenCV.js（WASM 内嵌，无需额外网络请求）
 *
 * 此版本 opencv.js 使用 UMD 包装，内部会立即调用 cv(Module) 启动 WASM 初始化。
 * 因此必须在脚本加载前配置 Module.onRuntimeInitialized 回调。
 */
function loadOpenCv() {
  // 在脚本加载前设置 Module，确保 onRuntimeInitialized 能被捕获
  window.Module = {
    onRuntimeInitialized: function() {
      console.log('OpenCV.js WASM 初始化完成');
      onOpenCvReady();
    }
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = 'lib/opencv.js';

  script.onload = () => {
    progressBar.style.width = '100%';
    loadingText.textContent = '正在初始化 OpenCV...';
    progressText.textContent = '';
    // 如果 onRuntimeInitialized 已经在脚本执行期间同步触发，
    // cvReady 已经为 true，无需额外处理。
    // 否则等待异步回调。
    // 额外兜底：轮询检查 cv.Mat 是否可用
    waitForCvReady();
  };
  script.onerror = () => {
    loadingText.textContent = '加载 OpenCV.js 失败，请确认 lib/opencv.js 存在';
  };
  document.body.appendChild(script);
}

/**
 * 兜底轮询：如果 onRuntimeInitialized 未触发，通过检查 cv.Mat 判断就绪
 */
function waitForCvReady() {
  if (cvReady) return; // 已通过 onRuntimeInitialized 就绪

  const startTime = Date.now();
  const TIMEOUT = 30000;

  const check = () => {
    if (cvReady) return;
    if (Date.now() - startTime > TIMEOUT) {
      loadingText.textContent = 'OpenCV 初始化超时，请刷新重试';
      return;
    }
    if (typeof cv !== 'undefined' && cv.Mat) {
      onOpenCvReady();
    } else {
      setTimeout(check, 200);
    }
  };
  setTimeout(check, 200);
}

/**
 * OpenCV.js 初始化完成
 */
function onOpenCvReady() {
  if (cvReady) return; // 防止重复调用
  cvReady = true;
  loadingText.textContent = '正在启动摄像头...';
  progressBar.style.width = '100%';
  tryStart();
}

/**
 * 启动摄像头
 * @param {boolean} wideAngle - 是否请求广角镜头
 */
async function startCamera(wideAngle) {
  // 停止已有的摄像头流
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    cameraReady = false;
  }

  const constraints = {
    video: {
      facingMode: 'environment',
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 60, min: 30 },
    },
    audio: false,
  };

  if (wideAngle) {
    // 尝试请求超广角镜头：优先 0.5x zoom，否则请求最宽 FOV
    constraints.video.zoom = { ideal: 0.5 };
    constraints.video.width = { ideal: 1280 };
    constraints.video.height = { ideal: 720 };
  }

  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      if (wideAngle) {
        // zoom 约束可能不被支持，回退去掉 zoom
        console.warn('广角约束不支持，尝试回退:', e.message);
        delete constraints.video.zoom;
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } else {
        throw e;
      }
    }

    video.srcObject = stream;
    await video.play();
    cameraReady = true;

    // 尝试通过 track 设置 zoom（某些设备支持）
    if (wideAngle) {
      try {
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities();
        if (caps.zoom && caps.zoom.min < 1) {
          await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
        }
      } catch (e) {
        console.warn('无法设置 zoom:', e.message);
      }
    }

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

// 横屏模式
landscapeToggle.addEventListener('change', () => {
  if (landscapeToggle.checked) {
    // 尝试锁定横屏
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(e => {
        console.warn('无法锁定横屏:', e.message);
      });
    }
  } else {
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
  }
});

// 广角镜头模式
wideAngleToggle.addEventListener('change', () => {
  startCamera(wideAngleToggle.checked);
});

// 页面加载完成后启动
document.addEventListener('DOMContentLoaded', () => {
  loadOpenCv();
  startCamera(false);
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
