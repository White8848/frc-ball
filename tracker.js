/**
 * 球体跟踪与计数模块
 * 使用最近邻匹配跟踪球体，穿越计数线时计数
 */

class BallTracker {
  /**
   * @param {Object} options
   * @param {number} options.countLineRatio - 计数线位置比例 (0-1)，默认 0.7
   * @param {string} options.direction - 球进入方向: 'top-down'|'bottom-up'|'left-right'|'right-left'
   * @param {number} options.maxMissedFrames - 最大丢失帧数后移除，默认 15
   * @param {number} options.minFramesToCount - 最少连续出现帧数才计数，默认 2
   */
  constructor(options = {}) {
    this.countLineRatio = options.countLineRatio || 0.7;
    this.direction = options.direction || 'top-down';
    this.maxDistanceRatio = 0.15;
    this.maxMissedFrames = options.maxMissedFrames || 15;
    this.minFramesToCount = options.minFramesToCount || 2;

    this.trackedBalls = [];
    this.nextId = 1;
    this.frameCount = 0;
    this.totalCount = 0;
  }

  /**
   * 计数线是否为水平线（上下方向用水平线，左右方向用垂直线）
   */
  isHorizontal() {
    return this.direction === 'top-down' || this.direction === 'bottom-up';
  }

  /**
   * 更新跟踪状态
   */
  update(detectedBalls, frameWidth, frameHeight) {
    this.frameCount++;
    const maxDistance = Math.max(frameWidth, frameHeight) * this.maxDistanceRatio;
    const linePos = this.isHorizontal()
      ? frameHeight * this.countLineRatio
      : frameWidth * this.countLineRatio;

    const matched = new Array(detectedBalls.length).fill(false);

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
        const det = detectedBalls[bestIdx];
        tracked.prevCenterX = tracked.centerX;
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

        // 检查是否穿越计数线
        if (!tracked.counted && tracked.seenCount >= this.minFramesToCount) {
          if (this._crossedLine(tracked, linePos)) {
            tracked.counted = true;
            this.totalCount++;
          }
        }
      }
    }

    // 新检测结果
    for (let i = 0; i < detectedBalls.length; i++) {
      if (matched[i]) continue;
      const det = detectedBalls[i];
      this.trackedBalls.push({
        id: this.nextId++,
        centerX: det.centerX,
        centerY: det.centerY,
        prevCenterX: det.centerX,
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

    this.trackedBalls = this.trackedBalls.filter(
      t => (this.frameCount - t.lastSeen) < this.maxMissedFrames
    );

    return {
      tracked: this.trackedBalls,
      count: this.totalCount,
    };
  }

  /**
   * 检查球是否穿越计数线
   */
  _crossedLine(tracked, linePos) {
    switch (this.direction) {
      case 'top-down':
        return tracked.prevCenterY < linePos && tracked.centerY >= linePos;
      case 'bottom-up':
        return tracked.prevCenterY > linePos && tracked.centerY <= linePos;
      case 'left-right':
        return tracked.prevCenterX < linePos && tracked.centerX >= linePos;
      case 'right-left':
        return tracked.prevCenterX > linePos && tracked.centerX <= linePos;
      default:
        return false;
    }
  }

  reset() {
    this.trackedBalls = [];
    this.nextId = 1;
    this.frameCount = 0;
    this.totalCount = 0;
  }

  setCountLineRatio(ratio) {
    this.countLineRatio = Math.max(0.1, Math.min(0.9, ratio));
  }

  setDirection(direction) {
    this.direction = direction;
  }
}
