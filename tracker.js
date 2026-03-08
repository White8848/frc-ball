/**
 * 球体跟踪与计数模块
 * 使用最近邻匹配跟踪球体，穿越计数线时计数
 */

class BallTracker {
  /**
   * @param {Object} options
   * @param {number} options.countLineY - 计数线 Y 坐标比例 (0-1)，默认 0.7
   * @param {number} options.maxDistance - 最大匹配距离（像素），默认自动计算
   * @param {number} options.maxMissedFrames - 最大丢失帧数后移除，默认 15
   * @param {number} options.minFramesToCount - 最少连续出现帧数才计数，默认 2
   */
  constructor(options = {}) {
    this.countLineRatio = options.countLineY || 0.7;
    this.maxDistanceRatio = 0.15; // 画面宽度的 15%
    this.maxMissedFrames = options.maxMissedFrames || 15;
    this.minFramesToCount = options.minFramesToCount || 2;

    this.trackedBalls = []; // 活跃跟踪列表
    this.nextId = 1;
    this.frameCount = 0;
    this.totalCount = 0;
  }

  /**
   * 更新跟踪状态
   * @param {Array<{centerX: number, centerY: number, area: number, x: number, y: number, width: number, height: number}>} detectedBalls
   * @param {number} frameWidth - 当前帧宽度（用于计算距离阈值）
   * @param {number} frameHeight - 当前帧高度（用于计算计数线位置）
   * @returns {{tracked: Array, count: number}}
   */
  update(detectedBalls, frameWidth, frameHeight) {
    this.frameCount++;
    const maxDistance = frameWidth * this.maxDistanceRatio;
    const countLineY = frameHeight * this.countLineRatio;

    // 标记哪些检测结果已匹配
    const matched = new Array(detectedBalls.length).fill(false);

    // 对每个已跟踪球体尝试匹配
    for (const tracked of this.trackedBalls) {
      let bestIdx = -1;
      let bestDist = maxDistance;

      for (let i = 0; i < detectedBalls.length; i++) {
        if (matched[i]) continue;
        const det = detectedBalls[i];
        const dx = tracked.centerX - det.centerX;
        const dy = tracked.centerY - det.centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        // 匹配成功，更新位置
        const det = detectedBalls[bestIdx];
        tracked.prevCenterY = tracked.centerY;
        tracked.centerX = det.centerX;
        tracked.centerY = det.centerY;
        tracked.x = det.x;
        tracked.y = det.y;
        tracked.width = det.width;
        tracked.height = det.height;
        tracked.area = det.area;
        tracked.lastSeen = this.frameCount;
        tracked.seenCount++;
        matched[bestIdx] = true;

        // 检查是否穿越计数线（从上到下）
        if (!tracked.counted &&
            tracked.seenCount >= this.minFramesToCount &&
            tracked.prevCenterY < countLineY &&
            tracked.centerY >= countLineY) {
          tracked.counted = true;
          this.totalCount++;
        }
      }
    }

    // 为未匹配的检测结果创建新跟踪
    for (let i = 0; i < detectedBalls.length; i++) {
      if (matched[i]) continue;
      const det = detectedBalls[i];
      this.trackedBalls.push({
        id: this.nextId++,
        centerX: det.centerX,
        centerY: det.centerY,
        prevCenterY: det.centerY,
        x: det.x,
        y: det.y,
        width: det.width,
        height: det.height,
        area: det.area,
        lastSeen: this.frameCount,
        seenCount: 1,
        counted: false,
      });
    }

    // 清除过期的跟踪
    this.trackedBalls = this.trackedBalls.filter(
      t => (this.frameCount - t.lastSeen) < this.maxMissedFrames
    );

    return {
      tracked: this.trackedBalls,
      count: this.totalCount,
    };
  }

  /**
   * 重置所有状态
   */
  reset() {
    this.trackedBalls = [];
    this.nextId = 1;
    this.frameCount = 0;
    this.totalCount = 0;
  }

  /**
   * 设置计数线位置
   * @param {number} ratio - 0-1 之间的比例
   */
  setCountLineRatio(ratio) {
    this.countLineRatio = Math.max(0.1, Math.min(0.9, ratio));
  }
}
