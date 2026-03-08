/**
 * 黄色球检测模块
 * 使用 OpenCV.js 进行 HSV 颜色过滤和连通域分析
 */

// 默认检测参数
const DEFAULT_PARAMS = {
  // HSV 范围 (OpenCV: H 0-179, S 0-255, V 0-255)
  hLow: 15,
  hHigh: 35,
  sLow: 80,
  sHigh: 255,
  vLow: 80,
  vHigh: 255,
  // 面积过滤 (占画面比例)
  minAreaRatio: 0.005,
  maxAreaRatio: 0.35,
  // 宽高比范围
  minAspect: 0.4,
  maxAspect: 2.5,
};

/**
 * 根据灵敏度（1-10）计算 HSV 范围
 * 灵敏度越高，HSV 范围越宽（检测越宽松）
 */
function sensitivityToParams(sensitivity) {
  const s = Math.max(1, Math.min(10, sensitivity));
  // 基准黄色中心: H=25, S=170, V=170
  const hMargin = 8 + (s - 1) * 2;   // H范围: ±8 到 ±26
  const sFloor = 120 - (s - 1) * 12;  // S下限: 120 到 12
  const vFloor = 120 - (s - 1) * 12;  // V下限: 120 到 12

  return {
    hLow: Math.max(0, 25 - hMargin),
    hHigh: Math.min(179, 25 + hMargin),
    sLow: Math.max(0, sFloor),
    sHigh: 255,
    vLow: Math.max(0, vFloor),
    vHigh: 255,
  };
}

/**
 * 根据最小球大小档位返回面积比例
 * @param {'small'|'medium'|'large'} size
 */
function sizeToMinArea(size) {
  switch (size) {
    case 'small': return 0.002;
    case 'medium': return 0.008;
    case 'large': return 0.02;
    default: return 0.005;
  }
}

/**
 * 检测画面中的黄色球体
 * @param {cv.Mat} src - 输入图像 (RGBA)
 * @param {Object} params - 检测参数
 * @returns {Array<{x: number, y: number, width: number, height: number, centerX: number, centerY: number, area: number}>}
 */
function detectYellowBalls(src, params = DEFAULT_PARAMS) {
  const totalPixels = src.rows * src.cols;
  const minArea = totalPixels * (params.minAreaRatio || DEFAULT_PARAMS.minAreaRatio);
  const maxArea = totalPixels * (params.maxAreaRatio || DEFAULT_PARAMS.maxAreaRatio);
  const minAspect = params.minAspect || DEFAULT_PARAMS.minAspect;
  const maxAspect = params.maxAspect || DEFAULT_PARAMS.maxAspect;

  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  const mask = new cv.Mat();
  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();

  const balls = [];

  try {
    // RGBA → RGB → HSV
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

    // 黄色掩码
    const low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [
      params.hLow ?? DEFAULT_PARAMS.hLow,
      params.sLow ?? DEFAULT_PARAMS.sLow,
      params.vLow ?? DEFAULT_PARAMS.vLow,
      0,
    ]);
    const high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [
      params.hHigh ?? DEFAULT_PARAMS.hHigh,
      params.sHigh ?? DEFAULT_PARAMS.sHigh,
      params.vHigh ?? DEFAULT_PARAMS.vHigh,
      255,
    ]);
    cv.inRange(hsv, low, high, mask);
    low.delete();
    high.delete();

    // 形态学处理
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
    cv.erode(mask, mask, kernel, new cv.Point(-1, -1), 1);
    cv.dilate(mask, mask, kernel, new cv.Point(-1, -1), 2);
    kernel.delete();

    // 连通域分析
    const numLabels = cv.connectedComponentsWithStats(mask, labels, stats, centroids);

    // 遍历连通域（跳过背景 label 0）
    for (let i = 1; i < numLabels; i++) {
      const area = stats.intAt(i, cv.CC_STAT_AREA);
      if (area < minArea || area > maxArea) continue;

      const x = stats.intAt(i, cv.CC_STAT_LEFT);
      const y = stats.intAt(i, cv.CC_STAT_TOP);
      const w = stats.intAt(i, cv.CC_STAT_WIDTH);
      const h = stats.intAt(i, cv.CC_STAT_HEIGHT);

      // 宽高比检查
      const aspect = w / h;
      if (aspect < minAspect || aspect > maxAspect) continue;

      const cx = centroids.doubleAt(i, 0);
      const cy = centroids.doubleAt(i, 1);

      balls.push({
        x, y, width: w, height: h,
        centerX: cx, centerY: cy,
        area,
      });
    }
  } finally {
    rgb.delete();
    hsv.delete();
    mask.delete();
    labels.delete();
    stats.delete();
    centroids.delete();
  }

  return balls;
}

/**
 * 获取调试用的掩码图像
 * @param {cv.Mat} src - 输入图像 (RGBA)
 * @param {Object} params - 检测参数
 * @returns {cv.Mat} 掩码 Mat（调用者需要 delete）
 */
function getDebugMask(src, params = DEFAULT_PARAMS) {
  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  const mask = new cv.Mat();

  try {
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

    const low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [
      params.hLow ?? DEFAULT_PARAMS.hLow,
      params.sLow ?? DEFAULT_PARAMS.sLow,
      params.vLow ?? DEFAULT_PARAMS.vLow,
      0,
    ]);
    const high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [
      params.hHigh ?? DEFAULT_PARAMS.hHigh,
      params.sHigh ?? DEFAULT_PARAMS.sHigh,
      params.vHigh ?? DEFAULT_PARAMS.vHigh,
      255,
    ]);
    cv.inRange(hsv, low, high, mask);
    low.delete();
    high.delete();

    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
    cv.erode(mask, mask, kernel, new cv.Point(-1, -1), 1);
    cv.dilate(mask, mask, kernel, new cv.Point(-1, -1), 2);
    kernel.delete();
  } finally {
    rgb.delete();
    hsv.delete();
  }

  // 返回 mask，调用者负责 delete
  return mask;
}
