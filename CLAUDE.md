# FRC 黄色球检测计数 Web App

## 项目简介

使用手机摄像头实时检测画面中飞过的黄色球（排球大小）并自动计数的移动端 Web App。
主要用于 FRC（FIRST Robotics Competition）场景，球主要从上往下飞过画面。

## 技术栈

- 纯前端：HTML / CSS / JavaScript（无需后端）
- OpenCV.js（WASM，通过 CDN 加载）用于高性能图像处理
- GitHub Pages 部署（自带 HTTPS）

## 文件结构

- `index.html` - 主页面（HTML + 内联 CSS）
- `app.js` - 主应用逻辑（摄像头、UI、主循环）
- `detector.js` - 黄色球检测算法（HSV 过滤 + 连通域分析）
- `tracker.js` - 球体跟踪与穿越计数线计数
- `.github/workflows/deploy.yml` - GitHub Actions 部署到 GitHub Pages

## 核心算法

1. 摄像头 60fps 采集 → 降采样到 320x240
2. RGB → HSV 颜色空间转换
3. inRange 黄色掩码 → erode/dilate 形态学处理
4. connectedComponentsWithStats 连通域分析
5. 面积/宽高比筛选球体
6. 最近邻跟踪 + 穿越计数线计数

## 本地开发

```bash
python3 -m http.server 8080
```

注意：摄像头 API (getUserMedia) 需要安全上下文（HTTPS 或 localhost）。

## 部署

推送到 `main` 分支后，GitHub Actions 自动部署到 GitHub Pages。
访问地址：`https://<username>.github.io/frc-ball/`
