# Phase 3: workpaw-control-plane/console MVP

**Work in:** `/Users/zhangsan/workpaw/workpaw-control-plane/console`

## Goal
实现管理后台 MVP：登录 → 实例列表 → 实例详情。

## Context
- 项目已脚手架完成：React + Vite + TypeScript + Tailwind + Shadcn UI + zustand
- workpaw-ui 共享包已就绪
- Control Plane API 在 localhost:8090（开发时）
- 管理 API 在 /api/admin/* 路由，需要 admin role
- 中文 UI

## 需要创建的文件

### 1. `src/lib/api.ts` — API 客户端
```typescript
import { ApiClient } from "workpaw-ui";

const controlPlaneUrl = import.meta.env.VITE_CONTROL_PLANE_URL || "http://localhost:8090";

export function createAdminApi(getToken: () => string | null) {
  return new ApiClient({
    baseUrl: controlPlaneUrl,
    getToken,
    onUnauthorized: () => {
      localStorage.removeItem("workpaw_admin_token");
      window.location.href = "/login";
    },
  });
}
```

### 2. `src/stores/useAuthStore.ts` — 管理员认证
与 workpaw-web 类似，但验证 admin role

### 3. `src/pages/Login.tsx` — 管理员登录页

### 4. `src/pages/Dashboard.tsx` — 总览页
- 活跃实例数
- 总用户数
- 最近活动

### 5. `src/pages/Instances.tsx` — 实例管理（MVP 核心）
表格展示所有用户实例：
| 用户 | 状态 | Ingress | 创建时间 | 最后活跃 | 操作 |
|------|------|---------|----------|----------|------|
| user-a | Running | user-a.qwenpaw... | 2026-06-17 | 10:30 | 停止/删除 |

API: `GET /api/admin/instances`（目前 Control Plane 还未实现此 API，先用 mock 数据）

### 6. `src/layouts/MainLayout.tsx` — 管理后台布局
```
┌────────────┐ ┌──────────────────────────┐
│  侧边导航   │ │       内容区              │
│            │ │                          │
│ 📊 总览    │ │   当前页面内容            │
│ 👥 实例    │ │                          │
│ 📋 审计    │ │                          │
│ 📐 策略    │ │                          │
└────────────┘ └──────────────────────────┘
```

### 7. `src/App.tsx` — 路由
```
/login → LoginPage
/ → MainLayout
  / → Dashboard (default)
  /instances → InstancesPage
  /audit → placeholder
  /policy → placeholder
```

### 8. `Dockerfile` + `nginx.conf`（与 workpaw-web 相同模式）

## Acceptance
- `npm run build` 成功
- 登录页正常展示
- Dashboard 页面有基础统计卡片
- Instances 页面展示表格（可用 mock 数据）
- Dockerfile 可用
