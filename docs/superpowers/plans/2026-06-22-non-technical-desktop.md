# WorkPaw Desktop 非技术员工导向重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 workpaw-desktop 从"裸露技术术语的工程师界面"改造为"企业非技术员工零文档自服务"的对话端,范围仅 desktop,纯前端文案/交互改造。

**Architecture:** 在现有四页(Chat/Inbox/Cron/Files)+ 容器闸门结构上做表层改造:集中化错误翻译层、破坏性操作确认组件、容器自动拉起过渡屏、术语去技术化、空状态教学化。不改后端契约、不改 chat 消息渲染/流式、不动 web/admin。新建三个纯逻辑模块(`approvalIntents`/`errorToast`/复用 `cronToText`)走 TDD,组件改造走手动验收。

**Tech Stack:** React 19 + TypeScript + Vite 7 + Tailwind v4 + Shadcn(base-ui)+ Zustand + sonner + motion。测试:Vitest + @testing-library/react(本轮新引入)。

## Global Constraints

- **范围**: 仅 `/Users/zhangsan/workpaw/workpaw-desktop`。不碰 `workpaw-web`/`workpaw-control-plane/console`/`workpaw-control-plane`/`workpaw-operator`/`workpaw-ui`(共享 UI 包)。
- **不动**: chat 消息渲染/流式/工具调用卡片(`components/ai-elements/*`)、SessionSidebar 会话管理逻辑、后端契约、K8s 生命周期逻辑(只改前端如何呈现)。
- **术语规则(desktop chrome)**: "Agent"→"助手"、"选择 Agent"→"选择助手"、"按 Agent 筛选"→"按助手筛选"、"归属Agent:"→"所属助手:"、"执行Agent:"→"执行助手:"、"子Agent"→"子助手"、"工具:"→"将执行:"、"严重性:"→"重要性:"、"发现:"→"问题:"、"参数"(tool_params 折叠)→"详细内容"、"已超时，自动拒绝"→"超过时限，已自动拒绝"、"暂无推送消息"→"没有新消息"、"暂无待审批项"→"没有需要你审批的内容"。web 配置面保留 Agent 术语——本规则仅 desktop。
- **Signal Orange 出场点(One Signal Rule)**: 仅过渡屏进度环、Agent 选中勾、批准按钮(primary 变体)、思考指示点。空状态装饰不用橙。
- **错误绝不露原始堆栈**: `error.message`/HTTP body/堆栈只 `console.error`,不进 UI。
- **WCAG AA**: 状态不只靠颜色(配文字);`prefers-reduced-motion` 走 `MotionConfig reducedMotion="user"`(main.tsx 已全局接);网络条 `bg-warning/10 text-warning` 若对比不达 4.5:1 改实底(实现期复核)。
- **提交**: 每个任务结束 commit。Commit message 用中文或英文均可,feat/fix 前缀。仓库为 `workpaw-desktop`(main 分支),先建分支 `feat/non-technical-desktop`。
- **Cron payload 表单化不在本轮**(spec §3.3/§7,后续独立 spec)。
- **design spec**: `docs/superpowers/specs/2026-06-22-non-technical-desktop-design.md`(在仓库外 `/Users/zhangsan/workpaw/docs/`,不进 git)。

---

## File Structure

**新建:**
- `src/lib/approvalIntents.ts` — toolName → 人类语言意图映射(纯函数,TDD)
- `src/lib/errorToast.ts` — 集中化错误分类 + sonner toast(纯逻辑 `classifyError` + 副作用 `toastError`)
- `src/components/ContainerGate.tsx` — 容器自动拉起过渡屏(替换 ContainerStatusPage 渲染)
- `src/components/ConfirmAction.tsx` — 通用破坏性操作确认(基于 ConfirmPopover 提炼)
- `src/components/OfflineBanner.tsx` — 网络断开常驻提示条
- `src/components/Chat/WelcomeHint.tsx` — 空对话首提示(localStorage flag)
- `vitest.config.ts` — Vitest 配置
- `src/lib/__tests__/approvalIntents.test.ts`
- `src/lib/__tests__/errorToast.test.ts`
- `src/lib/__tests__/cronToText.test.ts`

**修改:**
- `package.json` — 加 vitest/testing-library 依赖 + test 脚本
- `src/App.tsx` — 容器闸门改渲染 ContainerGate + 自动 activate
- `src/stores/useInstanceStore.ts` — fetchInstance 后 not_found/stopped 自动 activate
- `src/components/Chat/AgentSelector.tsx` — 术语 + 兜底文案
- `src/components/Chat/ModelSelector.tsx` — 兜底说明
- `src/components/Chat/MessageList.tsx` — WelcomeScreen 改造(填入而非发送)+ WelcomeHint
- `src/components/Chat/ChatInput.tsx` — 占位符 + 移除内层 PromptInputProvider + 首次 focus 提示
- `src/pages/Chat.tsx` — 提升 PromptInputProvider 包裹 MessageList + ChatInput
- `src/pages/Inbox.tsx` — 术语 + 空状态副文 + 批量删除确认文案带数量
- `src/components/Inbox/ApprovalCard.tsx` — 术语 + 意图行 + 批准防双击 + 拒绝确认
- `src/components/Inbox/MessageDetailDialog.tsx` — 术语
- `src/hooks/useApprovals.ts` — 错误 toast 迁移 + 批准/拒绝交互
- `src/pages/CronJobs.tsx` + `src/components/Cron/*` — 术语 + cron 自然语言预览 + 空状态副文
- `src/pages/Files.tsx` + `src/components/Files/FileListPanel.tsx` + `FileItem.tsx` — 术语 + 空状态副文
- `src/layouts/MainLayout.tsx` — 挂 OfflineBanner
- `src/hooks/useCronJobs.ts`/`useWorkspace.ts`/`useTraceViewer.ts`/`pages/Files.tsx`/`components/Cron/CronTable.tsx`/`components/Files/FileEditor.tsx` — toast.error 迁移

---

## Task 1: 引入 Vitest 测试基础设施

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/__tests__/sanity.test.ts`

**Interfaces:**
- Produces: `pnpm test` 可运行;`vitest.config.ts` 用 jsdom 环境;后续任务的测试文件放在 `src/lib/__tests__/`。

- [ ] **Step 1: 建分支**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git checkout -b feat/non-technical-desktop
```

- [ ] **Step 2: 安装测试依赖**

```bash
pnpm add -D vitest@^3 @testing-library/react@^16 @testing-library/jest-dom@^6 jsdom@^25 @testing-library/user-event@^14
```

- [ ] **Step 3: 写 vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(__dirname, "./src") }],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

- [ ] **Step 4: 写 setup 文件**

创建 `src/test-setup.ts`:

```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: 加 package.json test 脚本**

在 `"scripts"` 中 `"build"` 后加:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 6: 写 sanity 测试**

创建 `src/lib/__tests__/sanity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: 运行测试验证**

```bash
pnpm test
```
Expected: 1 test passed。

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/test-setup.ts src/lib/__tests__/sanity.test.ts
git commit -m "chore: 引入 Vitest 测试基础设施"
```

---

## Task 2: approvalIntents 纯逻辑(TDD)

**Files:**
- Create: `src/lib/approvalIntents.ts`
- Test: `src/lib/__tests__/approvalIntents.test.ts`

**Interfaces:**
- Produces: `describeApprovalIntent(toolName: string): string` — 返回人类语言意图说明。后续 ApprovalCard 调用它渲染"为什么需要我批准"那一行。

- [ ] **Step 1: 写失败测试**

创建 `src/lib/__tests__/approvalIntents.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { describeApprovalIntent } from "../approvalIntents";

describe("describeApprovalIntent", () => {
  it("发消息类 toolName → 向外部发送消息", () => {
    expect(describeApprovalIntent("send_dingtalk_message")).toBe(
      "你的助手想向外部发送消息，需要你确认",
    );
    expect(describeApprovalIntent("send_feishu_message")).toBe(
      "你的助手想向外部发送消息，需要你确认",
    );
    expect(describeApprovalIntent("send_email")).toBe(
      "你的助手想向外部发送消息，需要你确认",
    );
  });

  it("文件删除类 → 删除文件", () => {
    expect(describeApprovalIntent("delete_file")).toBe(
      "你的助手想删除文件，需要你确认",
    );
    expect(describeApprovalIntent("remove_file")).toBe(
      "你的助手想删除文件，需要你确认",
    );
  });

  it("未知/空 → 执行一个操作兜底", () => {
    expect(describeApprovalIntent("some_unknown_tool")).toBe(
      "你的助手想执行一个操作，需要你确认",
    );
    expect(describeApprovalIntent("")).toBe(
      "你的助手想执行一个操作，需要你确认",
    );
  });

  it("大小写/下划线健壮", () => {
    expect(describeApprovalIntent("SEND_DingTalk_Message")).toBe(
      "你的助手想向外部发送消息，需要你确认",
    );
    expect(describeApprovalIntent("DeleteFile")).toBe(
      "你的助手想删除文件，需要你确认",
    );
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/approvalIntents.test.ts
```
Expected: FAIL — "Cannot find module '../approvalIntents'"。

- [ ] **Step 3: 写最小实现**

创建 `src/lib/approvalIntents.ts`:

```typescript
// approvalIntents — 把技术化 toolName 翻译成非技术员工能懂的"为什么需要我批准"。
// 兜底文案"执行一个操作"已足够安全（不误导），新工具落到兜底不会出错。

const SEND_KEYWORDS = ["send", "message", "email", "notify", "dingtalk", "feishu", "wechat", "slack"];
const DELETE_KEYWORDS = ["delete", "remove", "drop", "purge"];

function matches(keywords: string[], normalized: string): boolean {
  return keywords.some((k) => normalized.includes(k));
}

export function describeApprovalIntent(toolName: string): string {
  const normalized = (toolName || "").toLowerCase();

  if (matches(SEND_KEYWORDS, normalized)) {
    return "你的助手想向外部发送消息，需要你确认";
  }
  if (matches(DELETE_KEYWORDS, normalized)) {
    return "你的助手想删除文件，需要你确认";
  }
  return "你的助手想执行一个操作，需要你确认";
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test src/lib/__tests__/approvalIntents.test.ts
```
Expected: 4 tests passed。

- [ ] **Step 5: Commit**

```bash
git add src/lib/approvalIntents.ts src/lib/__tests__/approvalIntents.test.ts
git commit -m "feat: approvalIntents — toolName 转人类语言意图"
```

---

## Task 3: errorToast 集中化错误翻译(TDD)

**Files:**
- Create: `src/lib/errorToast.ts`
- Test: `src/lib/__tests__/errorToast.test.ts`

**Interfaces:**
- Produces:
  - `classifyError(err: unknown): { message: string; kind: ErrorKind }` — 纯分类,可测。
  - `toastError(err: unknown): void` — 调 classifyError 后 sonner toast.error(message);401 时额外触发 `useAuthStore.getState().logout()`。
  - `ErrorKind = "network" | "unauthorized" | "forbidden" | "server" | "not_ready" | "unknown"`

- [ ] **Step 1: 写失败测试**

创建 `src/lib/__tests__/errorToast.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyError } from "../errorToast";

// 构造一个带 status 的 error（模拟 fetch Response.ok=false 抛的 Error）
function httpError(status: number, body?: string): Error {
  const e = new Error(body ? `HTTP ${status}` : `HTTP ${status}`);
  (e as any).status = status;
  return e;
}

describe("classifyError", () => {
  it("网络断开/超时 → network", () => {
    expect(classifyError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(classifyError(new TypeError("NetworkError")).kind).toBe("network");
  });

  it("401 → unauthorized", () => {
    expect(classifyError(httpError(401)).kind).toBe("unauthorized");
  });

  it("403 → forbidden", () => {
    expect(classifyError(httpError(403)).kind).toBe("forbidden");
  });

  it("503 → not_ready", () => {
    expect(classifyError(httpError(503)).kind).toBe("not_ready");
  });

  it("其他 5xx → server", () => {
    expect(classifyError(httpError(500)).kind).toBe("server");
    expect(classifyError(httpError(502)).kind).toBe("server");
  });

  it("其他 4xx → unknown", () => {
    expect(classifyError(httpError(404)).kind).toBe("unknown");
  });

  it("未知 → unknown", () => {
    expect(classifyError(new Error("啥也不是")).kind).toBe("unknown");
    expect(classifyError(null).kind).toBe("unknown");
  });

  it("message 是人类语言", () => {
    expect(classifyError(httpError(401)).message).toBe("登录已过期，请重新登录");
    expect(classifyError(new TypeError("Failed to fetch")).message).toBe(
      "网络好像断了，请检查后重试",
    );
    expect(classifyError(httpError(503)).message).toBe("AI 助手还没准备好，请稍候");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/errorToast.test.ts
```
Expected: FAIL — module not found。

- [ ] **Step 3: 写最小实现**

创建 `src/lib/errorToast.ts`:

```typescript
import { toast } from "sonner";
import { useAuthStore } from "@/stores/useAuthStore";

export type ErrorKind =
  | "network"
  | "unauthorized"
  | "forbidden"
  | "server"
  | "not_ready"
  | "unknown";

interface ClassifiedError {
  message: string;
  kind: ErrorKind;
}

const MESSAGES: Record<ErrorKind, string> = {
  network: "网络好像断了，请检查后重试",
  unauthorized: "登录已过期，请重新登录",
  forbidden: "你没有权限做这个操作",
  server: "服务暂时不可用，请稍后重试",
  not_ready: "AI 助手还没准备好，请稍候",
  unknown: "出了一点问题，请重试；如反复出现请联系管理员",
};

function getStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status: unknown }).status;
    return typeof s === "number" ? s : undefined;
  }
  // 从 message 里抠 "HTTP 401"
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/HTTP\s+(\d{3})/);
  return m ? Number(m[1]) : undefined;
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    return /fetch|network/i.test(err.message);
  }
  return false;
}

export function classifyError(err: unknown): ClassifiedError {
  if (isNetworkError(err)) return { message: MESSAGES.network, kind: "network" };

  const status = getStatus(err);
  if (status === 401) return { message: MESSAGES.unauthorized, kind: "unauthorized" };
  if (status === 403) return { message: MESSAGES.forbidden, kind: "forbidden" };
  if (status === 503) return { message: MESSAGES.not_ready, kind: "not_ready" };
  if (status && status >= 500) return { message: MESSAGES.server, kind: "server" };

  return { message: MESSAGES.unknown, kind: "unknown" };
}

export function toastError(err: unknown): void {
  const { message, kind } = classifyError(err);
  console.error("[errorToast]", err);
  toast.error(message);
  if (kind === "unauthorized") {
    useAuthStore.getState().logout();
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test src/lib/__tests__/errorToast.test.ts
```
Expected: 9 tests passed。

- [ ] **Step 5: Commit**

```bash
git add src/lib/errorToast.ts src/lib/__tests__/errorToast.test.ts
git commit -m "feat: errorToast 集中化错误翻译层"
```

---

## Task 4: cronToText 现有逻辑加测试(回归保护)

**Files:**
- Test: `src/lib/__tests__/cronToText.test.ts`
- 不新建实现——复用 `src/lib/cronUtils.ts:199` 的 `cronToText`。

**Interfaces:**
- Consumes: `cronToText(cron: string): string`（已存在）
- Produces: 回归测试,确保后续 cron 自然语言预览(Task 12)依赖的解析稳定。

- [ ] **Step 1: 写测试**

创建 `src/lib/__tests__/cronToText.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { cronToText } from "../cronUtils";

describe("cronToText", () => {
  it("每小时", () => {
    expect(cronToText("0 * * * *")).toBe("每小时");
  });

  it("每天 09:00", () => {
    expect(cronToText("0 9 * * *")).toBe("每天 09:00");
  });

  it("每周 周一 09:00", () => {
    expect(cronToText("0 9 * * 1")).toBe("每周 周一 09:00");
  });

  it("custom 原样返回", () => {
    expect(cronToText("*/7 * * * *")).toBe("*/7 * * * *");
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm test src/lib/__tests__/cronToText.test.ts
```
Expected: PASS(4 tests)。若某个断言不符实际输出,以实际输出为准修正测试断言(这是锁定现状,不是改实现)。

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/cronToText.test.ts
git commit -m "test: cronToText 回归测试"
```

---

## Task 5: ConfirmAction 通用确认组件

**Files:**
- Create: `src/components/ConfirmAction.tsx`

**Interfaces:**
- Produces: `<ConfirmAction trigger confirmText cancelText description onConfirm okVariant>` — 基于现有 `ConfirmPopover` 的确认交互,但用更明确的文案接口。后续破坏性操作(Task 15)统一用它。
- Consumes: `ConfirmPopover`(已存在 `src/components/Inbox/ConfirmPopover.tsx`)、`Button`。

- [ ] **Step 1: 写组件**

创建 `src/components/ConfirmAction.tsx`:

```typescript
// ConfirmAction — 通用破坏性操作确认。
// 包装 ConfirmPopover：把"动词+对象+后果"的文案接口固定下来，
// 让所有删除/拒绝/取消走同一确认模式（spec §4.2）。

import { type ReactNode } from "react";
import { ConfirmPopover } from "@/components/Inbox/ConfirmPopover";

interface ConfirmActionProps {
  /** 触发按钮（通常是 destructive 变体 Button） */
  children: ReactNode;
  /** 确认文案，应含动词+对象+后果，如"删除这份文件？助手将不再记住它的内容" */
  description: string;
  /** 确认按钮文字，如"删除"/"拒绝"，不用通用"确认" */
  confirmText: string;
  cancelText?: string;
  onConfirm: () => void;
  disabled?: boolean;
  okVariant?: "default" | "destructive";
}

export function ConfirmAction({
  children,
  description,
  confirmText,
  cancelText = "取消",
  onConfirm,
  disabled,
  okVariant = "destructive",
}: ConfirmActionProps) {
  return (
    <ConfirmPopover
      title={description}
      okText={confirmText}
      cancelText={cancelText}
      onConfirm={onConfirm}
      disabled={disabled}
      okVariant={okVariant}
    >
      {children}
    </ConfirmPopover>
  );
}
```

- [ ] **Step 2: 类型检查**

```bash
pnpm build
```
Expected: 构建通过(无类型错误)。

- [ ] **Step 3: Commit**

```bash
git add src/components/ConfirmAction.tsx
git commit -m "feat: ConfirmAction 通用破坏性操作确认组件"
```

---

## Task 6: 容器闸门自动拉起 + ContainerGate 过渡屏

**Files:**
- Create: `src/components/ContainerGate.tsx`
- Modify: `src/stores/useInstanceStore.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `<ContainerGate />` — 过渡屏组件,内部用 `useInstanceStore`,渲染人文进度文案 + 前端计时器。不接 props。
- Consumes: `useInstanceStore`(`instance`/`loading`/`error`/`activate`/`fetchInstance`)。

- [ ] **Step 1: 改 useInstanceStore — not_found/stopped 自动 activate**

在 `src/stores/useInstanceStore.ts` 的 `fetchInstance` 成功分支后加自动激活逻辑。把 `fetchInstance` 改为:

```typescript
  fetchInstance: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${getControlPlaneUrl()}/api/instance`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const instance = await res.json();
      set({ instance, loading: false });
      // 自动拉起：非 running 态静默激活，员工不点按钮（spec §1）
      if (instance.status === "not_found" || instance.status === "stopped") {
        get().activate();
      }
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },
```

- [ ] **Step 2: 写 ContainerGate 组件**

创建 `src/components/ContainerGate.tsx`:

```typescript
// ContainerGate — 容器启动过渡屏。
// 员工视角只有"在准备"和"好了"两态。无标题，居中：主文 + 副文 + Signal Orange 进度环。
// 前端文案计时器（不依赖后端）：>60s 副文递进，>180s 出现"稍后再试"。
// 不做跳过按钮——跳过只落到没准备好的 chat 页，更糟（spec §1）。

import { useEffect, useState } from "react";
import { useInstanceStore } from "@/stores/useInstanceStore";
import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/errorToast";

export function ContainerGate() {
  const instance = useInstanceStore((s) => s.instance);
  const error = useInstanceStore((s) => s.error);
  const fetchInstance = useInstanceStore((s) => s.fetchInstance);

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const isFirstTime = !instance || instance.status === "not_found";
  const mainText = isFirstTime
    ? "正在为你准备 AI 助手"
    : "正在唤醒你的 AI 助手";
  const subText = isFirstTime ? "首次准备约需 1 分钟" : "约需 30 秒";

  let footer: string = subText;
  let showRetry = false;
  if (elapsed > 180) {
    footer = "准备时间过长，你可以稍后再试，或联系管理员";
    showRetry = true;
  } else if (elapsed > 60) {
    footer = "比你预期久了一点，还在努力，请稍候";
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="text-base font-medium text-foreground">{mainText}</p>
        <p className="text-sm text-muted-foreground">{footer}</p>
      </div>
      {error && (
        <p className="text-sm text-destructive">
          {toastError(error) ?? "准备失败，请稍后重试"}
        </p>
      )}
      {showRetry && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setElapsed(0);
            fetchInstance();
          }}
        >
          稍后再试
        </Button>
      )}
    </div>
  );
}
```

注意:`toastError(error)` 返回 void,用在 JSX 里会渲染 undefined——这行有 bug。修正:把 error 显示改为纯文本兜底,toast 副作用单独调。

修正 `ContainerGate.tsx` 的 error 块为:

```typescript
      {error && (
        <>
          {(() => {
            toastError(error);
            return null;
          })()}
          <p className="text-sm text-destructive">准备失败，请稍后重试</p>
        </>
      )}
```

但这样每次 render 都 toast——不好。改用 useEffect:

把组件顶部的 effects 区改为(在 elapsed effect 后加):

```typescript
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    if (error) {
      toastError(error);
      setErrored(true);
    }
  }, [error]);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="text-base font-medium text-foreground">{mainText}</p>
        <p className="text-sm text-muted-foreground">{footer}</p>
      </div>
      {errored && (
        <p className="text-sm text-destructive">准备失败，请稍后重试</p>
      )}
      {showRetry && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setElapsed(0);
            setErrored(false);
            fetchInstance();
          }}
        >
          稍后再试
        </Button>
      )}
    </div>
  );
```

(以这个修正版为最终内容,删掉前面有 bug 的 error 块。)

- [ ] **Step 3: 改 App.tsx — 用 ContainerGate 替换 ContainerStatusPage 渲染**

在 `src/App.tsx`,把:

```typescript
  if (!instance || instance.status !== "running") {
    return <ContainerStatusPage />;
  }
```

改为:

```typescript
  if (!instance || instance.status !== "running") {
    return <ContainerGate />;
  }
```

并把 `ContainerStatusPage` 的 import 改为 `ContainerGate`(若 import 在文件顶部,把 `import { ContainerStatusPage } from "./pages/ContainerStatus";` 换成 `import { ContainerGate } from "./components/ContainerGate";`)。

- [ ] **Step 4: 构建验证**

```bash
pnpm build
```
Expected: 构建通过。

- [ ] **Step 5: 手动验收(dev 模式无法验容器态,跳过运行,仅类型+构建)**

容器态需 Control Plane 真实环境,dev 不可达。本任务以构建通过为准,运行验收留到 Task 17。

- [ ] **Step 6: Commit**

```bash
git add src/components/ContainerGate.tsx src/stores/useInstanceStore.ts src/App.tsx
git commit -m "feat: 容器闸门自动拉起 + 人文过渡屏"
```

---

## Task 7: AgentSelector + ModelSelector 术语与兜底文案

**Files:**
- Modify: `src/components/Chat/AgentSelector.tsx`
- Modify: `src/components/Chat/ModelSelector.tsx`

**Interfaces:**
- Consumes: 无新接口。改文案与兜底。

- [ ] **Step 1: AgentSelector 术语 + 兜底**

在 `src/components/Chat/AgentSelector.tsx`:

1. 把 `selectedName` 的两处兜底 `"选择 Agent"` 改为 `"选择助手"`:
```typescript
    if (!selectedAgentId) return "选择助手";
    const agent = agents.find((a) => a.id === selectedAgentId);
    return agent?.name || agent?.id || "选择助手";
```

2. `DropdownMenuLabel` 的 `"当前工作区"` 保留(非术语)。

3. description 空兜底:把渲染 description 的块:
```tsx
              {agent.description && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {agent.description}
                </p>
              )}
```
改为:
```tsx
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {agent.description || "通用对话助手"}
              </p>
```

- [ ] **Step 2: ModelSelector 兜底说明**

在 `src/components/Chat/ModelSelector.tsx`,定位 PRO/FREE tab 内容区(providers 渲染处)。在 `proProviders` 分组渲染前加兜底说明,`freeProviders` 分组前加兜底说明。

先读文件确认 providers 渲染结构:
```bash
sed -n '60,140p' src/components/Chat/ModelSelector.tsx
```

在 PRO 分组容器(渲染 `proProviders` 的 map 外层)顶部插入:
```tsx
<p className="px-2 py-1 text-xs text-muted-foreground">PRO：能力更强，适合复杂任务</p>
```
在 FREE 分组容器顶部插入:
```tsx
<p className="px-2 py-1 text-xs text-muted-foreground">FREE：无需配置，随时可用</p>
```

(具体插入行号以 Step 2 读取结果为准,插在每个分组标题/列表的最上方。若分组结构是 `proProviders.map(...)` 外无包裹标题,则在 map 前加一个 `<p>`。)

- [ ] **Step 3: 构建验证**

```bash
pnpm build
```
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/AgentSelector.tsx src/components/Chat/ModelSelector.tsx
git commit -m "feat: Agent/模型选择器术语去技术化 + 兜底说明"
```

---

## Task 8: WelcomeScreen 改造(填入而非发送)+ 首提示

**Files:**
- Modify: `src/components/Chat/MessageList.tsx`(WelcomeScreen)
- Create: `src/components/Chat/WelcomeHint.tsx`
- Modify: `src/pages/Chat.tsx`(提升 PromptInputProvider)
- Modify: `src/components/Chat/ChatInput.tsx`(移除内层 PromptInputProvider)

**Interfaces:**
- Consumes: `usePromptInputController`(`@/components/ai-elements/prompt-input`,已存在),`useChatStore`。
- Produces: WelcomeScreen 示例点击填入输入框(不发送);WelcomeHint 首次显示后 localStorage flag 不再显示。

- [ ] **Step 1: 提升 PromptInputProvider 到 ChatPage**

在 `src/pages/Chat.tsx`,import:
```typescript
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
```

把 return 的最外层 `<div className="flex h-full w-full">` 内部用 `<PromptInputProvider>` 包裹(包住 SessionSidebar 之外的右侧对话区,或包住整个 return 内容)。最简单:包住整个 children:

```tsx
  return (
    <PromptInputProvider>
      <div className="flex h-full w-full">
        <SessionSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header>...</header>
          <MessageList />
          <ChatInput />
        </div>
      </div>
    </PromptInputProvider>
  );
```

- [ ] **Step 2: ChatInput 移除内层 PromptInputProvider**

在 `src/components/Chat/ChatInput.tsx`,把 `<PromptInputProvider>` 和其闭合 `</PromptInputProvider>` 删除(现在由 ChatPage 提供)。保留内部 `SlashSuggestionBar`/`PromptInput`/`CharCounter`。即把:
```tsx
        <PromptInputProvider>
          <SlashSuggestionBar />
          <div>
            <PromptInput ...>
              ...
            </PromptInput>
          </div>
        </PromptInputProvider>
```
改为(去掉 Provider 包裹):
```tsx
        <SlashSuggestionBar />
        <div>
          <PromptInput ...>
            ...
          </PromptInput>
        </div>
```
移除文件顶部的 `PromptInputProvider` import(若不再用)。

- [ ] **Step 3: 写 WelcomeHint 组件**

创建 `src/components/Chat/WelcomeHint.tsx`:

```typescript
// WelcomeHint — 容器首次就绪后，首次进入空对话显示一次的轻提示。
// localStorage flag 标记已看过，非阻塞、不弹窗（spec §2.4）。

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const STORAGE_KEY = "workpaw.chat.welcomeHintSeen";

export function WelcomeHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setShow(true);
      const t = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, "1");
      }, 3000);
      return () => clearTimeout(t);
    }
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="text-xs text-muted-foreground"
        >
          这是你的 AI 助手，直接打字提问就行
        </motion.p>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: 改造 WelcomeScreen — 填入而非发送 + 接 WelcomeHint**

在 `src/components/Chat/MessageList.tsx`,import 顶部加:
```typescript
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { WelcomeHint } from "@/components/Chat/WelcomeHint";
```

把 `WelcomeScreen` 函数整体替换为:

```tsx
function WelcomeScreen() {
  const controller = usePromptInputController();

  const examples = [
    "总结这份文档",
    "帮我起草一封邮件",
    "解释这个表格的数据",
  ];

  const fillExample = (prompt: string) => {
    controller.textInput.setInput(prompt);
  };

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Bot className="size-8" />
      </div>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold">你好，我是你的 AI 助手</h2>
        <p className="text-sm text-muted-foreground">
          直接在下方输入问题就行
        </p>
        <WelcomeHint />
      </div>

      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {examples.map((prompt) => (
          <button
            key={prompt}
            onClick={() => fillExample(prompt)}
            className="rounded-full border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
```

关键变化:头像从 `bg-primary text-primary-foreground` 改为 `bg-muted text-muted-foreground`(空状态装饰不抢橙);问候语改为"你好，我是你的 AI 助手";示例点击调 `controller.textInput.setInput(prompt)` 填入而非 `sendMessage`。

- [ ] **Step 5: 构建验证**

```bash
pnpm build
```
Expected: 通过。若 `usePromptInputController` 在 WelcomeScreen 里报"必须在 Provider 内"——确认 Task 8 Step 1 的 Provider 提升已生效(WelcomeScreen 经 MessageList 在 ChatPage 的 Provider 内)。

- [ ] **Step 6: 手动验收(dev)**

```bash
pnpm dev
```
- 打开 chat 空对话:看到欢迎语 + 首提示 + 3 示例,头像为 muted 灰(非橙)
- 点示例:文字进入输入框,不发送
- 刷新:首提示不再出现(localStorage flag)

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/MessageList.tsx src/components/Chat/WelcomeHint.tsx src/pages/Chat.tsx src/components/Chat/ChatInput.tsx
git commit -m "feat: 空对话首屏示例填入 + 首提示 + 头像去橙"
```

---

## Task 9: ChatInput 占位符 + 首次 focus 快捷键提示

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx`

**Interfaces:**
- Consumes: `usePromptInputController`(已用)。

- [ ] **Step 1: 改占位符**

在 `src/components/Chat/ChatInput.tsx`,把:
```tsx
                  placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
```
改为:
```tsx
                  placeholder="输入你的问题..."
```

- [ ] **Step 2: 加首次 focus 快捷键提示**

在 `ChatInput` 主组件内,加一个 focus 提示状态。在 `return` 的 `<div className="border-t bg-background px-4 pt-3 pb-2">` 内、`<div className="mx-auto max-w-3xl">` 内顶部(SlashSuggestionBar 之前)插入 `<ShortcutHint />`。

在文件底部(CharCounter 之后)加组件:

```tsx
// ---------------------------------------------------------------------------
// ShortcutHint — 首次 focus 输入框时淡入淡出的快捷键提示（localStorage 一次性）
// ---------------------------------------------------------------------------

const SHORTCUT_HINT_KEY = "workpaw.chat.shortcutHintSeen";

function ShortcutHint() {
  const controller = usePromptInputController();
  const [show, setShow] = useState(false);

  // 输入框有内容时不显示
  const hasText = controller.textInput.value.length > 0;

  useEffect(() => {
    if (hasText) {
      setShow(false);
      return;
    }
    const seen = localStorage.getItem(SHORTCUT_HINT_KEY);
    if (seen) return;
    const t = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(t);
  }, [hasText]);

  useEffect(() => {
    if (show) {
      const t = setTimeout(() => {
        setShow(false);
        localStorage.setItem(SHORTCUT_HINT_KEY, "1");
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [show]);

  if (!show) return null;

  return (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="mb-1.5 text-center text-[11px] text-muted-foreground"
    >
      Enter 发送，Shift+Enter 换行
    </motion.p>
  );
}
```

确保 `motion` 已 import(文件顶部已有 `motion`?若无需加 `import { motion } from "motion/react";`)。

在主组件 return 中插入:
```tsx
        <PromptInputProvider>  ← (Task 8 已移除此行，按实际为准)
```
实际插入位置:`<div className="mx-auto max-w-3xl">` 内最顶部:
```tsx
      <div className="mx-auto max-w-3xl">
        <ShortcutHint />
        <SlashSuggestionBar />
        ...
```

- [ ] **Step 3: 构建验证**

```bash
pnpm build
```
Expected: 通过。

- [ ] **Step 4: 手动验收**

```bash
pnpm dev
```
- 空输入框 focus:400ms 后出现"Enter 发送，Shift+Enter 换行",3s 淡出
- 刷新:不再出现

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ChatInput.tsx
git commit -m "feat: 输入框占位符简化 + 首次 focus 快捷键提示"
```

---

## Task 10: Inbox 术语 + 空状态副文 + 批量删除确认带数量

**Files:**
- Modify: `src/pages/Inbox.tsx`

**Interfaces:**
- Consumes: `Empty`/`EmptyTitle`/`EmptyContent`(已 import)。

- [ ] **Step 1: 术语替换**

在 `src/pages/Inbox.tsx`:

1. Select placeholder:`placeholder="按 Agent 筛选"` → `placeholder="按助手筛选"`
2. 空状态标题:`<EmptyTitle>暂无推送消息</EmptyTitle>` → `<EmptyTitle>没有新消息</EmptyTitle>`
3. `<EmptyTitle>暂无待审批项</EmptyTitle>` → `<EmptyTitle>没有需要你审批的内容</EmptyTitle>`

- [ ] **Step 2: 空状态加功能说明副文**

把推送消息空状态:
```tsx
              <Empty className="h-[calc(100vh-220px)]">
                <EmptyContent>
                  <EmptyMedia variant="icon">
                    <InboxIcon className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle>没有新消息</EmptyTitle>
                </EmptyContent>
              </Empty>
```
加副文:
```tsx
              <Empty className="h-[calc(100vh-220px)]">
                <EmptyContent>
                  <EmptyMedia variant="icon">
                    <InboxIcon className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle>没有新消息</EmptyTitle>
                  <p className="text-xs text-muted-foreground">
                    助手通过钉钉、飞书等渠道收到的消息会显示在这里
                  </p>
                </EmptyContent>
              </Empty>
```

审批空状态同理,`<EmptyTitle>没有需要你审批的内容</EmptyTitle>` 后加:
```tsx
                  <p className="text-xs text-muted-foreground">
                    助手想做重要操作时，会在这里等你确认
                  </p>
```

- [ ] **Step 3: 批量删除确认文案带数量**

定位批量删除的 `ConfirmPopover`/确认调用(在 Inbox.tsx 内 grep `ConfirmPopover` 或批量删除逻辑)。读取上下文:
```bash
grep -n "ConfirmPopover\|批量\|删除选中\|selectedIds\|selected.size\|selected.length" src/pages/Inbox.tsx | head
```

把批量删除的确认文案从固定串改为带数量,如:
```tsx
title={`删除选中的 ${selectedCount} 条消息？删除后无法恢复`}
```
(`selectedCount` 用 Inbox 内已有的选中计数变量,以 grep 结果为准。)

- [ ] **Step 4: 构建验证**

```bash
pnpm build
```
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/pages/Inbox.tsx
git commit -m "feat: Inbox 术语去技术化 + 空状态说明 + 批量删除带数量"
```

---

## Task 11: ApprovalCard 术语 + 意图行 + 批准防双击 + 拒绝确认

**Files:**
- Modify: `src/components/Inbox/ApprovalCard.tsx`

**Interfaces:**
- Consumes: `describeApprovalIntent`(`@/lib/approvalIntents`,Task 2)、`ConfirmAction`(`@/components/ConfirmAction`,Task 5)。

- [ ] **Step 1: import 新依赖**

在 `src/components/Inbox/ApprovalCard.tsx` 顶部加:
```typescript
import { describeApprovalIntent } from "@/lib/approvalIntents";
import { ConfirmAction } from "@/components/ConfirmAction";
```

- [ ] **Step 2: 加意图行**

在卡片头部"安全审批"标题块(`<span className="text-sm font-semibold">安全审批</span>`)所在 div 之后、`</div>`(header 闭合)之前,或 header div 内底部,加意图行。定位 header 结构:
```bash
sed -n '188,202p' src/components/Inbox/ApprovalCard.tsx
```

在"安全审批" span 后加:
```tsx
          <span className="text-sm font-semibold">安全审批</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {describeApprovalIntent(toolName)}
        </p>
```
(放在 header div 内、Shield+标题 div 之后。若 header 是 flex justify-between,意图行可能需放 header 下方独立一行——以实际结构为准,确保不破坏倒计时显示。)

- [ ] **Step 3: 术语替换**

全文替换(用编辑器 replace_all):
- `归属Agent:` → `所属助手:`
- `执行Agent:` → `执行助手:`
- `子Agent` → `子助手`
- `工具:` → `将执行:`
- `严重性:` → `重要性:`
- `发现:` → `问题:`
- `参数`(tool_params 折叠 summary 文字,即 `<summary>...>参数</summary>` 那处)→ `详细内容`
- `已超时，自动拒绝` → `超过时限，已自动拒绝`

注意:`参数` 替换只针对那处 summary 文案,不要误伤变量名(变量名是英文 `toolParams`,不受影响)。

- [ ] **Step 4: 批准按钮防双击**

批准按钮(Approve,`handleApprove` 那个 `<Button>`)加 loading 态。在组件顶部 state 区加:
```typescript
const [approving, setApproving] = useState(false);
```

把 `handleApprove` 包一层(或在 onClick 内)。读取现有 handleApprove:
```bash
grep -n "handleApprove\|handleDeny\|handleAcknowledge" src/components/Inbox/ApprovalCard.tsx | head
```

把批准按钮:
```tsx
            <Button
              onClick={handleApprove}
              disabled={loading !== null}
            >
              <Check className="size-3.5" />
              批准
            </Button>
```
改为:
```tsx
            <Button
              onClick={async () => {
                setApproving(true);
                try {
                  await handleApprove();
                } finally {
                  setApproving(false);
                }
              }}
              disabled={loading !== null || approving}
            >
              <Check className="size-3.5" />
              {approving ? "已批准..." : "批准"}
            </Button>
```

- [ ] **Step 5: 拒绝按钮包确认**

把拒绝按钮:
```tsx
            <Button
              variant="destructive"
              onClick={handleDeny}
              disabled={loading !== null}
            >
              <X className="size-3.5" />
              拒绝
            </Button>
```
改为用 ConfirmAction 包裹:
```tsx
            <ConfirmAction
              description="拒绝这个审批？助手将不会执行该操作"
              confirmText="拒绝"
              onConfirm={handleDeny}
              disabled={loading !== null}
            >
              <Button
                variant="destructive"
                disabled={loading !== null}
              >
                <X className="size-3.5" />
                拒绝
              </Button>
            </ConfirmAction>
```

- [ ] **Step 6: 构建验证**

```bash
pnpm build
```
Expected: 通过。

- [ ] **Step 7: Commit**

```bash
git add src/components/Inbox/ApprovalCard.tsx
git commit -m "feat: ApprovalCard 术语 + 意图行 + 批准防双击 + 拒绝确认"
```

---

## Task 12: Cron 术语 + 自然语言预览 + 空状态副文

**Files:**
- Modify: `src/components/Cron/JobDrawer.tsx`
- Modify: `src/pages/CronJobs.tsx`(若有空状态)
- Modify: `src/components/Cron/CronTable.tsx`(若需术语)

**Interfaces:**
- Consumes: `cronToText`(`@/lib/cronUtils`,已存在)。

- [ ] **Step 1: JobDrawer 加 cron 预览**

在 `src/components/Cron/JobDrawer.tsx`,定位 cron 表达式输入框(`cronCustom` 输入处)。读取:
```bash
grep -n "cronCustom\|cronType\|表达式\|serializeCron" src/components/Cron/JobDrawer.tsx | head
```

在 cron 输入框下方加预览。在表单状态区,计算当前 cron 串并预览。在 cron 输入框 JSX 下方插入:
```tsx
<p className="mt-1 text-xs text-muted-foreground">
  {(() => {
    const cron = cronType === "custom" ? cronCustom : serializeCron({
      type: cronType,
      hour: parseInt(cronTime.split(":")[0] || "9", 10),
      minute: parseInt(cronTime.split(":")[1] || "0", 10),
      daysOfWeek: cronDaysOfWeek,
    });
    const text = cronToText(cron);
    return text === cron ? "将按自定义时间执行" : `将${text}执行`;
  })()}
</p>
```
确保 `cronToText`/`serializeCron` 已 import(文件顶部已有 `parseCron, serializeCron, cronToText` 等 import,确认 `cronToText` 在内,若无则加)。`CronParts`/`CronType` 类型按文件现有 import。

- [ ] **Step 2: 术语替换**

JobDrawer 内:`{"role":"user",...}` JSON 模板那处的提示文案(JobDrawer:690 附近)"格式：[...]"→保留(这是给进阶用户的 payload 格式提示,本轮不表单化)。检查是否有"任务""执行"等技术腔——这些是日常词,保留。

CronTable 内无额外术语需改(`已启用`/`已禁用` 已是日常词)。

- [ ] **Step 3: 空状态副文**

CronJobs 列表空状态(CronTable 内的 Empty)。读取:
```bash
grep -n "Empty\|空\|暂无\|没有\|创建任务" src/components/Cron/CronTable.tsx | head
```
若 CronTable 有 EmptyTitle(如"暂无定时任务"),在其下加副文:
```tsx
<p className="text-xs text-muted-foreground">
  设置后，助手会按时间自动执行任务
</p>
```
若 CronTable 无 Empty 组件(列表空时是空白),则在 `jobs.length === 0` 分支加一个简单空状态文本。以 grep 结果为准。

- [ ] **Step 4: 构建验证**

```bash
pnpm build
```
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/Cron/JobDrawer.tsx src/components/Cron/CronTable.tsx src/pages/CronJobs.tsx
git commit -m "feat: Cron 自然语言预览 + 空状态说明"
```

---

## Task 13: Files 术语 + 空状态副文

**Files:**
- Modify: `src/components/Files/FileListPanel.tsx`
- Modify: `src/components/Files/FileItem.tsx`
- Modify: `src/pages/Files.tsx`(若需)

**Interfaces:**
- 无新接口。

- [ ] **Step 1: FileItem tooltip 术语**

在 `src/components/Files/FileItem.tsx`,把:
```tsx
              <TooltipContent>启用/禁用此文件加载到系统提示词</TooltipContent>
```
改为:
```tsx
              <TooltipContent>启用后，助手会记住这份文件的内容</TooltipContent>
```

- [ ] **Step 2: FileListPanel 空状态副文**

在 `src/components/Files/FileListPanel.tsx`,把空状态:
```tsx
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              没有文件
            </div>
```
改为:
```tsx
            <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
              <span className="text-sm text-muted-foreground">还没有文件</span>
              <span className="text-xs text-muted-foreground">
                把文件拖进来或点击上传
              </span>
            </div>
```

- [ ] **Step 3: 构建验证**

```bash
pnpm build
```
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/components/Files/FileListPanel.tsx src/components/Files/FileItem.tsx
git commit -m "feat: Files tooltip 去术语 + 空状态说明"
```

---

## Task 14: toast.error 迁移到 errorToast

**Files:**
- Modify: `src/hooks/useCronJobs.ts`
- Modify: `src/hooks/useWorkspace.ts`
- Modify: `src/hooks/useApprovals.ts`
- Modify: `src/hooks/useTraceViewer.ts`
- Modify: `src/pages/Files.tsx`
- Modify: `src/pages/Inbox.tsx`
- Modify: `src/components/Cron/CronTable.tsx`
- Modify: `src/components/Files/FileEditor.tsx`

**Interfaces:**
- Consumes: `toastError`(`@/lib/errorToast`,Task 3)。
- Produces: 所有 catch 块的 `toast.error("...")` 改为 `toastError(err)`。

- [ ] **Step 1: 逐文件迁移**

对每个文件,在每个 `catch (err)` / `catch (error)` 块内:
- 移除 `toast.error("固定中文")` 
- 改为 `toastError(err)`(或 `toastError(error)`,以 catch 变量名为准)
- 保留 `console.error`(若已有);errorToast 内部已 console.error,可移除重复

例:`src/hooks/useCronJobs.ts`:
```typescript
// 前
} catch (error) {
  toast.error("加载定时任务失败");
}
// 后
} catch (error) {
  toastError(error);
}
```

对 `catch {`(无变量)的块,改为 `catch (error) { toastError(error); }`。

`src/pages/Files.tsx` 的 `toast.error("仅支持上传 .zip 文件")` 是**业务校验提示**(非异常),**保留不动**——它不是错误翻译,是前置校验。同理 `toast.success(...)` 全部保留。

`src/hooks/useApprovals.ts` 的 `toast.success("已批准工具调用")` 保留;`toast.error("批准失败")` → `toastError(error)`。

每个文件顶部把 `import { toast } from "sonner";` 中,若仍有 `toast.success`/`toast.info` 用到则保留 `toast` import 并加 `import { toastError } from "@/lib/errorToast";`;若该文件 toast.error 是唯一 toast 用途,则把 `import { toast } from "sonner";` 换成 `import { toastError } from "@/lib/errorToast";`。

- [ ] **Step 2: 全量构建 + 测试**

```bash
pnpm build && pnpm test
```
Expected: 构建通过,测试通过。

- [ ] **Step 3: grep 确认无残留**

```bash
grep -rn "toast.error" src --include="*.tsx" --include="*.ts"
```
Expected: 仅剩业务校验提示(如 Files.tsx 的 .zip 校验),无笼统"失败"toast。

- [ ] **Step 4: Commit**

```bash
git add src/hooks/ src/pages/Files.tsx src/pages/Inbox.tsx src/components/Cron/CronTable.tsx src/components/Files/FileEditor.tsx
git commit -m "refactor: toast.error 统一迁移到 errorToast"
```

---

## Task 15: 破坏性操作确认接入(Cron 删除/Files 删除/取消任务)

**Files:**
- Modify: `src/components/Cron/CronTable.tsx`(删除任务)
- Modify: `src/pages/Files.tsx`(若有删除文件)
- Modify: `src/components/Inbox/ApprovalCard.tsx`(取消任务——已部分在 Task 11)

**Interfaces:**
- Consumes: `ConfirmAction`(Task 5)。

- [ ] **Step 1: CronTable 删除任务确认**

读取 CronTable 删除按钮:
```bash
grep -n "删除\|delete\|Delete\|onDelete\|handleDelete" src/components/Cron/CronTable.tsx | head
```

把删除按钮用 `ConfirmAction` 包裹:
```tsx
<ConfirmAction
  description="删除这个定时任务？删除后无法恢复"
  confirmText="删除"
  onConfirm={() => onDelete(job)}
>
  <Button variant="destructive" size="sm">
    <Trash2 className="size-3.5" />
    删除
  </Button>
</ConfirmAction>
```
(以实际按钮结构为准,保留原 icon/size。)

- [ ] **Step 2: ApprovalCard 取消任务确认**

在 `src/components/Inbox/ApprovalCard.tsx`,取消任务按钮(`onCancel` / `取消任务`)用 ConfirmAction 包裹:
```tsx
<ConfirmAction
  description="取消这个任务？助手会停止当前操作"
  confirmText="取消任务"
  onConfirm={onCancel}
>
  <Button variant="outline" onClick={onCancel ? undefined : undefined}>
    取消任务
  </Button>
</ConfirmAction>
```
(以实际按钮为准;若取消任务当前是 `variant="outline"`,保留。确认按钮 okVariant 默认 destructive——取消任务用 outline 更合适,传 `okVariant="default"`。)

- [ ] **Step 3: Files 删除文件确认(若有)**

```bash
grep -n "删除\|delete\|Delete" src/pages/Files.tsx src/components/Files/*.tsx | head
```
Files 当前主要是上传/下载/启用,若无删除文件操作则跳过本步。

- [ ] **Step 4: 构建验证**

```bash
pnpm build
```
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/Cron/CronTable.tsx src/components/Inbox/ApprovalCard.tsx
git commit -m "feat: 破坏性操作统一确认（删除任务/取消任务）"
```

---

## Task 16: 网络断开常驻提示条

**Files:**
- Create: `src/components/OfflineBanner.tsx`
- Modify: `src/layouts/MainLayout.tsx`

**Interfaces:**
- Produces: `<OfflineBanner />` — 监听 `navigator.onLine` + online/offline 事件,断网显示细条。
- Consumes: 无。

- [ ] **Step 1: 写组件**

创建 `src/components/OfflineBanner.tsx`:

```typescript
// OfflineBanner — 网络断开常驻提示条。
// 断网是状态非错误，用 warning 语义色（spec §4.4）。不阻塞操作，只告知。

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export function OfflineBanner() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden bg-warning/10"
        >
          <p className="px-4 py-1.5 text-center text-xs text-warning">
            网络已断开，恢复后将自动重连
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: MainLayout 挂载**

在 `src/layouts/MainLayout.tsx`,import:
```typescript
import { OfflineBanner } from "@/components/OfflineBanner";
```

在主内容区(`<div className="flex min-w-0 flex-1 flex-col overflow-hidden">`)的最顶部、`{children}` 之前插入 `<OfflineBanner />`:
```tsx
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <OfflineBanner />
        {children}
      </div>
```

- [ ] **Step 3: 对比度复核(spec §6 留作项)**

`text-warning`(light `oklch(0.55 0.14 65)`)on `bg-warning/10`。用浏览器 DevTools 确认对比度 ≥4.5:1。若不达,把 `text-warning` 改为 `text-warning` 实底背景(即 `bg-warning text-warning-foreground`——但 warning-foreground 未定义),或加深文字为 `text-[oklch(0.45_0.14_65)]`。以实测为准,在 Task 17 验收时确认。

- [ ] **Step 4: 构建验证**

```bash
pnpm build
```
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/OfflineBanner.tsx src/layouts/MainLayout.tsx
git commit -m "feat: 网络断开常驻提示条"
```

---

## Task 17: 全量验收 + 清理 + 收尾

**Files:**
- Modify: `src/pages/ContainerStatus.tsx`(可能删除或保留为未用)
- Verify: 全项目

**Interfaces:**
- 无。

- [ ] **Step 1: 处理 ContainerStatusPage 残留**

`src/pages/ContainerStatus.tsx` 在 Task 6 后不再被 App.tsx 引用。检查是否还有其他引用:
```bash
grep -rn "ContainerStatus" src --include="*.tsx" --include="*.ts"
```
若无引用,删除该文件:
```bash
git rm src/pages/ContainerStatus.tsx
```

- [ ] **Step 2: 全量构建 + 测试**

```bash
pnpm build && pnpm test
```
Expected: 全绿。

- [ ] **Step 3: 残留术语 grep 确认**

```bash
echo "=== chrome 残留技术术语 ==="
grep -rEn "Agent|容器|激活容器|Pod|Ingress|严重性|归属Agent|执行Agent|子Agent" src/pages src/components src/layouts --include="*.tsx" \
  | grep -vE "components/ui/|components/ai-elements/|ownerAgentId|agentId|agent_id|DEFAULT_AGENT" \
  | grep -v "lib/" | head -20
```
Expected: 无中文术语残留(英文变量名 ownerAgentId/agentId 等是代码,不是文案,排除)。若有中文"Agent"文案残留,补改。

```bash
echo "=== toast.error 残留(应仅业务校验) ==="
grep -rn "toast.error" src --include="*.tsx" --include="*.ts"
```

- [ ] **Step 4: 手动验收 checklist(spec §5.3)**

```bash
pnpm dev
```
逐项过:
- [ ] 全新账号首次登录:见"正在为你准备 AI 助手"过渡屏(需 Control Plane 环境;若 dev 直连 Pod 跳过)
- [ ] 过渡屏 >60s 副文变化、>180s 出现"稍后再试"(可临时把计时阈值改小验证后改回)
- [ ] 空对话:欢迎语 + 首提示 + 3 示例,头像 muted 灰
- [ ] 点示例:文字进输入框不发送
- [ ] 首次 focus 输入框:快捷键提示淡入淡出,第二次不出现
- [ ] 切助手/模型:下拉有兜底说明
- [ ] 断网(DevTools 模拟离线):顶部"网络已断开"条,恢复后消失
- [ ] Inbox 审批:卡片有意图行
- [ ] 拒绝审批:弹确认;批准:不弹、点击后"已批准..."disabled
- [ ] 批量删除消息:确认文案带数量
- [ ] 删除定时任务:弹确认
- [ ] 触发错误(断网发消息):toast 人类语言,无堆栈
- [ ] 全程 chrome 无"容器/Pod/Ingress/Agent/参数/严重性"裸技术词

- [ ] **Step 5: 对比度最终复核**

DevTools 确认 OfflineBanner `text-warning` on `bg-warning/10` ≥4.5:1。不达则按 Task 16 Step 3 改实底。

- [ ] **Step 6: 最终 commit**

```bash
git add -A
git commit -m "chore: 清理 ContainerStatusPage + 非技术员工重设计收尾"
```

- [ ] **Step 7: 合并到 main(可选,问用户)**

```bash
git checkout main && git merge feat/non-technical-desktop
```
(合并前与用户确认。)

---

## Self-Review 结果

**1. Spec coverage:**
- §1 容器闸门 → Task 6 ✓
- §2.1 术语(Agent→助手) → Task 7/10/11 ✓
- §2.2 AgentSelector 兜底 → Task 7 ✓
- §2.3 ModelSelector 兜底 → Task 7 ✓
- §2.4 空对话首屏 + 首提示 → Task 8 ✓
- §2.5 ChatInput 占位符 + focus 提示 → Task 9 ✓
- §3.1 术语表 → Task 10/11/13 ✓
- §3.2 审批意图行 → Task 11 ✓
- §3.3 cron 预览 → Task 12 ✓(payload 表单化明确不做,§7)
- §3.4 Files tooltip → Task 13 ✓
- §3.5 空状态副文 → Task 10/12/13 ✓
- §4.1 errorToast → Task 3/14 ✓
- §4.2 破坏性确认 → Task 5/15 ✓
- §4.3 批准/拒绝不对称 → Task 11 ✓
- §4.4 网络条 → Task 16 ✓
- §5 测试 → Task 1/2/3/4 + Task 17 验收 ✓
- §6 设计系统一致性 → Global Constraints + 各 Task 颜色规则 ✓

**2. Placeholder scan:** 无 TBD/TODO。Task 7 Step 2 与 Task 10 Step 3、Task 12 Step 1/3、Task 15 标注"以 grep 结果为准"——这些是因目标行号需运行时确认,已给出 grep 命令和确切替换内容,非占位。

**3. Type consistency:** `describeApprovalIntent(toolName): string`(Task 2)在 Task 11 使用一致;`toastError(err: unknown): void`(Task 3)在 Task 6/14 使用一致;`ConfirmAction` props(Task 5)在 Task 11/15 使用一致;`cronToText`(Task 4 测试)在 Task 12 使用一致。✓

**4. 已知风险标注:**
- Task 8 提升 PromptInputProvider 是结构性改动,若 SlashSuggestionBar/CharCounter 的 controller 依赖破坏,build 会报错——Step 5 已含验证。
- Task 14 toast.error 迁移是行为变更(8 文件),已单独成任务。
- Cron payload 表单化(spec §3.3)明确不在本轮。
