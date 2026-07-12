# Phase 2: workpaw-web MVP

**Work in:** `/Users/zhangsan/workpaw/workpaw-web`

## Goal
实现 Web 配置应用 MVP：登录 → 获取 Pod 连接 → 基础 Agent 管理页面。

## Context
- 项目已脚手架完成：React + Vite + TypeScript + Tailwind + Shadcn UI + zustand
- workpaw-ui 共享包已就绪（/Users/zhangsan/workpaw/workpaw-ui），含 API 类型和客户端
- QwenPaw console 源码在 ~/github/QwenPaw/console/src/ 可参考
- Control Plane API 在 localhost:8090（开发时）
- 中文 UI

## 需要创建的文件

### 1. `src/lib/api.ts` — API 客户端初始化
```typescript
import { ApiClient, ControlPlaneApi } from "workpaw-ui";

const controlPlaneUrl = import.meta.env.VITE_CONTROL_PLANE_URL || "http://localhost:8090";

export function createControlPlaneApi(getToken: () => string | null) {
  const client = new ApiClient({
    baseUrl: controlPlaneUrl,
    getToken,
    onUnauthorized: () => {
      localStorage.removeItem("workpaw_token");
      window.location.href = "/login";
    },
  });
  return new ControlPlaneApi(client);
}

export function createPodApiClient(podUrl: string, podToken: string) {
  return new ApiClient({
    baseUrl: podUrl,
    getToken: () => podToken,
  });
}
```

Note: 如果 workpaw-ui 还没有作为 npm 包 link 好，可以先本地复制类型定义。

### 2. `src/stores/useAuthStore.ts` — 认证状态
与 workpaw-desktop 类似，但使用 Web OAuth 流程：
- 点击登录 → 跳转 Control Plane `/api/auth/login` → 重定向到 OIDC
- OIDC 回调后 Control Plane 重定向回 Web 应用带 token
- 开发模式：支持手动输入 token

### 3. `src/stores/useInstanceStore.ts` — 实例连接状态
- 获取 Pod Ingress URL + API Token
- 存储连接信息

### 4. `src/pages/Login.tsx` — 登录页
简洁的登录页面，点击按钮跳转到 OIDC 登录

### 5. `src/pages/Agents.tsx` — Agent 管理页（MVP 核心）
参考 ~/github/QwenPaw/console/src/pages/Agent/ 实现：
- Agent 列表（卡片式展示）
- 创建/编辑 Agent 的基础表单
- 直连 QwenPaw Pod 的 `/api/agents` 接口

### 6. `src/layouts/MainLayout.tsx` — 主布局
左侧导航栏 + 右侧内容区：
```
┌────────────┐ ┌──────────────────────────┐
│  侧边导航   │ │       内容区              │
│            │ │                          │
│ 🤖 Agents  │ │   当前页面内容            │
│ 🧩 Skills  │ │                          │
│ 🔌 Models  │ │                          │
│ 📡 Channels│ │                          │
│ ⚙️ 设置    │ │                          │
└────────────┘ └──────────────────────────┘
```

### 7. `src/App.tsx` — 路由
```
/login → LoginPage
/ → MainLayout
  /agents → AgentsPage (default)
  /skills → placeholder
  /models → placeholder
  /channels → placeholder
  /settings → placeholder
```

### 8. `Dockerfile` — Nginx 部署
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### 9. `nginx.conf`
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Acceptance
- `npm run build` 成功
- 登录后能获取 Pod 连接信息
- Agents 页面能展示 Agent 列表（从 QwenPaw Pod 获取）
- Dockerfile 可用
