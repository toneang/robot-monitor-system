# 视频流API显示问题分析

## 问题描述

1. **管理员端**: `/api/video/navigation` 显示黑屏
2. **用户端**: `/api/video/gripper` 看不见显示

## 问题分析

### 1. 管理员端 Navigation 黑屏问题

**原因分析**:
- 在 `src/main.js:326-335` 中，Navigation 视频流被初始化并添加到 `this.videoStreams` 数组
- 但管理员端使用的是 `adminVideoPanel` 布局（第438行），而视频流可能没有正确绑定到这个布局中
- 从代码看，管理员端视频流是通过动态的 wrapper 元素进行布局的（第492-510行的网格布局）

**可能的原因**:
- 视频流的DOM元素没有正确显示在 `adminVideoPanel` 中
- CSS样式问题导致视频被隐藏
- 视频流URL或跨域问题

### 2. 用户端 Gripper 不显示问题

**原因分析**:
- 在 `src/main.js:410-422` 中，Gripper 视频流只在 `user.role !== 'admin'` 时初始化
- 这意味着管理员端不会显示 Gripper 视频
- 但用户端应该能看到 Gripper 视频

## 解决方案

### 方案1: 修改视频流初始化逻辑

在 `src/main.js` 的 `initVideoStream()` 函数中：

1. **确保管理员端也显示 Navigation 视频**：
   - 检查 `adminVideoPanel` 中的视频元素是否正确初始化
   - 确保视频流的DOM元素被正确添加到布局中

2. **为管理员端添加 Gripper 视频**：
   - 在管理员端初始化时也添加 Gripper 视频流
   - 修改条件判断，让管理员端也能看到所有视频

### 方案2: 检查CSS样式

检查 `public/index.html` 中的CSS样式：
- 确保视频容器有正确的尺寸和显示属性
- 检查 `hidden` 类是否被正确应用

### 方案3: 检查后端API

确认后端API是否正常工作：
- `/api/video/navigation` 是否返回正确的视频流
- `/api/video/gripper` 是否返回正确的视频流
- 检查跨域设置

## 建议的修复步骤

1. 首先检查浏览器开发者工具中的网络请求，确认视频流是否正常加载
2. 检查视频元素的DOM结构和样式
3. 修改前端代码，确保视频流正确初始化和显示
4. 如果问题持续，检查后端API服务

## 相关代码位置

- 视频流服务: `src/services/video.service.js`
- 视频初始化逻辑: `src/main.js:290-446`
- 视频配置: `src/config/api.config.js:25-27`
- HTML结构: `public/index.html:442-512` (管理员视频面板)
- HTML结构: `public/index.html:242-257` (用户视频面板)