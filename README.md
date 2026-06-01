# 机器人监控与任务管理系统

一个用于监控具身机器人状态和管理任务执行的 Web 应用系统。

## ✨ 功能特性

- 📊 **实时状态监控** - 电池电量、移动速度、CPU使用率、网络延迟
- 📹 **实时视频流** - RealSense相机实时画面显示
- 📋 **任务管理** - 创建、查看、控制、删除任务
- ⏱️ **任务执行流程** - 可视化时间轴展示任务状态
- 🎯 **任务详情** - 查看任务详细信息和子任务状态
- 🤖 **机器人控制** - 点击视频画面执行抓取操作
- 💾 **本地缓存** - LocalStorage缓存任务数据
- 🔄 **状态轮询** - 自动轮询更新任务和系统状态

## 🛠️ 技术栈

- **前端框架**: 原生 JavaScript (ES6+)
- **构建工具**: Webpack 5
- **样式框架**: Tailwind CSS 3
- **图表库**: Chart.js 4
- **状态管理**: 自定义事件总线
- **HTTP客户端**: Fetch API
- **模块化**: ES6 Modules

## 📁 项目结构

```
robot-monitor-system/
├── public/                     # 静态资源目录
│   └── index.html             # HTML模板
├── src/                        # 源代码目录
│   ├── assets/                # 资源文件
│   │   └── styles/           # 样式文件
│   │       └── main.css      # 主样式文件
│   ├── config/                # 配置文件
│   │   └── api.config.js     # API配置
│   ├── services/              # 服务层
│   │   ├── api.service.js    # API服务
│   │   ├── storage.service.js # 存储服务
│   │   ├── video.service.js  # 视频流服务
│   │   └── task.service.js   # 任务服务
│   ├── components/            # UI组件
│   │   └── task-management/  # 任务管理组件
│   │       ├── task-form.js  # 任务表单
│   │       └── task-timeline.js # 任务时间轴
│   ├── core/                  # 核心模块
│   │   └── event-bus.js      # 事件总线
│   ├── utils/                 # 工具函数
│   │   ├── uuid.js           # UUID生成
│   │   ├── serial.js         # 序号管理
│   │   └── formatter.js      # 格式化工具
│   └── main.js                # 应用入口
├── package.json               # 项目配置
├── webpack.config.js          # Webpack配置
├── tailwind.config.js         # Tailwind配置
├── postcss.config.js          # PostCSS配置
├── .gitignore                 # Git忽略文件
└── README.md                  # 项目说明
```

## 🚀 快速开始

### 环境要求

- Node.js >= 14.0.0
- npm >= 6.0.0

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

应用将在 `http://localhost:3000` 启动，并自动打开浏览器。

### 生产构建

```bash
npm run build
```

构建产物将输出到 `dist/` 目录。

### 代码规范

```bash
# 代码检查
npm run lint

# 代码格式化
npm run format
```

## ⚙️ 配置

### API配置

修改 `src/config/api.config.js` 配置后端API地址：

```javascript
export const API_CONFIG = {
  baseUrl: 'http://your-backend-url:5000',
  baseUrl_1: 'http://your-mysql-backend:5000',
  // ...
};
```

### 轮询配置

在 `api.config.js` 中调整轮询间隔：

```javascript
polling: {
  interval: 2000,       // 任务状态轮询间隔（毫秒）
  statusInterval: 5000  // 系统状态更新间隔（毫秒）
}
```

## 📦 部署

### Docker 部署

创建 `Dockerfile`:

```dockerfile
FROM node:18-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

创建 `nginx.conf`:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    location /api {
        proxy_pass http://backend:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

构建和运行：

```bash
docker build -t robot-monitor .
docker run -p 8080:80 robot-monitor
```

### 传统部署

1. 构建项目：`npm run build`
2. 将 `dist/` 目录内容部署到 Web 服务器
3. 配置反向代理转发 `/api` 请求到后端

## 🔌 API 接口

### 状态查询

- `GET /api/status/battery` - 电池状态
- `GET /api/status/velocity` - 移动速度
- `GET /api/status/cpu` - CPU使用率
- `GET /api/status/latency` - 网络延迟

### 任务操作

- `POST /api/task/add` - 创建任务
- `GET /api/task/list` - 获取任务列表
- `GET /api/task/status/:id` - 获取任务状态
- `POST /api/task/update_status` - 直接更新机器人侧任务状态（请求体：`{ id, status }`）
- `POST /api/task/control/:id` - 控制任务（暂停/恢复/终止）
- `DELETE /api/task/delete/:id` - 删除任务

### 机器人控制

- `POST /api/robot/grasp` - 执行抓取操作

### 视频流

- `GET /api/video/realsense` - RealSense 相机 MJPEG 流

## 🎯 使用说明

### 创建任务

1. 在左侧"添加新任务"面板填写任务信息
2. 选择任务类型（find/fetch/deliver/check/custom）
3. 输入任务描述（必填）
4. 选择优先级和执行时间（可选）
5. 点击"提交任务"

### 监控任务

- 任务列表显示在中间时间轴
- 不同颜色表示不同状态：
  - 🔵 蓝色 - 正在执行
  - 🟢 绿色 - 已完成
  - 🟡 黄色 - 已暂停
  - 🔴 红色 - 失败
  - ⚪ 灰色 - 待执行

### 控制任务

1. 点击任务卡片查看详情
2. 在右侧详情面板可以：
   - 暂停/恢复任务
   - 删除任务
   - 查看任务状态和进度

### 机器人抓取

1. 在左侧实时视频画面中
2. 点击目标物体位置
3. 确认抓取操作
4. 系统自动发送归一化坐标到后端

## 🐛 故障排除

### 视频流无法显示

- 检查后端视频服务是否运行
- 检查 API 配置中的地址是否正确
- 查看浏览器控制台是否有跨域错误

### 任务状态不更新

- 检查后端任务服务是否正常
- 查看控制台是否有轮询错误
- 检查网络连接是否正常

### 样式显示异常

- 清除浏览器缓存
- 重新构建项目：`npm run build`
- 检查 Tailwind CSS 配置

## 📝 开发指南

### 添加新组件

1. 在 `src/components/` 创建组件文件
2. 导出组件类
3. 在 `main.js` 中导入和初始化

### 添加新 API

1. 在 `src/config/api.config.js` 添加端点
2. 在 `src/services/api.service.js` 添加方法
3. 在组件中调用服务方法

### 事件通信

使用事件总线进行组件通信：

```javascript
import eventBus from './core/event-bus.js';

// 触发事件
eventBus.emit('task:created', taskData);

// 监听事件
eventBus.on('task:created', (data) => {
  console.log(data);
});
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 📧 联系方式

如有问题请提交 Issue 或联系开发团队。
