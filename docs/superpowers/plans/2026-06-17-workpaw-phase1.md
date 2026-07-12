# WorkPaw 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建企业级多用户 QwenPaw 私有化平台，包含 Tauri 桌面客户端、Web 配置应用、管理后台、Control Plane 和 K8s Operator。

**Architecture:** 三层架构——前端（Tauri/Web/Admin）通过 K8s Ingress 直连用户的 QwenPaw Pod；Control Plane (Go/Gin) 处理 SSO 和实例管理；K8s Operator 编排容器生命周期。详见 [设计文档](../specs/2026-06-17-workpaw-design.md)。

**Tech Stack:** Go (Gin/Zap/Viper/Cobra), React, Vite, Tauri 2, Shadcn UI, zustand, TypeScript, PostgreSQL, K8s Operator SDK

## Global Constraints

- QwenPaw 版本锁定 v1.1.12，源码参考路径：`~/github/QwenPaw`
- 所有 Go 代码统一使用 Gin, Zap, Viper, Cobra
- 数据库统一使用 PostgreSQL
- 前端统一使用 React + Vite + TypeScript + Shadcn UI + zustand
- 第一版只支持中文
- Multi-repo 结构，每个仓库 CLAUDE.md 中添加其他仓库路径
- workpaw-ui 共享包存放通用组件、hooks、API 类型定义
- 前端通过 K8s Ingress 域名访问 QwenPaw Pod，不直连 Pod IP
- 每个 QwenPaw Pod 启动时自动生成 Access Token（存储在 K8s Secret）

## 仓库清单

| 仓库 | 本地路径 | 说明 |
|------|----------|------|
| workpaw-ui | `~/github/workpaw-ui` | 共享 UI 包 |
| workpaw-desktop | `~/github/workpaw-desktop` | Tauri 2 桌面客户端 |
| workpaw-web | `~/github/workpaw-web` | Web 配置应用 |
| workpaw-control-plane/console | `~/github/workpaw-control-plane/console` | 管理后台 |
| workpaw-control-plane | `~/github/workpaw-control-plane` | Control Plane API |
| workpaw-operator | `~/github/workpaw-operator` | K8s Operator |

---

## Phase 总览

```
Phase 1: 纵向 MVP（核心链路）────────── 本文档详述
Phase 2: Web 配置应用
Phase 3: 管理后台
Phase 4: 高级 Operator 策略
Phase 5: 打磨与生产就绪
```

### Phase 1: 纵向 MVP

**目标：** 一个用户能登录 Tauri 客户端、启动 QwenPaw 容器、和 Agent 对话。

**并行工作流（4 个 subagent 同时推进）：**

```
         Week 1                    Week 2                    Week 3
         ─────────────────────────────────────────────────────────────
Agent A: [workpaw-ui] ──────────────────────────────────────────────→
         骨架+类型+组件            供 Agent D 使用

Agent B: [workpaw-operator] ───────────────────────────────────────→
         骨架+CRD+Reconcile       本地 K8s 验证

Agent C: [workpaw-control-plane] ──────────────────────────────────→
         骨架+OIDC+JWT            实例 API + 对接 Operator

Agent D:                      [workpaw-desktop] ──────────────────→
         (等 workpaw-ui 基础)    登录+容器状态+Chat+Sessions
```

**验收标准：**
- 用户打开 Tauri 客户端，系统浏览器完成 OIDC 认证
- 显示容器状态，能新建/激活容器
- 容器就绪后进入 Chat，能和 Agent 对话（流式输出）
- 能停止容器、再次激活

### Phase 2: Web 配置应用

**目标：** 用户通过浏览器配置自己的 QwenPaw 实例。

**并行工作流（2 个 subagent）：**

```
Agent A: [workpaw-web] 页面开发（Agents/Skills/Models/Channels/Security/Settings）
Agent B: [workpaw-ui]  补充共享组件（表单、表格、卡片等配置页需要的组件）
```

### Phase 3: 管理后台

**目标：** 管理员管理所有用户实例、审计日志、全局策略。

**并行工作流（2 个 subagent）：**

```
Agent A: [workpaw-control-plane/console] 页面开发（Dashboard/Instances/AuditLogs/Policy/OIDC）
Agent B: [workpaw-control-plane] 管理 API（/api/admin/*）+ 审计日志持久化
```

### Phase 4: 高级 Operator 策略

**目标：** 完善容器生命周期管理。

```
- 空闲超时自动停止
- 定时停止/启动策略
- 资源配额管理
- 健康检查与自动恢复
```

### Phase 5: 打磨与生产就绪

**目标：** 生产环境部署准备。

```
- CI/CD pipeline（每个仓库）
- Helm chart（整体部署）
- 错误处理与边界情况
- 性能优化
- 安全审计
```

---

# Phase 1 详细计划

## 并行调度方案

Phase 1 分为 4 个工作流，每个工作流由一个 subagent 独立推进。工作流之间通过明确定义的接口通信，不需要实时同步。

```
Stream A (workpaw-ui)        → Tasks 1.1 - 1.4
Stream B (workpaw-operator)  → Tasks 2.1 - 2.6
Stream C (workpaw-control-plane) → Tasks 3.1 - 3.7
Stream D (workpaw-desktop)   → Tasks 4.1 - 4.8
```

**依赖关系：**
- Stream D 的 Task 4.3+ 需要 Stream A 的 Task 1.3 完成（API 客户端）
- Stream C 的 Task 3.5 需要 Stream B 的 Task 2.3 完成（CRD 定义）
- 其他任务可完全并行

---

## Stream A: workpaw-ui（共享 UI 包）

### Task 1.1: 项目脚手架

**Files:**
- Create: `~/github/workpaw-ui/package.json`
- Create: `~/github/workpaw-ui/tsconfig.json`
- Create: `~/github/workpaw-ui/vite.config.ts`
- Create: `~/github/workpaw-ui/src/index.ts`
- Create: `~/github/workpaw-ui/CLAUDE.md`

- [ ] **Step 1: 初始化项目**

```bash
cd ~/github
mkdir workpaw-ui && cd workpaw-ui
npm init -y
```

- [ ] **Step 2: 安装依赖**

```bash
cd ~/github/workpaw-ui
npm install react react-dom zustand i18next react-i18next clsx tailwind-merge
npm install -D typescript @types/react @types/react-dom vite @vitejs/plugin-react tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: 配置 TypeScript**

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 配置 Vite**

创建 `vite.config.ts`：

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: ["react", "react-dom"],
    },
  },
});
```

- [ ] **Step 5: 初始化 Shadcn UI**

```bash
cd ~/github/workpaw-ui
npx shadcn@latest init
```

选择：New York style, Zinc base color, CSS variables yes.

- [ ] **Step 6: 创建入口文件**

创建 `src/index.ts`：

```typescript
// Components
export * from "./components/ui/button";
export * from "./components/ui/input";
export * from "./components/ui/dialog";
export * from "./components/ui/card";
export * from "./components/ui/table";

// Hooks
export { useFetch } from "./hooks/useFetch";

// Lib
export { cn } from "./lib/utils";

// Types
export * from "./types/instance";
export * from "./types/auth";
export * from "./types/chat";

// API Client
export { ApiClient } from "./api/client";
export type { ApiClientConfig } from "./api/client";
```

- [ ] **Step 7: 创建 CLAUDE.md**

```markdown
# workpaw-ui

WorkPaw 共享 UI 包，提供通用组件、hooks、API 类型定义和客户端。

## 相关仓库
- workpaw-desktop: ~/github/workpaw-desktop
- workpaw-web: ~/github/workpaw-web
- workpaw-control-plane/console: ~/github/workpaw-control-plane/console
- workpaw-control-plane: ~/github/workpaw-control-plane
- workpaw-operator: ~/github/workpaw-operator
- QwenPaw 源码参考: ~/github/QwenPaw

## 技术栈
React, Vite, TypeScript, Shadcn UI, zustand, Tailwind CSS

## 开发
npm run dev
npm run build
```

- [ ] **Step 8: 初始化 Git 并提交**

```bash
cd ~/github/workpaw-ui
git init
echo "node_modules\ndist" > .gitignore
git add .
git commit -m "feat: initialize workpaw-ui project"
```

### Task 1.2: QwenPaw API 类型定义

**Files:**
- Create: `~/github/workpaw-ui/src/types/instance.ts`
- Create: `~/github/workpaw-ui/src/types/auth.ts`
- Create: `~/github/workpaw-ui/src/types/chat.ts`
- Create: `~/github/workpaw-ui/src/types/session.ts`
- Create: `~/github/workpaw-ui/src/types/agent.ts`

- [ ] **Step 1: 定义实例类型**

创建 `src/types/instance.ts`：

```typescript
export type InstanceStatus = "not_found" | "creating" | "running" | "stopped";

export interface InstancePolicy {
  idle_timeout_minutes: number;
  schedule_stop: string;
}

export interface InstanceInfo {
  status: InstanceStatus;
  ingress_url: string;
  api_token: string;
  created_at: string;
  last_active_at: string;
  policy: InstancePolicy;
}

export interface InstanceConnectResponse {
  ingress_url: string;
  api_token: string;
}
```

- [ ] **Step 2: 定义认证类型**

创建 `src/types/auth.ts`：

```typescript
export interface AuthUser {
  user_id: string;
  email: string;
  name: string;
  roles: string[];
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface AuthLoginResponse {
  auth_url: string;
}
```

- [ ] **Step 3: 定义对话类型**

参考 `~/github/QwenPaw/console/src/api/types/` 中的类型定义，创建 `src/types/chat.ts`：

```typescript
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ChatSpec {
  id: string;
  title: string;
  agent_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ChatHistory {
  chat: ChatSpec;
  messages: ChatMessage[];
}

export interface SendMessageRequest {
  message: string;
  agent_id?: string;
  files?: string[];
}

export interface ChatUploadResponse {
  url: string;
  file_name: string;
  stored_name?: string;
}
```

- [ ] **Step 4: 定义会话类型**

创建 `src/types/session.ts`：

```typescript
export interface Session {
  id: string;
  title: string;
  agent_id?: string;
  channel?: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 5: 定义 Agent 类型**

创建 `src/types/agent.ts`：

```typescript
export interface Agent {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  enabled: boolean;
}
```

- [ ] **Step 6: 提交**

```bash
cd ~/github/workpaw-ui
git add src/types/
git commit -m "feat: add QwenPaw API type definitions"
```

### Task 1.3: API 客户端

**Files:**
- Create: `~/github/workpaw-ui/src/api/client.ts`
- Create: `~/github/workpaw-ui/src/api/controlPlane.ts`

- [ ] **Step 1: 实现通用 API 客户端**

创建 `src/api/client.ts`：

```typescript
export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
}

export class ApiClient {
  private config: ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  private buildHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    const token = this.config.getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const method = options.method || "GET";

    const headers = this.buildHeaders(options.headers);
    if (["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      if (response.status === 401) {
        this.config.onUnauthorized?.();
      }
      const text = await response.text().catch(() => "");
      throw new Error(`API Error: ${response.status} ${response.statusText} - ${text}`);
    }

    if (response.status === 204) return undefined as T;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return (await response.text()) as unknown as T;
    }

    return (await response.json()) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }
}
```

- [ ] **Step 2: 实现 Control Plane API 封装**

创建 `src/api/controlPlane.ts`：

```typescript
import { ApiClient } from "./client";
import type { AuthLoginResponse, AuthTokens } from "../types/auth";
import type { InstanceInfo, InstanceConnectResponse } from "../types/instance";

export class ControlPlaneApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  getLoginUrl(): Promise<AuthLoginResponse> {
    return this.client.get<AuthLoginResponse>("/api/auth/login");
  }

  refreshToken(refreshToken: string): Promise<AuthTokens> {
    return this.client.post<AuthTokens>("/api/auth/refresh", { refresh_token: refreshToken });
  }

  logout(): Promise<void> {
    return this.client.post("/api/auth/logout");
  }

  getInstance(): Promise<InstanceInfo> {
    return this.client.get<InstanceInfo>("/api/instance");
  }

  activateInstance(): Promise<InstanceInfo> {
    return this.client.post<InstanceInfo>("/api/instance/activate");
  }

  deactivateInstance(): Promise<void> {
    return this.client.post("/api/instance/deactivate");
  }

  getConnectInfo(): Promise<InstanceConnectResponse> {
    return this.client.get<InstanceConnectResponse>("/api/instance/connect");
  }
}
```

- [ ] **Step 3: 提交**

```bash
cd ~/github/workpaw-ui
git add src/api/
git commit -m "feat: add API client and Control Plane API wrapper"
```

### Task 1.4: 基础 Shadcn UI 组件

**Files:**
- Create: `~/github/workpaw-ui/src/components/ui/button.tsx`
- Create: `~/github/workpaw-ui/src/components/ui/input.tsx`
- Create: `~/github/workpaw-ui/src/components/ui/dialog.tsx`
- Create: `~/github/workpaw-ui/src/components/ui/card.tsx`
- Create: `~/github/workpaw-ui/src/hooks/useFetch.ts`
- Create: `~/github/workpaw-ui/src/lib/utils.ts`

- [ ] **Step 1: 安装 Shadcn UI 基础组件**

```bash
cd ~/github/workpaw-ui
npx shadcn@latest add button input dialog card table badge avatar dropdown-menu separator scroll-area
```

- [ ] **Step 2: 实现 useFetch hook**

创建 `src/hooks/useFetch.ts`：

```typescript
import { useState, useEffect, useCallback } from "react";

interface UseFetchOptions<T> {
  initialData?: T;
  immediate?: boolean;
}

interface UseFetchResult<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useFetch<T>(
  fetcher: () => Promise<T>,
  options: UseFetchOptions<T> = {}
): UseFetchResult<T> {
  const { initialData = null, immediate = true } = options;
  const [data, setData] = useState<T | null>(initialData);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    if (immediate) {
      refetch();
    }
  }, [immediate, refetch]);

  return { data, error, loading, refetch };
}
```

- [ ] **Step 3: 确认 lib/utils.ts 存在**

Shadcn UI init 应已创建 `src/lib/utils.ts`（包含 `cn` 函数）。如未创建：

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: 更新入口文件**

确保 `src/index.ts` 导出所有组件和 hooks。

- [ ] **Step 5: 验证构建**

```bash
cd ~/github/workpaw-ui
npm run build
```

Expected: 构建成功，无错误。

- [ ] **Step 6: 提交**

```bash
cd ~/github/workpaw-ui
git add .
git commit -m "feat: add base Shadcn UI components, useFetch hook, and utils"
```

---

## Stream B: workpaw-operator（K8s Operator）

### Task 2.1: Operator 项目脚手架

**Files:**
- Create: `~/github/workpaw-operator/` (entire project)
- Create: `~/github/workpaw-operator/CLAUDE.md`

- [ ] **Step 1: 初始化 Operator 项目**

```bash
cd ~/github
mkdir -p workpaw-operator && cd workpaw-operator
operator-sdk init --domain workpaw.io --repo github.com/workpaw/workpaw-operator
```

如果 operator-sdk 未安装，使用 kubebuilder：
```bash
cd ~/github
kubebuilder init --domain workpaw.io --repo github.com/workpaw/workpaw-operator
```

- [ ] **Step 2: 创建 CLAUDE.md**

```markdown
# workpaw-operator

WorkPaw K8s Operator，管理 QwenPawInstance CRD 的生命周期。

## 相关仓库
- workpaw-ui: ~/github/workpaw-ui
- workpaw-desktop: ~/github/workpaw-desktop
- workpaw-web: ~/github/workpaw-web
- workpaw-control-plane/console: ~/github/workpaw-control-plane/console
- workpaw-control-plane: ~/github/workpaw-control-plane
- QwenPaw 源码参考: ~/github/QwenPaw

## 技术栈
Go, Operator SDK / Kubebuilder, Gin (如需 HTTP), Zap, Viper, Cobra

## 开发
make install    # 安装 CRD 到本地 K8s
make run        # 本地运行 Operator
make docker-build  # 构建 Docker 镜像
```

- [ ] **Step 3: 添加 Zap 日志和 Viper 配置**

创建 `pkg/config/config.go`：

```go
package config

import (
	"github.com/spf13/viper"
	"go.uber.org/zap"
)

type Config struct {
	QwenPawImage  string `mapstructure:"qwenpaw_image"`
	BaseDomain    string `mapstructure:"base_domain"`
	IngressClass  string `mapstructure:"ingress_class"`
	TLSSecret     string `mapstructure:"tls_secret"`
	StorageClass  string `mapstructure:"storage_class"`
	DefaultCPU    string `mapstructure:"default_cpu"`
	DefaultMemory string `mapstructure:"default_memory"`
	StorageSize   string `mapstructure:"storage_size"`
}

func Load() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("/etc/workpaw")
	viper.AutomaticEnv()

	viper.SetDefault("qwenpaw_image", "qwenpaw/qwenpaw:v1.1.12")
	viper.SetDefault("base_domain", "qwenpaw.workpaw.internal")
	viper.SetDefault("ingress_class", "nginx")
	viper.SetDefault("storage_class", "standard")
	viper.SetDefault("default_cpu", "500m")
	viper.SetDefault("default_memory", "1Gi")
	viper.SetDefault("storage_size", "10Gi")

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, err
		}
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func NewLogger() (*zap.Logger, error) {
	return zap.NewProduction()
}
```

- [ ] **Step 4: 添加 Cobra CLI**

创建 `cmd/root.go`：

```go
package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "workpaw-operator",
	Short: "WorkPaw Kubernetes Operator",
	Long:  "Manages QwenPawInstance CRD lifecycle in Kubernetes",
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
```

创建 `cmd/serve.go`：

```go
package cmd

import (
	"github.com/spf13/cobra"
	"go.uber.org/zap"
)

var devMode bool

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the operator",
	RunE: func(cmd *cobra.Command, args []string) error {
		logger, _ := zap.NewProduction()
		defer logger.Sync()

		logger.Info("Starting WorkPaw Operator",
			zap.Bool("dev_mode", devMode),
		)

		// Operator manager setup will go here
		return nil
	},
}

func init() {
	serveCmd.Flags().BoolVar(&devMode, "dev", false, "Enable development mode")
	rootCmd.AddCommand(serveCmd)
}
```

创建 `cmd/version.go`：

```go
package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var Version = "dev"

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("workpaw-operator %s\n", Version)
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)
}
```

更新 `main.go`：

```go
package main

import "github.com/workpaw/workpaw-operator/cmd"

func main() {
	cmd.Execute()
}
```

- [ ] **Step 5: 初始化 Go module 并安装依赖**

```bash
cd ~/github/workpaw-operator
go mod tidy
```

- [ ] **Step 6: 提交**

```bash
cd ~/github/workpaw-operator
git init
git add .
git commit -m "feat: initialize workpaw-operator project with Cobra CLI"
```

### Task 2.2: CRD 定义

**Files:**
- Create: `~/github/workpaw-operator/api/v1alpha1/qwenpawinstance_types.go`

- [ ] **Step 1: 生成 CRD scaffold**

```bash
cd ~/github/workpaw-operator
operator-sdk create api --group workpaw --version v1alpha1 --kind QwenPawInstance --resource --controller
```

或使用 kubebuilder：
```bash
kubebuilder create api --group workpaw --version v1alpha1 --kind QwenPawInstance --resource --controller
```

- [ ] **Step 2: 定义 CRD 类型**

编辑 `api/v1alpha1/qwenpawinstance_types.go`：

```go
package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type QwenPawInstanceSpec struct {
	// QwenPaw container image
	// +kubebuilder:default="qwenpaw/qwenpaw:v1.1.12"
	Image string `json:"image"`

	// Resource limits
	Resources ResourceSpec `json:"resources,omitempty"`

	// Persistent storage
	Storage StorageSpec `json:"storage,omitempty"`

	// Lifecycle policy
	Policy PolicySpec `json:"policy,omitempty"`

	// Desired state: Running or Stopped
	// +kubebuilder:validation:Enum=Running;Stopped
	// +kubebuilder:default=Running
	DesiredState string `json:"desiredState"`
}

type ResourceSpec struct {
	CPU    string `json:"cpu,omitempty"`
	Memory string `json:"memory,omitempty"`
}

type StorageSpec struct {
	Size         string `json:"size,omitempty"`
	StorageClass string `json:"storageClass,omitempty"`
}

type PolicySpec struct {
	IdleTimeoutMinutes int    `json:"idleTimeoutMinutes,omitempty"`
	ScheduleStop       string `json:"scheduleStop,omitempty"`
	ScheduleStart      string `json:"scheduleStart,omitempty"`
}

type QwenPawInstanceStatus struct {
	CurrentState string `json:"currentState,omitempty"`
	PodName      string `json:"podName,omitempty"`
	PodIP        string `json:"podIP,omitempty"`
	IngressHost  string `json:"ingressHost,omitempty"`
	LastActiveAt string `json:"lastActiveAt,omitempty"`

	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:printcolumn:name="State",type=string,JSONPath=`.status.currentState`
// +kubebuilder:printcolumn:name="Ingress",type=string,JSONPath=`.status.ingressHost`
// +kubebuilder:printcolumn:name="Age",type="date",JSONPath=".metadata.creationTimestamp"
type QwenPawInstance struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   QwenPawInstanceSpec   `json:"spec,omitempty"`
	Status QwenPawInstanceStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true
type QwenPawInstanceList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []QwenPawInstance `json:"items"`
}

func init() {
	SchemeBuilder.Register(&QwenPawInstance{}, &QwenPawInstanceList{})
}
```

- [ ] **Step 3: 生成 CRD manifests**

```bash
cd ~/github/workpaw-operator
make manifests
```

- [ ] **Step 4: 提交**

```bash
cd ~/github/workpaw-operator
git add .
git commit -m "feat: define QwenPawInstance CRD types"
```

### Task 2.3: Reconcile - 创建实例

**Files:**
- Modify: `~/github/workpaw-operator/internal/controller/qwenpawinstance_controller.go`

- [ ] **Step 1: 实现 Reconcile 创建逻辑**

编辑 `internal/controller/qwenpawinstance_controller.go`，实现以下子资源的创建：

1. **Secret**（API Access Token）— 生成 UUID v4 随机 token
2. **StatefulSet** — QwenPaw Pod，挂载 PVC，注入 token 环境变量
3. **Service** — ClusterIP Service
4. **Ingress** — 暴露域名 `{username}.{base_domain}`
5. **PVC** — 持久化存储（StatefulSet 自动管理）

核心 Reconcile 逻辑：

```go
func (r *QwenPawInstanceReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx)
	
	// 1. 获取 CR
	instance := &workpawv1alpha1.QwenPawInstance{}
	if err := r.Get(ctx, req.NamespacedName, instance); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	// 2. 根据 desiredState 执行动作
	switch instance.Spec.DesiredState {
	case "Running":
		return r.reconcileRunning(ctx, instance)
	case "Stopped":
		return r.reconcileStopped(ctx, instance)
	}

	return ctrl.Result{}, nil
}

func (r *QwenPawInstanceReconciler) reconcileRunning(ctx context.Context, instance *workpawv1alpha1.QwenPawInstance) (ctrl.Result, error) {
	logger := log.FromContext(ctx)
	username := instance.Name
	namespace := instance.Namespace

	// 2a. 确保 Secret（Access Token）存在
	if err := r.ensureTokenSecret(ctx, instance); err != nil {
		logger.Error(err, "Failed to ensure token secret")
		return ctrl.Result{}, err
	}

	// 2b. 确保 StatefulSet 存在
	if err := r.ensureStatefulSet(ctx, instance); err != nil {
		logger.Error(err, "Failed to ensure StatefulSet")
		return ctrl.Result{}, err
	}

	// 2c. 确保 Service 存在
	if err := r.ensureService(ctx, instance); err != nil {
		logger.Error(err, "Failed to ensure Service")
		return ctrl.Result{}, err
	}

	// 2d. 确保 Ingress 存在
	if err := r.ensureIngress(ctx, instance); err != nil {
		logger.Error(err, "Failed to ensure Ingress")
		return ctrl.Result{}, err
	}

	// 2e. 检查 Pod 状态并更新 status
	return r.updateStatus(ctx, instance)
}
```

`ensureTokenSecret` 实现要点：
- 检查 Secret `qwenpaw-token-{username}` 是否存在
- 不存在则生成 UUID v4 token，创建 Secret
- Secret 数据 key: `api-token`

`ensureStatefulSet` 实现要点：
- replicas=1
- 容器镜像: `instance.Spec.Image`
- 环境变量 `QWENPAW_TOKEN` 从 Secret 注入
- VolumeClaimTemplate: 使用 `instance.Spec.Storage` 配置
- 端口: 8080 (HTTP API)

`ensureIngress` 实现要点：
- Host: `{username}.{base_domain}`
- TLS: 使用 `tls_secret` 配置的证书
- Backend: 指向 Service

- [ ] **Step 2: 实现 reconcileStopped**

```go
func (r *QwenPawInstanceReconciler) reconcileStopped(ctx context.Context, instance *workpawv1alpha1.QwenPawInstance) (ctrl.Result, error) {
	logger := log.FromContext(ctx)

	// Scale StatefulSet to 0（保留 PVC 数据）
	sts := &appsv1.StatefulSet{}
	stsName := fmt.Sprintf("qwenpaw-%s", instance.Name)
	err := r.Get(ctx, types.NamespacedName{Name: stsName, Namespace: instance.Namespace}, sts)
	if err != nil {
		if apierrors.IsNotFound(err) {
			// StatefulSet 不存在，已经是 stopped 状态
			return r.updateStoppedStatus(ctx, instance)
		}
		return ctrl.Result{}, err
	}

	// Scale to 0
	var zero int32 = 0
	sts.Spec.Replicas = &zero
	if err := r.Update(ctx, sts); err != nil {
		logger.Error(err, "Failed to scale down StatefulSet")
		return ctrl.Result{}, err
	}

	return r.updateStoppedStatus(ctx, instance)
}
```

- [ ] **Step 3: 实现 status 更新**

```go
func (r *QwenPawInstanceReconciler) updateStatus(ctx context.Context, instance *workpawv1alpha1.QwenPawInstance) (ctrl.Result, error) {
	sts := &appsv1.StatefulSet{}
	stsName := fmt.Sprintf("qwenpaw-%s", instance.Name)
	if err := r.Get(ctx, types.NamespacedName{Name: stsName, Namespace: instance.Namespace}, sts); err != nil {
		return ctrl.Result{}, err
	}

	// 检查 Pod 是否 Ready
	if sts.ReadyReplicas > 0 {
		instance.Status.CurrentState = "Running"
		instance.Status.PodName = fmt.Sprintf("%s-0", stsName)
		instance.Status.IngressHost = fmt.Sprintf("%s.%s", instance.Name, r.Config.BaseDomain)
	} else {
		instance.Status.CurrentState = "Creating"
	}

	if err := r.Status().Update(ctx, instance); err != nil {
		return ctrl.Result{}, err
	}

	// 如果还在创建中，10 秒后重试
	if instance.Status.CurrentState == "Creating" {
		return ctrl.Result{RequeueAfter: 10 * time.Second}, nil
	}

	return ctrl.Result{}, nil
}
```

- [ ] **Step 4: 本地测试**

```bash
cd ~/github/workpaw-operator
make install  # 安装 CRD 到本地 K8s
make run      # 运行 Operator
```

在另一个终端创建测试实例：

```bash
kubectl apply -f config/samples/workpaw_v1alpha1_qwenpawinstance.yaml
kubectl get qwenpawinstances -w
```

Expected: 看到实例状态从 Creating → Running。

- [ ] **Step 5: 提交**

```bash
cd ~/github/workpaw-operator
git add .
git commit -m "feat: implement Reconcile for creating/stopping QwenPaw instances"
```

### Task 2.4: Operator RBAC + Dockerfile

**Files:**
- Modify: `~/github/workpaw-operator/config/rbac/role.yaml`
- Create: `~/github/workpaw-operator/Dockerfile`

- [ ] **Step 1: 配置 RBAC**

确保 Operator 的 ServiceAccount 有权限管理：StatefulSet, Service, Ingress, PVC, Secret, ConfigMap。

运行 `make manifests` 自动从 kubebuilder marker 生成 RBAC。

在 controller 文件顶部添加 marker：

```go
// +kubebuilder:rbac:groups=apps,resources=statefulsets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=services;secrets;configmaps;persistentvolumeclaims,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=networking.k8s.io,resources=ingresses,verbs=get;list;watch;create;update;patch;delete
```

- [ ] **Step 2: 构建 Docker 镜像**

```bash
cd ~/github/workpaw-operator
make docker-build IMG=workpaw/operator:latest
```

- [ ] **Step 3: 提交**

```bash
cd ~/github/workpaw-operator
git add .
git commit -m "feat: configure RBAC and Dockerfile for operator"
```

---

## Stream C: workpaw-control-plane（Control Plane API）

### Task 3.1: Control Plane 项目脚手架

**Files:**
- Create: `~/github/workpaw-control-plane/` (entire project)
- Create: `~/github/workpaw-control-plane/CLAUDE.md`

- [ ] **Step 1: 初始化 Go 项目**

```bash
cd ~/github
mkdir -p workpaw-control-plane && cd workpaw-control-plane
go mod init github.com/workpaw/workpaw-control-plane
```

- [ ] **Step 2: 安装依赖**

```bash
cd ~/github/workpaw-control-plane
go get github.com/gin-gonic/gin
go get go.uber.org/zap
go get github.com/spf13/viper
go get github.com/spf13/cobra
go get github.com/golang-jwt/jwt/v5
go get github.com/google/uuid
go get github.com/coreos/go-oidc/v3/oidc
go get golang.org/x/oauth2
```

- [ ] **Step 3: 创建项目结构**

```
workpaw-control-plane/
├── cmd/
│   ├── root.go
│   ├── serve.go
│   └── version.go
├── internal/
│   ├── config/
│   │   └── config.go
│   ├── middleware/
│   │   ├── cors.go
│   │   ├── requestid.go
│   │   ├── logger.go
│   │   └── auth.go
│   ├── handler/
│   │   ├── auth.go
│   │   ├── instance.go
│   │   └── admin.go
│   ├── service/
│   │   ├── oidc.go
│   │   ├── jwt.go
│   │   └── instance.go
│   └── router/
│       └── router.go
├── main.go
├── config.yaml
├── Dockerfile
└── CLAUDE.md
```

- [ ] **Step 4: 创建 CLAUDE.md**

```markdown
# workpaw-control-plane

WorkPaw Control Plane API 服务，处理 SSO 认证、实例管理和审计日志。

## 相关仓库
- workpaw-ui: ~/github/workpaw-ui
- workpaw-desktop: ~/github/workpaw-desktop
- workpaw-web: ~/github/workpaw-web
- workpaw-control-plane/console: ~/github/workpaw-control-plane/console
- workpaw-operator: ~/github/workpaw-operator
- QwenPaw 源码参考: ~/github/QwenPaw

## 技术栈
Go, Gin, Zap, Viper, Cobra, PostgreSQL

## 开发
go run main.go serve
go run main.go serve --dev
```

- [ ] **Step 5: 实现 Cobra CLI**

`cmd/root.go`:

```go
package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "workpaw-control-plane",
	Short: "WorkPaw Control Plane API",
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
```

`cmd/serve.go`:

```go
package cmd

import (
	"github.com/spf13/cobra"
	"github.com/workpaw/workpaw-control-plane/internal/config"
	"github.com/workpaw/workpaw-control-plane/internal/router"
	"go.uber.org/zap"
)

var devMode bool

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the Control Plane API server",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return err
		}

		logger, err := config.NewLogger(cfg)
		if err != nil {
			return err
		}
		defer logger.Sync()

		if devMode {
			cfg.Server.Mode = "debug"
		}

		logger.Info("Starting WorkPaw Control Plane",
			zap.Int("port", cfg.Server.Port),
			zap.String("mode", cfg.Server.Mode),
		)

		r := router.Setup(cfg, logger)
		return r.Run(fmt.Sprintf(":%d", cfg.Server.Port))
	},
}

func init() {
	serveCmd.Flags().BoolVar(&devMode, "dev", false, "Enable debug mode")
	rootCmd.AddCommand(serveCmd)
}
```

- [ ] **Step 6: 实现配置加载**

`internal/config/config.go`:

```go
package config

import (
	"github.com/spf13/viper"
	"go.uber.org/zap"
)

type Config struct {
	Server     ServerConfig     `mapstructure:"server"`
	OIDC       OIDCConfig       `mapstructure:"oidc"`
	JWT        JWTConfig        `mapstructure:"jwt"`
	Kubernetes KubernetesConfig `mapstructure:"kubernetes"`
	Ingress    IngressConfig    `mapstructure:"ingress"`
	Postgres   PostgresConfig   `mapstructure:"postgres"`
	Policy     PolicyConfig     `mapstructure:"policy"`
}

type ServerConfig struct {
	Port int    `mapstructure:"port"`
	Mode string `mapstructure:"mode"`
}

type OIDCConfig struct {
	IssuerURL    string `mapstructure:"issuer_url"`
	ClientID     string `mapstructure:"client_id"`
	ClientSecret string `mapstructure:"client_secret"`
	RedirectURL  string `mapstructure:"redirect_url"`
}

type JWTConfig struct {
	Secret      string `mapstructure:"secret"`
	ExpireHours int    `mapstructure:"expire_hours"`
}

type KubernetesConfig struct {
	Kubeconfig   string `mapstructure:"kubeconfig"`
	Namespace    string `mapstructure:"namespace"`
	QwenPawImage string `mapstructure:"qwenpaw_image"`
}

type IngressConfig struct {
	BaseDomain string `mapstructure:"base_domain"`
	Class      string `mapstructure:"class"`
	TLSSecret  string `mapstructure:"tls_secret"`
}

type PostgresConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Database string `mapstructure:"database"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
}

type PolicyConfig struct {
	DefaultIdleTimeoutMinutes int    `mapstructure:"default_idle_timeout_minutes"`
	DefaultScheduleStop       string `mapstructure:"default_schedule_stop"`
}

func Load() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("/etc/workpaw")
	viper.AutomaticEnv()

	viper.SetDefault("server.port", 8080)
	viper.SetDefault("server.mode", "release")
	viper.SetDefault("jwt.expire_hours", 24)
	viper.SetDefault("kubernetes.namespace", "workpaw-instances")
	viper.SetDefault("kubernetes.qwenpaw_image", "qwenpaw/qwenpaw:v1.1.12")
	viper.SetDefault("ingress.base_domain", "qwenpaw.workpaw.internal")
	viper.SetDefault("ingress.class", "nginx")
	viper.SetDefault("postgres.port", 5432)
	viper.SetDefault("policy.default_idle_timeout_minutes", 30)
	viper.SetDefault("policy.default_schedule_stop", "22:00")

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, err
		}
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func NewLogger(cfg *Config) (*zap.Logger, error) {
	if cfg.Server.Mode == "debug" {
		return zap.NewDevelopment()
	}
	return zap.NewProduction()
}
```

- [ ] **Step 7: 提交**

```bash
cd ~/github/workpaw-control-plane
git init
echo "*.exe\n*.yaml\n!config.example.yaml" > .gitignore
git add .
git commit -m "feat: initialize workpaw-control-plane project"
```

### Task 3.2: OIDC + JWT 认证

**Files:**
- Create: `~/github/workpaw-control-plane/internal/service/oidc.go`
- Create: `~/github/workpaw-control-plane/internal/service/jwt.go`
- Create: `~/github/workpaw-control-plane/internal/handler/auth.go`

- [ ] **Step 1: 实现 OIDC Service**

`internal/service/oidc.go`:

```go
package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/workpaw/workpaw-control-plane/internal/config"
	"golang.org/x/oauth2"
)

type OIDCService struct {
	provider *oidc.Provider
	config   oauth2.Config
	verifier *oidc.IDTokenVerifier
}

func NewOIDCService(cfg *config.OIDCConfig) (*OIDCService, error) {
	ctx := context.Background()
	provider, err := oidc.NewProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, err
	}

	oauth2Config := oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		RedirectURL:  cfg.RedirectURL,
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}

	verifier := provider.Verifier(&oidc.Config{ClientID: cfg.ClientID})

	return &OIDCService{
		provider: provider,
		config:   oauth2Config,
		verifier: verifier,
	}, nil
}

func (s *OIDCService) GetAuthURL() (string, string, error) {
	state, err := generateRandomString(32)
	if err != nil {
		return "", "", err
	}
	url := s.config.AuthCodeURL(state)
	return url, state, nil
}

func (s *OIDCService) ExchangeCode(ctx context.Context, code string) (*OIDCUser, error) {
	token, err := s.config.Exchange(ctx, code)
	if err != nil {
		return nil, err
	}

	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		return nil, fmt.Errorf("no id_token in response")
	}

	idToken, err := s.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return nil, err
	}

	var claims struct {
		Sub   string   `json:"sub"`
		Email string   `json:"email"`
		Name  string   `json:"name"`
		Roles []string `json:"roles"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return nil, err
	}

	return &OIDCUser{
		Sub:   claims.Sub,
		Email: claims.Email,
		Name:  claims.Name,
		Roles: claims.Roles,
	}, nil
}

type OIDCUser struct {
	Sub   string
	Email string
	Name  string
	Roles []string
}

func generateRandomString(n int) (string, error) {
	bytes := make([]byte, n)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
```

- [ ] **Step 2: 实现 JWT Service**

`internal/service/jwt.go`:

```go
package service

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/workpaw/workpaw-control-plane/internal/config"
)

type JWTService struct {
	secret      []byte
	expireHours int
}

type WorkPawClaims struct {
	UserID string   `json:"user_id"`
	Email  string   `json:"email"`
	Name   string   `json:"name"`
	Roles  []string `json:"roles"`
	jwt.RegisteredClaims
}

func NewJWTService(cfg *config.JWTConfig) *JWTService {
	return &JWTService{
		secret:      []byte(cfg.Secret),
		expireHours: cfg.ExpireHours,
	}
}

func (s *JWTService) GenerateToken(user *OIDCUser) (string, error) {
	claims := WorkPawClaims{
		UserID: user.Sub,
		Email:  user.Email,
		Name:   user.Name,
		Roles:  user.Roles,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(s.expireHours) * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        uuid.New().String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.secret)
}

func (s *JWTService) ValidateToken(tokenString string) (*WorkPawClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &WorkPawClaims{}, func(token *jwt.Token) (interface{}, error) {
		return s.secret, nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*WorkPawClaims)
	if !ok || !token.Valid {
		return nil, jwt.ErrSignatureInvalid
	}

	return claims, nil
}
```

- [ ] **Step 3: 实现 Auth Handler**

`internal/handler/auth.go`:

```go
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/workpaw/workpaw-control-plane/internal/service"
	"go.uber.org/zap"
)

type AuthHandler struct {
	oidcService *service.OIDCService
	jwtService  *service.JWTService
	logger      *zap.Logger
}

func NewAuthHandler(oidc *service.OIDCService, jwt *service.JWTService, logger *zap.Logger) *AuthHandler {
	return &AuthHandler{oidcService: oidc, jwtService: jwt, logger: logger}
}

func (h *AuthHandler) Login(c *gin.Context) {
	authURL, state, err := h.oidcService.GetAuthURL()
	if err != nil {
		h.logger.Error("Failed to get auth URL", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate auth URL"})
		return
	}

	// TODO: 存储 state 用于回调验证（Redis 或内存缓存）
	_ = state

	c.JSON(http.StatusOK, gin.H{"auth_url": authURL})
}

func (h *AuthHandler) Callback(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing code parameter"})
		return
	}

	user, err := h.oidcService.ExchangeCode(c.Request.Context(), code)
	if err != nil {
		h.logger.Error("Failed to exchange code", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Authentication failed"})
		return
	}

	token, err := h.jwtService.GenerateToken(user)
	if err != nil {
		h.logger.Error("Failed to generate JWT", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token": token,
		"user": gin.H{
			"user_id": user.Sub,
			"email":   user.Email,
			"name":    user.Name,
			"roles":   user.Roles,
		},
	})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	// JWT 是无状态的，logout 由客户端删除 token 实现
	c.JSON(http.StatusOK, gin.H{"message": "Logged out"})
}
```

- [ ] **Step 4: 提交**

```bash
cd ~/github/workpaw-control-plane
git add .
git commit -m "feat: implement OIDC + JWT authentication"
```

### Task 3.3: 实例管理 API

**Files:**
- Create: `~/github/workpaw-control-plane/internal/service/instance.go`
- Create: `~/github/workpaw-control-plane/internal/handler/instance.go`

- [ ] **Step 1: 实现 Instance Service（对接 K8s API）**

`internal/service/instance.go`:

```go
package service

import (
	"context"
	"fmt"

	workpawv1alpha1 "github.com/workpaw/workpaw-operator/api/v1alpha1"
	"github.com/workpaw/workpaw-control-plane/internal/config"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type InstanceService struct {
	k8sClient  client.Client
	kubeClient *kubernetes.Clientset
	cfg        *config.Config
}

func NewInstanceService(cfg *config.Config) (*InstanceService, error) {
	var restConfig *rest.Config
	var err error

	if cfg.Kubernetes.Kubeconfig != "" {
		restConfig, err = clientcmd.BuildConfigFromFlags("", cfg.Kubernetes.Kubeconfig)
	} else {
		restConfig, err = rest.InClusterConfig()
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get k8s config: %w", err)
	}

	kubeClient, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return nil, err
	}

	// controller-runtime client for CRD operations
	scheme := runtime.NewScheme()
	workpawv1alpha1.AddToScheme(scheme)
	k8sclient.AddToScheme(scheme)

	k8sClient, err := client.New(restConfig, client.Options{Scheme: scheme})
	if err != nil {
		return nil, err
	}

	return &InstanceService{
		k8sClient:  k8sClient,
		kubeClient: kubeClient,
		cfg:        cfg,
	}, nil
}

type InstanceStatus struct {
	Status      string `json:"status"`
	IngressURL  string `json:"ingress_url"`
	APIToken    string `json:"api_token,omitempty"`
	CreatedAt   string `json:"created_at,omitempty"`
	LastActive  string `json:"last_active_at,omitempty"`
}

func (s *InstanceService) GetInstance(ctx context.Context, userID string) (*InstanceStatus, error) {
	instance := &workpawv1alpha1.QwenPawInstance{}
	err := s.k8sClient.Get(ctx, types.NamespacedName{
		Name:      userID,
		Namespace: s.cfg.Kubernetes.Namespace,
	}, instance)

	if err != nil {
		if apierrors.IsNotFound(err) {
			return &InstanceStatus{Status: "not_found"}, nil
		}
		return nil, err
	}

	status := &InstanceStatus{
		Status:     mapState(instance.Status.CurrentState),
		IngressURL: fmt.Sprintf("https://%s", instance.Status.IngressHost),
		CreatedAt:  instance.CreationTimestamp.Format(time.RFC3339),
		LastActive: instance.Status.LastActiveAt,
	}

	return status, nil
}

func (s *InstanceService) ActivateInstance(ctx context.Context, userID, email string) (*InstanceStatus, error) {
	instance := &workpawv1alpha1.QwenPawInstance{}
	err := s.k8sClient.Get(ctx, types.NamespacedName{
		Name:      userID,
		Namespace: s.cfg.Kubernetes.Namespace,
	}, instance)

	if apierrors.IsNotFound(err) {
		// 创建新实例
		instance = &workpawv1alpha1.QwenPawInstance{
			ObjectMeta: metav1.ObjectMeta{
				Name:      userID,
				Namespace: s.cfg.Kubernetes.Namespace,
				Labels: map[string]string{
					"workpaw.io/user-id":    userID,
					"workpaw.io/user-email": email,
				},
			},
			Spec: workpawv1alpha1.QwenPawInstanceSpec{
				Image:        s.cfg.Kubernetes.QwenPawImage,
				DesiredState: "Running",
				Policy: workpawv1alpha1.PolicySpec{
					IdleTimeoutMinutes: s.cfg.Policy.DefaultIdleTimeoutMinutes,
					ScheduleStop:       s.cfg.Policy.DefaultScheduleStop,
				},
			},
		}
		if err := s.k8sClient.Create(ctx, instance); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else {
		// 已存在但已停止 → 设置 desiredState 为 Running
		instance.Spec.DesiredState = "Running"
		if err := s.k8sClient.Update(ctx, instance); err != nil {
			return nil, err
		}
	}

	return &InstanceStatus{Status: "creating"}, nil
}

func (s *InstanceService) DeactivateInstance(ctx context.Context, userID string) error {
	instance := &workpawv1alpha1.QwenPawInstance{}
	err := s.k8sClient.Get(ctx, types.NamespacedName{
		Name:      userID,
		Namespace: s.cfg.Kubernetes.Namespace,
	}, instance)
	if err != nil {
		return err
	}

	instance.Spec.DesiredState = "Stopped"
	return s.k8sClient.Update(ctx, instance)
}

func (s *InstanceService) GetConnectInfo(ctx context.Context, userID string) (*ConnectInfo, error) {
	// 从 K8s Secret 读取 API Token
	secret, err := s.kubeClient.CoreV1().Secrets(s.cfg.Kubernetes.Namespace).Get(
		ctx, fmt.Sprintf("qwenpaw-token-%s", userID), metav1.GetOptions{},
	)
	if err != nil {
		return nil, err
	}

	instance := &workpawv1alpha1.QwenPawInstance{}
	err = s.k8sClient.Get(ctx, types.NamespacedName{
		Name:      userID,
		Namespace: s.cfg.Kubernetes.Namespace,
	}, instance)
	if err != nil {
		return nil, err
	}

	return &ConnectInfo{
		IngressURL: fmt.Sprintf("https://%s", instance.Status.IngressHost),
		APIToken:   string(secret.Data["api-token"]),
	}, nil
}

type ConnectInfo struct {
	IngressURL string `json:"ingress_url"`
	APIToken   string `json:"api_token"`
}

func mapState(state string) string {
	switch state {
	case "Running":
		return "running"
	case "Creating":
		return "creating"
	case "Stopped", "":
		return "stopped"
	default:
		return "stopped"
	}
}
```

- [ ] **Step 2: 实现 Instance Handler**

`internal/handler/instance.go`:

```go
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/workpaw/workpaw-control-plane/internal/middleware"
	"github.com/workpaw/workpaw-control-plane/internal/service"
	"go.uber.org/zap"
)

type InstanceHandler struct {
	instanceService *service.InstanceService
	logger          *zap.Logger
}

func NewInstanceHandler(svc *service.InstanceService, logger *zap.Logger) *InstanceHandler {
	return &InstanceHandler{instanceService: svc, logger: logger}
}

func (h *InstanceHandler) GetInstance(c *gin.Context) {
	claims := middleware.GetClaims(c)
	status, err := h.instanceService.GetInstance(c.Request.Context(), claims.UserID)
	if err != nil {
		h.logger.Error("Failed to get instance", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get instance"})
		return
	}
	c.JSON(http.StatusOK, status)
}

func (h *InstanceHandler) ActivateInstance(c *gin.Context) {
	claims := middleware.GetClaims(c)
	status, err := h.instanceService.ActivateInstance(c.Request.Context(), claims.UserID, claims.Email)
	if err != nil {
		h.logger.Error("Failed to activate instance", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to activate instance"})
		return
	}
	c.JSON(http.StatusOK, status)
}

func (h *InstanceHandler) DeactivateInstance(c *gin.Context) {
	claims := middleware.GetClaims(c)
	err := h.instanceService.DeactivateInstance(c.Request.Context(), claims.UserID)
	if err != nil {
		h.logger.Error("Failed to deactivate instance", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to deactivate instance"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Instance deactivating"})
}

func (h *InstanceHandler) GetConnectInfo(c *gin.Context) {
	claims := middleware.GetClaims(c)
	info, err := h.instanceService.GetConnectInfo(c.Request.Context(), claims.UserID)
	if err != nil {
		h.logger.Error("Failed to get connect info", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get connect info"})
		return
	}
	c.JSON(http.StatusOK, info)
}
```

- [ ] **Step 3: 提交**

```bash
cd ~/github/workpaw-control-plane
git add .
git commit -m "feat: implement instance management API"
```

### Task 3.4: 中间件 + 路由

**Files:**
- Create: `~/github/workpaw-control-plane/internal/middleware/auth.go`
- Create: `~/github/workpaw-control-plane/internal/middleware/logger.go`
- Create: `~/github/workpaw-control-plane/internal/middleware/requestid.go`
- Create: `~/github/workpaw-control-plane/internal/middleware/cors.go`
- Create: `~/github/workpaw-control-plane/internal/router/router.go`

- [ ] **Step 1: 实现中间件**

`internal/middleware/requestid.go`:

```go
package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := uuid.New().String()
		c.Set("request_id", id)
		c.Header("X-Request-ID", id)
		c.Next()
	}
}
```

`internal/middleware/logger.go`:

```go
package middleware

import (
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func Logger(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		logger.Info("request",
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.Int("status", c.Writer.Status()),
			zap.Duration("duration", time.Since(start)),
			zap.String("request_id", c.GetString("request_id")),
		)
	}
}
```

`internal/middleware/auth.go`:

```go
package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/workpaw/workpaw-control-plane/internal/service"
)

const claimsKey = "workpaw_claims"

func Auth(jwtService *service.JWTService) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Missing authorization header"})
			return
		}

		token := strings.TrimPrefix(header, "Bearer ")
		claims, err := jwtService.ValidateToken(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			return
		}

		c.Set(claimsKey, claims)
		c.Next()
	}
}

func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		claims := GetClaims(c)
		if claims == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

		for _, role := range claims.Roles {
			if role == "admin" {
				c.Next()
				return
			}
		}

		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Admin role required"})
	}
}

func GetClaims(c *gin.Context) *service.WorkPawClaims {
	val, exists := c.Get(claimsKey)
	if !exists {
		return nil
	}
	claims, ok := val.(*service.WorkPawClaims)
	if !ok {
		return nil
	}
	return claims
}
```

`internal/middleware/cors.go`:

```go
package middleware

import (
	"github.com/gin-gonic/gin"
)

func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
```

- [ ] **Step 2: 实现路由注册**

`internal/router/router.go`:

```go
package router

import (
	"github.com/gin-gonic/gin"
	"github.com/workpaw/workpaw-control-plane/internal/config"
	"github.com/workpaw/workpaw-control-plane/internal/handler"
	"github.com/workpaw/workpaw-control-plane/internal/middleware"
	"github.com/workpaw/workpaw-control-plane/internal/service"
	"go.uber.org/zap"
)

func Setup(cfg *config.Config, logger *zap.Logger) *gin.Engine {
	if cfg.Server.Mode != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()

	// Global middleware
	r.Use(middleware.CORS())
	r.Use(middleware.RequestID())
	r.Use(middleware.Logger(logger))
	r.Use(gin.Recovery())

	// Services
	jwtService := service.NewJWTService(&cfg.JWT)

	// Auth routes (public)
	authGroup := r.Group("/api/auth")
	// OIDC service may fail to initialize if issuer is unreachable;
	// in dev mode, use a mock
	oidcService, err := service.NewOIDCService(&cfg.OIDC)
	if err != nil {
		logger.Warn("OIDC provider unavailable, auth endpoints will fail", zap.Error(err))
	}
	if oidcService != nil {
		authHandler := handler.NewAuthHandler(oidcService, jwtService, logger)
		authGroup.GET("/login", authHandler.Login)
		authGroup.GET("/callback", authHandler.Callback)
	}
	authGroup.POST("/logout", authHandler.Logout)

	// Instance routes (authenticated)
	instanceService, err := service.NewInstanceService(cfg)
	if err != nil {
		logger.Fatal("Failed to initialize instance service", zap.Error(err))
	}
	instanceHandler := handler.NewInstanceHandler(instanceService, logger)

	instanceGroup := r.Group("/api/instance")
	instanceGroup.Use(middleware.Auth(jwtService))
	instanceGroup.GET("", instanceHandler.GetInstance)
	instanceGroup.POST("/activate", instanceHandler.ActivateInstance)
	instanceGroup.POST("/deactivate", instanceHandler.DeactivateInstance)
	instanceGroup.GET("/connect", instanceHandler.GetConnectInfo)

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	return r
}
```

- [ ] **Step 3: 提交**

```bash
cd ~/github/workpaw-control-plane
git add .
git commit -m "feat: add middleware (auth, logger, CORS, requestID) and router"
```

### Task 3.5: Dockerfile + K8s 部署

**Files:**
- Create: `~/github/workpaw-control-plane/Dockerfile`
- Create: `~/github/workpaw-control-plane/deploy/k8s.yaml`

- [ ] **Step 1: 创建 Dockerfile**

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /workpaw-control-plane .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /workpaw-control-plane /workpaw-control-plane
EXPOSE 8080
ENTRYPOINT ["/workpaw-control-plane"]
CMD ["serve"]
```

- [ ] **Step 2: 创建 K8s 部署 YAML**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: workpaw-control-plane
  namespace: workpaw
spec:
  replicas: 2
  selector:
    matchLabels:
      app: workpaw-control-plane
  template:
    metadata:
      labels:
        app: workpaw-control-plane
    spec:
      serviceAccountName: workpaw-control-plane
      containers:
        - name: control-plane
          image: workpaw/control-plane:latest
          ports:
            - containerPort: 8080
          envFrom:
            - secretRef:
                name: workpaw-control-plane-secrets
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: workpaw-control-plane
  namespace: workpaw
spec:
  selector:
    app: workpaw-control-plane
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: workpaw-control-plane
  namespace: workpaw
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - control-plane.workpaw.internal
      secretName: workpaw-tls
  rules:
    - host: control-plane.workpaw.internal
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: workpaw-control-plane
                port:
                  number: 80
```

- [ ] **Step 3: 提交**

```bash
cd ~/github/workpaw-control-plane
git add .
git commit -m "feat: add Dockerfile and K8s deployment manifests"
```

---

## Stream D: workpaw-desktop（Tauri 2 桌面客户端）

### Task 4.1: Tauri 2 项目脚手架

**Files:**
- Create: `~/github/workpaw-desktop/` (entire project)
- Create: `~/github/workpaw-desktop/CLAUDE.md`

- [ ] **Step 1: 创建 Tauri 2 + React + Vite 项目**

```bash
cd ~/github
npm create tauri-app@latest workpaw-desktop -- --template react-ts
cd workpaw-desktop
```

选择：React, TypeScript, Vite.

- [ ] **Step 2: 安装依赖**

```bash
cd ~/github/workpaw-desktop
npm install zustand i18next react-i18next react-router-dom @tauri-apps/plugin-shell @tauri-apps/plugin-deep-link @tauri-apps/plugin-store
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: 链接 workpaw-ui**

```bash
cd ~/github/workpaw-desktop
npm link ../workpaw-ui
```

在 `package.json` 的 dependencies 中添加:
```json
"workpaw-ui": "file:../workpaw-ui"
```

- [ ] **Step 4: 配置 Deep Link**

在 `src-tauri/tauri.conf.json` 中添加：

```json
{
  "plugins": {
    "deep-link": {
      "desktop": {
        "schemes": ["workpaw"]
      }
    }
  }
}
```

在 `src-tauri/Cargo.toml` 中添加 deep-link 和 shell 插件：

```toml
[dependencies]
tauri-plugin-deep-link = "2"
tauri-plugin-shell = "2"
tauri-plugin-store = "2"
```

- [ ] **Step 5: 配置 Tailwind CSS**

更新 `vite.config.ts`：

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
```

- [ ] **Step 6: 创建 CLAUDE.md**

```markdown
# workpaw-desktop

WorkPaw Tauri 2 桌面客户端，用于 Agent 对话和会话管理。

## 相关仓库
- workpaw-ui: ~/github/workpaw-ui
- workpaw-web: ~/github/workpaw-web
- workpaw-control-plane/console: ~/github/workpaw-control-plane/console
- workpaw-control-plane: ~/github/workpaw-control-plane
- workpaw-operator: ~/github/workpaw-operator
- QwenPaw 源码参考: ~/github/QwenPaw

## 技术栈
React, Vite, TypeScript, Tauri 2, Shadcn UI (via workpaw-ui), zustand

## 开发
npm run tauri dev
```

- [ ] **Step 7: 初始化 Git 并提交**

```bash
cd ~/github/workpaw-desktop
git init
git add .
git commit -m "feat: initialize workpaw-desktop with Tauri 2 + React"
```

### Task 4.2: SSO 登录页

**Files:**
- Create: `~/github/workpaw-desktop/src/stores/useAuthStore.ts`
- Create: `~/github/workpaw-desktop/src/pages/Login.tsx`

- [ ] **Step 1: 实现 Auth Store**

```typescript
import { create } from "zustand";
import { load, Store } from "@tauri-apps/plugin-store";

interface AuthState {
  token: string | null;
  user: { userId: string; email: string; name: string } | null;
  isAuthenticated: boolean;
  setToken: (token: string) => void;
  setUser: (user: AuthState["user"]) => void;
  logout: () => void;
  loadFromStore: () => Promise<void>;
}

let tauriStore: Store | null = null;

async function getStore(): Promise<Store> {
  if (!tauriStore) {
    tauriStore = await load("auth.json", { autoSave: true });
  }
  return tauriStore;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,

  setToken: async (token: string) => {
    const store = await getStore();
    await store.set("token", token);
    set({ token, isAuthenticated: true });
  },

  setUser: (user) => set({ user }),

  logout: async () => {
    const store = await getStore();
    await store.delete("token");
    set({ token: null, user: null, isAuthenticated: false });
  },

  loadFromStore: async () => {
    const store = await getStore();
    const token = await store.get<string>("token");
    if (token) {
      set({ token, isAuthenticated: true });
    }
  },
}));
```

- [ ] **Step 2: 实现 Login 页**

```tsx
import { useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { useAuthStore } from "../stores/useAuthStore";

export function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controlPlaneUrl = import.meta.env.VITE_CONTROL_PLANE_URL;

  const handleLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${controlPlaneUrl}/api/auth/login`);
      const data = await response.json();
      await open(data.auth_url); // 打开系统浏览器
    } catch (err) {
      setError("登录失败，请检查网络连接");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-80 space-y-6 text-center">
        <h1 className="text-2xl font-bold">WorkPaw</h1>
        <p className="text-gray-500">企业级 AI 助手</p>

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "正在打开浏览器..." : "企业账号登录"}
        </button>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 实现 Deep Link 回调处理**

在 `src/main.tsx` 或 `App.tsx` 中注册 deep link 监听：

```typescript
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useAuthStore } from "./stores/useAuthStore";

function setupDeepLink() {
  onOpenUrl((urls) => {
    const url = urls[0];
    if (url.startsWith("workpaw://callback")) {
      const params = new URL(url).searchParams;
      const token = params.get("token");
      if (token) {
        useAuthStore.getState().setToken(token);
      }
    }
  });
}
```

- [ ] **Step 4: 提交**

```bash
cd ~/github/workpaw-desktop
git add .
git commit -m "feat: implement SSO login with deep link callback"
```

### Task 4.3: 容器状态页

**Files:**
- Create: `~/github/workpaw-desktop/src/stores/useInstanceStore.ts`
- Create: `~/github/workpaw-desktop/src/pages/ContainerStatus.tsx`

- [ ] **Step 1: 实现 Instance Store**

```typescript
import { create } from "zustand";
import { ControlPlaneApi, ApiClient } from "workpaw-ui";
import type { InstanceInfo } from "workpaw-ui";

interface InstanceState {
  instance: InstanceInfo | null;
  loading: boolean;
  error: string | null;
  fetchInstance: () => Promise<void>;
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
  pollUntilRunning: () => Promise<void>;
}

function getControlPlaneApi(): ControlPlaneApi {
  const token = localStorage.getItem("workpaw_token") || "";
  const client = new ApiClient({
    baseUrl: import.meta.env.VITE_CONTROL_PLANE_URL,
    getToken: () => token,
  });
  return new ControlPlaneApi(client);
}

export const useInstanceStore = create<InstanceState>((set, get) => ({
  instance: null,
  loading: false,
  error: null,

  fetchInstance: async () => {
    set({ loading: true, error: null });
    try {
      const api = getControlPlaneApi();
      const instance = await api.getInstance();
      set({ instance, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  activate: async () => {
    set({ loading: true });
    try {
      const api = getControlPlaneApi();
      await api.activateInstance();
      await get().pollUntilRunning();
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  deactivate: async () => {
    try {
      const api = getControlPlaneApi();
      await api.deactivateInstance();
      set({ instance: { ...get().instance!, status: "stopped" } });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  pollUntilRunning: async () => {
    const api = getControlPlaneApi();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const instance = await api.getInstance();
      set({ instance });
      if (instance.status === "running") {
        set({ loading: false });
        return;
      }
    }
    set({ error: "容器启动超时", loading: false });
  },
}));
```

- [ ] **Step 2: 实现 ContainerStatus 页**

```tsx
import { useEffect } from "react";
import { useInstanceStore } from "../stores/useInstanceStore";

export function ContainerStatusPage() {
  const { instance, loading, error, fetchInstance, activate } = useInstanceStore();

  useEffect(() => {
    fetchInstance();
  }, [fetchInstance]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto" />
          <p>正在检测容器状态...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-96 space-y-6 text-center">
        <h2 className="text-xl font-semibold">QwenPaw 容器</h2>

        {instance?.status === "not_found" && (
          <div className="space-y-4">
            <p className="text-gray-500">尚未部署个人 QwenPaw 容器</p>
            <button onClick={activate} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white">
              新建部署
            </button>
          </div>
        )}

        {instance?.status === "stopped" && (
          <div className="space-y-4">
            <p className="text-gray-500">容器已停止</p>
            <button onClick={activate} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white">
              激活容器
            </button>
          </div>
        )}

        {instance?.status === "creating" && (
          <div className="space-y-4">
            <div className="animate-spin h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto" />
            <p>容器正在启动中，请稍候...</p>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 提交**

```bash
cd ~/github/workpaw-desktop
git add .
git commit -m "feat: implement container status page with polling"
```

### Task 4.4: Chat 对话页（核心）

**Files:**
- Create: `~/github/workpaw-desktop/src/stores/useChatStore.ts`
- Create: `~/github/workpaw-desktop/src/pages/Chat.tsx`
- Create: `~/github/workpaw-desktop/src/components/Chat/MessageList.tsx`
- Create: `~/github/workpaw-desktop/src/components/Chat/ChatInput.tsx`
- Create: `~/github/workpaw-desktop/src/components/Chat/AgentSelector.tsx`
- Create: `~/github/workpaw-desktop/src/components/Chat/SessionSidebar.tsx`

- [ ] **Step 1: 实现 Chat Store**

参考 `~/github/QwenPaw/console/src/pages/Chat/` 和 `~/github/QwenPaw/console/src/stores/` 中的实现。

```typescript
import { create } from "zustand";
import type { ChatMessage, Session } from "workpaw-ui";

interface ChatState {
  messages: ChatMessage[];
  sessions: Session[];
  currentSessionId: string | null;
  streaming: boolean;
  sendMessage: (content: string, agentId?: string) => Promise<void>;
  loadSessions: () => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  createSession: () => Promise<void>;
  setPodUrl: (url: string) => void;
  setPodToken: (token: string) => void;
  podUrl: string;
  podToken: string;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  sessions: [],
  currentSessionId: null,
  streaming: false,
  podUrl: "",
  podToken: "",

  setPodUrl: (url) => set({ podUrl: url }),
  setPodToken: (token) => set({ podToken: token }),

  sendMessage: async (content, agentId) => {
    const { podUrl, podToken, messages, currentSessionId } = get();
    set({ streaming: true });

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    set({ messages: [...messages, userMsg] });

    try {
      // 调用 QwenPaw Pod 的 chat API
      const response = await fetch(`${podUrl}/api/console/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${podToken}`,
        },
        body: JSON.stringify({
          message: content,
          chat_id: currentSessionId,
          agent_id: agentId,
        }),
      });

      // 处理流式响应 (SSE)
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      };

      set({ messages: [...get().messages, assistantMsg] });

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          assistantContent += chunk;

          set({
            messages: get().messages.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: assistantContent } : m
            ),
          });
        }
      }
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      set({ streaming: false });
    }
  },

  loadSessions: async () => {
    const { podUrl, podToken } = get();
    try {
      const response = await fetch(`${podUrl}/api/chats`, {
        headers: { Authorization: `Bearer ${podToken}` },
      });
      const sessions = await response.json();
      set({ sessions });
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  },

  selectSession: async (sessionId) => {
    const { podUrl, podToken } = get();
    set({ currentSessionId: sessionId });
    try {
      const response = await fetch(`${podUrl}/api/chats/${sessionId}`, {
        headers: { Authorization: `Bearer ${podToken}` },
      });
      const data = await response.json();
      set({ messages: data.messages || [] });
    } catch (err) {
      console.error("Failed to load session:", err);
    }
  },

  createSession: async () => {
    const { podUrl, podToken } = get();
    try {
      const response = await fetch(`${podUrl}/api/chats`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${podToken}`,
        },
        body: JSON.stringify({ title: "新对话" }),
      });
      const session = await response.json();
      set({ currentSessionId: session.id, messages: [] });
      await get().loadSessions();
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  },
}));
```

- [ ] **Step 2: 实现 Chat 页面组件**

`src/pages/Chat.tsx` — 主布局（左侧 SessionSidebar + 右侧对话区）：

```tsx
import { useEffect } from "react";
import { useChatStore } from "../stores/useChatStore";
import { MessageList } from "../components/Chat/MessageList";
import { ChatInput } from "../components/Chat/ChatInput";
import { SessionSidebar } from "../components/Chat/SessionSidebar";
import { AgentSelector } from "../components/Chat/AgentSelector";

export function ChatPage() {
  const { loadSessions } = useChatStore();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  return (
    <div className="flex h-screen">
      <SessionSidebar />
      <div className="flex flex-1 flex-col">
        <div className="border-b px-4 py-2">
          <AgentSelector />
        </div>
        <MessageList />
        <ChatInput />
      </div>
    </div>
  );
}
```

`src/components/Chat/MessageList.tsx` — 消息列表（含 Markdown 渲染）：

参考 `~/github/QwenPaw/console/src/pages/Chat/index.tsx` 实现消息气泡、Markdown 渲染、代码高亮。

`src/components/Chat/ChatInput.tsx` — 输入框 + 发送按钮 + 文件上传：

参考 `~/github/QwenPaw/console/src/pages/Chat/` 中的输入组件实现。

`src/components/Chat/AgentSelector.tsx` — Agent 切换下拉框：

调用 `${podUrl}/api/agents` 获取 Agent 列表。

`src/components/Chat/SessionSidebar.tsx` — 会话列表侧栏：

显示历史会话，点击切换。

- [ ] **Step 3: 提交**

```bash
cd ~/github/workpaw-desktop
git add .
git commit -m "feat: implement Chat page with streaming, sessions, and agent selector"
```

### Task 4.5: 整体布局 + 路由

**Files:**
- Create: `~/github/workpaw-desktop/src/layouts/MainLayout.tsx`
- Modify: `~/github/workpaw-desktop/src/App.tsx`

- [ ] **Step 1: 实现企业微信风格布局**

```tsx
import { ReactNode } from "react";
import { useAuthStore } from "../stores/useAuthStore";

interface MainLayoutProps {
  children: ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
}

export function MainLayout({ children, currentPage, onNavigate }: MainLayoutProps) {
  const { user, logout } = useAuthStore();

  return (
    <div className="flex h-screen bg-gray-100">
      {/* 最左侧头像栏 */}
      <div className="w-16 bg-gray-800 flex flex-col items-center py-4">
        <div className="w-10 h-10 rounded-full bg-gray-600 mb-4 flex items-center justify-center text-white">
          {user?.name?.[0] || "?"}
        </div>
        <div className="flex-1 flex flex-col items-center gap-4 mt-4">
          <button
            onClick={() => onNavigate("chat")}
            className={`p-2 rounded ${currentPage === "chat" ? "bg-gray-700 text-white" : "text-gray-400"}`}
            title="对话"
          >
            💬
          </button>
          <button
            onClick={() => onNavigate("sessions")}
            className={`p-2 rounded ${currentPage === "sessions" ? "bg-gray-700 text-white" : "text-gray-400"}`}
            title="会话"
          >
            📋
          </button>
        </div>
        <button
          onClick={() => {/* open web config in browser */}}
          className="p-2 rounded text-gray-400"
          title="配置"
        >
          ⚙️
        </button>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 实现 App 路由**

```tsx
import { useEffect, useState } from "react";
import { useAuthStore } from "./stores/useAuthStore";
import { useInstanceStore } from "./stores/useInstanceStore";
import { useChatStore } from "./stores/useChatStore";
import { LoginPage } from "./pages/Login";
import { ContainerStatusPage } from "./pages/ContainerStatus";
import { ChatPage } from "./pages/Chat";
import { MainLayout } from "./layouts/MainLayout";

export default function App() {
  const { isAuthenticated, token, loadFromStore } = useAuthStore();
  const { instance, fetchInstance } = useInstanceStore();
  const { setPodUrl, setPodToken } = useChatStore();
  const [currentPage, setCurrentPage] = useState("chat");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadFromStore().then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchInstance();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (instance?.status === "running" && instance.ingress_url) {
      setPodUrl(instance.ingress_url);
      // 获取 Pod API Token
      fetchConnectInfo();
    }
  }, [instance]);

  async function fetchConnectInfo() {
    try {
      const token = useAuthStore.getState().token;
      const response = await fetch(
        `${import.meta.env.VITE_CONTROL_PLANE_URL}/api/instance/connect`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      setPodUrl(data.ingress_url);
      setPodToken(data.api_token);
    } catch (err) {
      console.error("Failed to get connect info:", err);
    }
  }

  if (!ready) return null;
  if (!isAuthenticated) return <LoginPage />;
  if (instance?.status !== "running") return <ContainerStatusPage />;

  return (
    <MainLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {currentPage === "chat" && <ChatPage />}
      {currentPage === "sessions" && <ChatPage />} {/* TODO: Sessions 页 */}
    </MainLayout>
  );
}
```

- [ ] **Step 3: 提交**

```bash
cd ~/github/workpaw-desktop
git add .
git commit -m "feat: implement main layout and app routing"
```

### Task 4.6: Sessions 会话管理页

**Files:**
- Create: `~/github/workpaw-desktop/src/pages/Sessions.tsx`

- [ ] **Step 1: 实现 Sessions 页**

参考 `~/github/QwenPaw/console/src/pages/Chat/components/ChatSessionDrawer/` 实现：

- 会话列表（按更新时间排序）
- 搜索功能
- 删除会话
- 点击进入对话

- [ ] **Step 2: 提交**

```bash
cd ~/github/workpaw-desktop
git add .
git commit -m "feat: implement Sessions management page"
```

### Task 4.7: Profile 菜单

**Files:**
- Create: `~/github/workpaw-desktop/src/components/ProfileMenu.tsx`

- [ ] **Step 1: 实现 Profile 下拉菜单**

点击头像弹出菜单：
- 个人信息（姓名、邮箱）
- 打开配置页（在系统浏览器中打开 Web 配置应用）
- 退出登录

- [ ] **Step 2: 提交**

```bash
cd ~/github/workpaw-desktop
git add .
git commit -m "feat: implement Profile menu"
```

### Task 4.8: 端到端联调

- [ ] **Step 1: 本地 K8s 环境准备**

```bash
k3d cluster create workpaw-dev
```

- [ ] **Step 2: 部署 OIDC Provider（dex）**

使用 dex 作为本地 OIDC Provider 进行开发测试。

- [ ] **Step 3: 部署 Operator + Control Plane**

```bash
# Operator
cd ~/github/workpaw-operator
make install
make run

# Control Plane（另一个终端）
cd ~/github/workpaw-control-plane
go run main.go serve --dev
```

- [ ] **Step 4: 运行 Tauri 客户端**

```bash
cd ~/github/workpaw-desktop
npm run tauri dev
```

- [ ] **Step 5: 验证完整链路**

1. 登录 → 系统浏览器打开 dex 登录页 → 回调到 Tauri
2. 容器状态页 → 点击新建 → 等待容器就绪
3. Chat 页 → 发送消息 → 收到流式回复
4. 停止容器 → 再次激活

- [ ] **Step 6: 提交联调修复**

```bash
cd ~/github/workpaw-desktop
git add .
git commit -m "feat: end-to-end integration testing and fixes"
```
