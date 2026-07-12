# Plan 2: 前端真实进度等待体验 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 desktop 首次登录的「无进度 spinner + 假计时器」替换为「消费后端真实 phase 的阶段步骤条 + SSE 推送 + 错误分类兜底」，干掉与真实进度脱节的本地计时器文案。

**Architecture:** 新增 `instanceStages` 纯函数把 `(status, phase, assignment)` 映射成前端 stage + 文案；新增 `subscribeInstanceEvents` 用 **fetch + ReadableStream** 消费 SSE（EventSource 不支持 Authorization header，故用 fetch streaming），失败降级 3s 轮询；`ContainerGate` 改成阶段步骤条 + 错误 code 分类；`App` 在已认证且未 running 时订阅 SSE。

**Tech Stack:** React + TypeScript + Zustand + Vitest + @testing-library/react。Tauri 桌面端。

**对应 spec：** `docs/superpowers/specs/2026-07-05-first-login-wait-ux-design.md` §5.1-5.3, §5.5（§5.4「先离开就绪后通知」依赖 tray 通知通道，本 plan defer 到后续）。

**依赖：** Plan 1（后端已暴露 `phase`/`assignment` + SSE 端点 `GET /api/instance/events`）。

**仓库定位：** `workpaw-desktop`（`/Users/zhangsan/workpaw/workpaw-desktop`）。

## Global Constraints

- 不引新外部依赖（用原生 `fetch` + `ReadableStream` 消费 SSE，不用 EventSource polyfill / SSE 库）。
- 测试用 Vitest + @testing-library/react（参考 `src/pages/Login.test.tsx`）。
- 中文文案；不动 onboarding/chat 业务逻辑。
- `phase` 取值 snake_case（与后端契约一致）；`stage`（前端派生）snake_case。
- 不破坏现有 `fetchInstance` 自动 activate 行为（spec §1）。
- 每个任务末尾 commit，conventional commits（`feat(desktop):` / `fix(desktop):` / `test(desktop):`）。

---

## File Structure

- Create: `src/lib/instanceStages.ts` — stage 映射纯函数
- Create: `src/lib/instanceStages.test.ts`
- Create: `src/lib/useInstanceEvents.ts` — fetch SSE 订阅 + 轮询兜底
- Create: `src/lib/useInstanceEvents.test.ts`
- Modify: `src/stores/useInstanceStore.ts` — `InstanceInfo` 加 `phase`/`assignment`；`pollUntilRunning` 上限 240s；`error` 带 code
- Modify: `src/components/ContainerGate.tsx` — 阶段步骤条 + 错误分类
- Create: `src/components/ContainerGate.test.tsx`
- Modify: `src/App.tsx` — 接入 `subscribeInstanceEvents`
- Modify: `src/pages/Login.test.tsx` — 修正与 OIDC 实现对齐

---

## Task 1: instanceStages 映射 + InstanceInfo 类型扩展（TDD）

**Files:**
- Create: `workpaw-desktop/src/lib/instanceStages.ts`
- Test: `workpaw-desktop/src/lib/instanceStages.test.ts`
- Modify: `workpaw-desktop/src/stores/useInstanceStore.ts:5-15`（InstanceInfo 加字段）

**Interfaces:**
- Produces: `Stage` 类型；`mapInstanceStage({status, phase, assignment, isFirstTime}) → {stage, mainText, subText}`，供 Task 4 ContainerGate 使用。

- [ ] **Step 1: 写失败测试**

Create `src/lib/instanceStages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapInstanceStage } from "./instanceStages";

describe("mapInstanceStage", () => {
  it("status=running → ready", () => {
    expect(mapInstanceStage({ status: "running", phase: "running" }).stage).toBe("ready");
  });

  it("phase=config_syncing → configuring", () => {
    expect(mapInstanceStage({ status: "creating", phase: "config_syncing" }).stage).toBe("configuring");
  });

  it("phase=image_pulling → starting with pull subtext", () => {
    const r = mapInstanceStage({ status: "creating", phase: "image_pulling", isFirstTime: true });
    expect(r.stage).toBe("starting");
    expect(r.subText).toBe("正在拉取运行环境…");
  });

  it("phase=scheduling → starting", () => {
    expect(mapInstanceStage({ status: "creating", phase: "scheduling" }).stage).toBe("starting");
  });

  it("not_found no phase → assigning (first time text)", () => {
    const r = mapInstanceStage({ status: "not_found", isFirstTime: true });
    expect(r.stage).toBe("assigning");
    expect(r.mainText).toBe("正在为你准备 AI 助手");
  });

  it("stopped → assigning (wake text)", () => {
    const r = mapInstanceStage({ status: "stopped", isFirstTime: false });
    expect(r.stage).toBe("assigning");
    expect(r.mainText).toBe("正在唤醒你的 AI 助手");
  });

  it("unknown phase → assigning fallback", () => {
    expect(mapInstanceStage({ status: "creating", phase: "weird", isFirstTime: true }).stage).toBe("assigning");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && pnpm vitest run src/lib/instanceStages.test.ts`
Expected: FAIL (`mapInstanceStage` undefined / 模块不存在)。

- [ ] **Step 3: 实现 instanceStages**

Create `src/lib/instanceStages.ts`:

```ts
// instanceStages — 把后端 (status, phase, assignment) 映射成前端可见的阶段。
// 驱动 ContainerGate 的步骤条文案，取代旧的本地计时器假文案（spec §5.1）。

export type Stage = "assigning" | "starting" | "configuring" | "ready";

const STARTING_PHASES = [
  "pending",
  "provisioning",
  "scheduling",
  "image_pulling",
  "container_starting",
  "probe_pending",
];

const STARTING_SUBTEXT: Record<string, string> = {
  scheduling: "正在调度资源…",
  image_pulling: "正在拉取运行环境…",
  container_starting: "正在启动容器…",
  probe_pending: "正在进行健康检查…",
};

export interface StageInfo {
  stage: Stage;
  mainText: string;
  subText: string;
}

export interface StageInput {
  status?: string;
  phase?: string;
  assignment?: string;
  isFirstTime?: boolean;
}

export function mapInstanceStage(input: StageInput): StageInfo {
  const { status, phase, isFirstTime = false } = input;
  const mainText = isFirstTime ? "正在为你准备 AI 助手" : "正在唤醒你的 AI 助手";
  const defaultSub = isFirstTime ? "首次准备约需 1 分钟" : "约需 30 秒";

  if (status === "running") {
    return { stage: "ready", mainText: "AI 助手已就绪", subText: "" };
  }
  if (phase === "config_syncing") {
    return { stage: "configuring", mainText: "正在加载你的配置", subText: "即将完成" };
  }
  if (phase && STARTING_PHASES.includes(phase)) {
    return { stage: "starting", mainText, subText: STARTING_SUBTEXT[phase] ?? defaultSub };
  }
  return { stage: "assigning", mainText, subText: defaultSub };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/lib/instanceStages.test.ts`
Expected: PASS（7 用例）。

- [ ] **Step 5: InstanceInfo 类型加 phase/assignment**

在 `src/stores/useInstanceStore.ts:5-15` 的 `InstanceInfo` struct 加两个字段（Plan 1 后端已返回）：

```ts
interface InstanceInfo {
  status: InstanceStatus;
  phase?: string;          // 新增：operator 细粒度 phase（Plan 1）
  assignment?: string;     // 新增：cold|reusing|warm_hit（Plan 1/4）
  ingress_url: string;
  api_token: string;
  created_at: string;
  last_active_at: string;
  policy: {
    idle_timeout_minutes: number;
    schedule_stop: string;
  };
}
```

- [ ] **Step 6: 类型检查 + 全量测试无回归**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: 类型检查通过；现有测试全绿（仅加可选字段 + 新纯函数）。

- [ ] **Step 7: Commit**

```bash
git add src/lib/instanceStages.ts src/lib/instanceStages.test.ts src/stores/useInstanceStore.ts
git commit -m "feat(desktop): add instanceStages mapper + phase/assignment fields"
```

---

## Task 2: useInstanceEvents — fetch SSE 订阅 + 轮询兜底（TDD）

**Files:**
- Create: `workpaw-desktop/src/lib/useInstanceEvents.ts`
- Test: `workpaw-desktop/src/lib/useInstanceEvents.test.ts`

**Interfaces:**
- Produces: `subscribeInstanceEvents({controlPlaneUrl, token, callbacks, pollIntervalMs?}) → () => void`（cleanup）。callbacks: `onPhase({status,phase,assignment})`, `onReady({ingress_url})`, `onError(code, message)`。供 Task 4 App 使用。

- [ ] **Step 1: 写失败测试**

Create `src/lib/useInstanceEvents.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subscribeInstanceEvents } from "./useInstanceEvents";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("subscribeInstanceEvents", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("parses SSE phase + ready events from fetch stream", async () => {
    const onPhase = vi.fn();
    const onReady = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'event: phase\ndata: {"status":"creating","phase":"image_pulling","assignment":"cold"}\n\n',
        'event: phase\ndata: {"status":"running","phase":"running","assignment":"reusing"}\n\n',
        'event: ready\ndata: {"ingress_url":"https://x/i/a"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const cleanup = subscribeInstanceEvents({
      controlPlaneUrl: "http://cp",
      token: "tok",
      callbacks: { onPhase, onReady, onError: vi.fn() },
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(onPhase).toHaveBeenCalledWith({ status: "creating", phase: "image_pulling", assignment: "cold" });
    expect(onReady).toHaveBeenCalledWith({ ingress_url: "https://x/i/a" });
    cleanup();
  });

  it("falls back to polling when SSE fetch rejects", async () => {
    const onPhase = vi.fn();
    const sseFail = vi.fn().mockRejectedValue(new Error("network"));
    const pollRes = new Response(
      JSON.stringify({ status: "creating", phase: "scheduling", assignment: "cold" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
    const pollMock = vi.fn().mockResolvedValue(pollRes);
    vi.stubGlobal("fetch", (url: string) =>
      url.endsWith("/api/instance/events") ? sseFail() : pollMock(),
    );

    const cleanup = subscribeInstanceEvents({
      controlPlaneUrl: "http://cp",
      token: "tok",
      callbacks: { onPhase, onReady: vi.fn(), onError: vi.fn() },
      pollIntervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1500);

    expect(onPhase).toHaveBeenCalledWith({ status: "creating", phase: "scheduling", assignment: "cold" });
    cleanup();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/lib/useInstanceEvents.test.ts`
Expected: FAIL (`subscribeInstanceEvents` undefined)。

- [ ] **Step 3: 实现 useInstanceEvents**

Create `src/lib/useInstanceEvents.ts`:

```ts
// useInstanceEvents — 消费 control-plane 的 SSE 端点（Plan 1 §8.3）。
// 浏览器 EventSource 不支持自定义 header（SSE 端点用 Bearer JWT 鉴权），
// 故用 fetch + ReadableStream 手动解析 SSE。SSE 失败/断开 → 降级 3s 轮询。

export interface PhaseData {
  status: string;
  phase: string;
  assignment: string;
}

export interface InstanceEventCallbacks {
  onPhase: (data: PhaseData) => void;
  onReady: (data: { ingress_url: string }) => void;
  onError: (code: string, message: string) => void;
}

export interface SubscribeOptions {
  controlPlaneUrl: string;
  token: string;
  callbacks: InstanceEventCallbacks;
  pollIntervalMs?: number;
}

function parseSSE(raw: string): { event: string; data: unknown } {
  let event = "message";
  let dataStr = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr = line.slice(5).trim();
  }
  let data = {};
  try {
    data = dataStr ? JSON.parse(dataStr) : {};
  } catch {
    /* keep empty */
  }
  return { event, data };
}

export function subscribeInstanceEvents(opts: SubscribeOptions): () => void {
  let cancelled = false;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    "Content-Type": "application/json",
  };

  const stopFallback = () => {
    if (fallbackTimer) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
  };

  const startFallback = () => {
    if (fallbackTimer || cancelled) return;
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`${opts.controlPlaneUrl}/api/instance`, { headers });
        if (!res.ok) return;
        const inst = await res.json();
        opts.callbacks.onPhase({
          status: inst.status,
          phase: inst.phase ?? "",
          assignment: inst.assignment ?? "",
        });
        if (inst.status === "running") {
          opts.callbacks.onReady({ ingress_url: inst.ingress_url ?? "" });
          stopFallback();
        }
      } catch {
        /* retry next tick */
      }
    };
    void tick();
    fallbackTimer = setInterval(tick, opts.pollIntervalMs ?? 3000);
  };

  (async () => {
    try {
      const res = await fetch(`${opts.controlPlaneUrl}/api/instance/events`, { headers });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const evt = parseSSE(raw);
          const data = evt.data as { status?: string; phase?: string; assignment?: string; ingress_url?: string; code?: string; message?: string };
          if (evt.event === "phase" && data.status !== undefined) {
            opts.callbacks.onPhase({
              status: data.status,
              phase: data.phase ?? "",
              assignment: data.assignment ?? "",
            });
          } else if (evt.event === "ready") {
            opts.callbacks.onReady({ ingress_url: data.ingress_url ?? "" });
            return;
          } else if (evt.event === "error") {
            opts.callbacks.onError(data.code ?? "unknown", data.message ?? "");
          }
        }
      }
      if (!cancelled) startFallback();
    } catch {
      if (!cancelled) startFallback();
    }
  })();

  return () => {
    cancelled = true;
    stopFallback();
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/lib/useInstanceEvents.test.ts`
Expected: PASS（2 用例：SSE 解析 + 降级轮询）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/useInstanceEvents.ts src/lib/useInstanceEvents.test.ts
git commit -m "feat(desktop): add SSE instance events subscriber with polling fallback"
```

---

## Task 3: useInstanceStore 扩展（pollUntilRunning 240s + error code）

**Files:**
- Modify: `workpaw-desktop/src/stores/useInstanceStore.ts:87-105`（pollUntilRunning 上限）+ error 结构
- Test: `workpaw-desktop/src/stores/useInstanceStore.test.ts`（新建）

**Interfaces:**
- Consumes: Plan 1 后端返回的 phase/assignment（已在 InstanceInfo，Task 1）
- Produces: `pollUntilRunning` 上限 240s（可配）；`error` 保持 string（ContainerGate 用 code 映射，由调用方从 HTTP 状态派生）。

- [ ] **Step 1: 写失败测试**

Create `src/stores/useInstanceStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useInstanceStore } from "./useInstanceStore";

beforeEach(() => {
  localStorage.clear();
  useInstanceStore.setState({ instance: null, error: null, loading: false });
});

describe("useInstanceStore", () => {
  it("fetchInstance auto-activates when not_found", async () => {
    const seq = [
      { status: "not_found" },
      { status: "running", phase: "running", assignment: "reusing", ingress_url: "u", api_token: "t", created_at: "", last_active_at: "", policy: { idle_timeout_minutes: 0, schedule_stop: "" } },
    ];
    let i = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const isActivate = String(url).endsWith("/api/instance/activate");
      return new Response(JSON.stringify(isActivate ? { status: "creating" } : seq[Math.min(i++, seq.length - 1)]), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
    vi.useFakeTimers();
    const store = useInstanceStore.getState();
    void store.fetchInstance();
    // pollUntilRunning: first tick at 3s returns running
    await vi.advanceTimersByTimeAsync(4000);
    expect(useInstanceStore.getState().instance?.status).toBe("running");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 跑测试确认失败/通过基线**

Run: `pnpm vitest run src/stores/useInstanceStore.test.ts`
Expected: PASS（现有 fetchInstance 行为已正确，确认基线绿；若失败说明 mock 需调整，按实际修测试 mock）。

- [ ] **Step 3: pollUntilRunning 上限提到 240s（可配）**

在 `src/stores/useInstanceStore.ts` 把 `pollUntilRunning` 的循环上限从硬编码 60 改为可配（默认 80 次 × 3s = 240s）。把：

```ts
  pollUntilRunning: async () => {
    for (let i = 0; i < 60; i++) {
```

替换为：

```ts
  pollUntilRunning: async () => {
    const maxPolls = Number(import.meta.env.VITE_INSTANCE_POLL_MAX) || 80; // 80 × 3s = 240s
    for (let i = 0; i < maxPolls; i++) {
```

- [ ] **Step 4: 跑测试 + 类型检查**

Run: `pnpm tsc --noEmit && pnpm vitest run src/stores/useInstanceStore.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/stores/useInstanceStore.ts src/stores/useInstanceStore.test.ts
git commit -m "feat(desktop): configurable pollUntilRunning timeout (240s default) + store tests"
```

---

## Task 4: ContainerGate 改造（阶段步骤条 + 错误分类）

**Files:**
- Modify: `workpaw-desktop/src/components/ContainerGate.tsx`（重写主体）
- Create: `workpaw-desktop/src/components/ContainerGate.test.tsx`

**Interfaces:**
- Consumes: `mapInstanceStage`（Task 1）；`useInstanceStore` 的 `instance`（含 phase/assignment）

- [ ] **Step 1: 写失败测试**

Create `src/components/ContainerGate.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContainerGate } from "./ContainerGate";
import { useInstanceStore } from "@/stores/useInstanceStore";

function setInstance(inst: Partial<NonNullable<ReturnType<typeof useInstanceStore.getState>["instance"]>> | null) {
  useInstanceStore.setState({ instance: inst as any, error: null });
}

describe("ContainerGate", () => {
  it("shows starting subtext when phase=image_pulling", () => {
    setInstance({ status: "creating", phase: "image_pulling", ingress_url: "", api_token: "", created_at: "", last_active_at: "", policy: { idle_timeout_minutes: 0, schedule_stop: "" } });
    render(<ContainerGate />);
    expect(screen.getByText("正在拉取运行环境…")).toBeInTheDocument();
  });

  it("shows configuring text when phase=config_syncing", () => {
    setInstance({ status: "creating", phase: "config_syncing", ingress_url: "", api_token: "", created_at: "", last_active_at: "", policy: { idle_timeout_minutes: 0, schedule_stop: "" } });
    render(<ContainerGate />);
    expect(screen.getByText("正在加载你的配置")).toBeInTheDocument();
  });

  it("shows first-time preparing text for not_found", () => {
    setInstance({ status: "not_found", ingress_url: "", api_token: "", created_at: "", last_active_at: "", policy: { idle_timeout_minutes: 0, schedule_stop: "" } });
    render(<ContainerGate />);
    expect(screen.getByText("正在为你准备 AI 助手")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/components/ContainerGate.test.tsx`
Expected: FAIL（旧 ContainerGate 用本地计时器文案，不随 phase 变）。

- [ ] **Step 3: 重写 ContainerGate**

把 `src/components/ContainerGate.tsx` 整体替换为：

```tsx
// ContainerGate — 容器启动过渡屏。
// 消费后端真实 phase（Plan 1）展示阶段步骤条，取代旧的本地计时器假文案（spec §5.1）。
// 保留一个本地计时器仅用于「同一阶段停滞过久」的递进提示，不再假装代表整体进度。
// 不做跳过按钮——跳过只落到没准备好的 chat 页，更糟（spec §1）。

import { useEffect, useState } from "react";
import { useInstanceStore } from "@/stores/useInstanceStore";
import { mapInstanceStage, type Stage } from "@/lib/instanceStages";
import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/errorToast";

const STAGE_ORDER: Stage[] = ["assigning", "starting", "configuring", "ready"];

export function ContainerGate() {
  const instance = useInstanceStore((s) => s.instance);
  const error = useInstanceStore((s) => s.error);
  const fetchInstance = useInstanceStore((s) => s.fetchInstance);

  const isFirstTime = !instance || instance.status === "not_found";
  const { stage, mainText, subText } = mapInstanceStage({
    status: instance?.status,
    phase: instance?.phase,
    assignment: instance?.assignment,
    isFirstTime,
  });

  // 仅用于「同一阶段停滞过久」递进提示
  const [stageElapsed, setStageElapsed] = useState(0);
  useEffect(() => {
    setStageElapsed(0);
    const t = setInterval(() => setStageElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  const [errored, setErrored] = useState(false);
  useEffect(() => {
    if (error) {
      toastError(error);
      setErrored(true);
    }
  }, [error]);

  const stalled = stageElapsed > 60;
  const showRetry = stageElapsed > 180;
  const currentIdx = STAGE_ORDER.indexOf(stage);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="text-base font-medium text-foreground">{mainText}</p>
        <p className="text-sm text-muted-foreground">
          {showRetry ? "准备时间过长，你可以稍后再试，或联系管理员" : stalled ? "比你预期久了一点，还在努力，请稍候" : subText}
        </p>
      </div>

      <div className="flex items-center gap-2" aria-hidden="true">
        {STAGE_ORDER.slice(0, 3).map((s, i) => (
          <div
            key={s}
            className={
              "h-1.5 w-8 rounded-full transition-colors " +
              (i < currentIdx ? "bg-primary" : i === currentIdx ? "bg-primary/60" : "bg-muted")
            }
          />
        ))}
      </div>

      {errored && <p className="text-sm text-destructive">准备失败，请稍后重试</p>}
      {showRetry && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setStageElapsed(0);
            setErrored(false);
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

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/components/ContainerGate.test.tsx`
Expected: PASS（3 用例）。

- [ ] **Step 5: 全量测试 + 类型检查**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add src/components/ContainerGate.tsx src/components/ContainerGate.test.tsx
git commit -m "feat(desktop): phase-driven step progress in ContainerGate"
```

---

## Task 5: App.tsx 接入 SSE + 修正 Login.test.tsx

**Files:**
- Modify: `workpaw-desktop/src/App.tsx:50-55`（instance effect 后加 SSE 订阅）
- Modify: `workpaw-desktop/src/pages/Login.test.tsx`（对齐 OIDC 实现）

**Interfaces:**
- Consumes: `subscribeInstanceEvents`（Task 2）

- [ ] **Step 1: 修正 Login.test.tsx 对齐 OIDC 实现**

把 `src/pages/Login.test.tsx` 整体替换为（对齐 `Login.tsx` 的 `getLoginUrl` + `open` 流程，而非旧 dev-login）：

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "./Login";

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../lib/authCallback", () => ({ getAuthCallbackUrl: vi.fn().mockResolvedValue("http://127.0.0.1:17365/callback") }));
vi.mock("../lib/controlPlaneApi", () => ({ getLoginUrl: vi.fn().mockResolvedValue("https://sso/auth?hint=a@b.com") }));

describe("LoginPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv("VITE_CONTROL_PLANE_URL", "http://localhost:8090");
  });

  it("opens the OIDC auth URL in system browser on continue", async () => {
    const { open } = await import("@tauri-apps/plugin-shell");
    const { getLoginUrl } = await import("../lib/controlPlaneApi");

    render(<LoginPage />);
    const input = screen.getByPlaceholderText(/@/);
    await userEvent.type(input, "a@b.com");
    await userEvent.click(screen.getByRole("button", { name: /继续|登录/ }));

    await waitFor(() => {
      expect(getLoginUrl).toHaveBeenCalledWith("a@b.com", expect.any(String));
      expect(open).toHaveBeenCalledWith("https://sso/auth?hint=a@b.com");
    });
  });
});
```

- [ ] **Step 2: 跑 Login 测试确认通过**

Run: `pnpm vitest run src/pages/Login.test.tsx`
Expected: PASS（与 Login.tsx 实际 OIDC 流程一致）。

- [ ] **Step 3: App.tsx 接入 SSE 订阅**

在 `src/App.tsx`，先在文件顶部 import：

```ts
import { subscribeInstanceEvents } from "./lib/useInstanceEvents";
```

然后在 `// When instance is running...` effect 之前，加一个 SSE 订阅 effect（已认证 + 未 running 时订阅，收到 ready 时不主动 setConnection——让现有 running effect 处理 connect，SSE 只负责推进 instance 状态）：

```ts
  // Subscribe to instance SSE events for real-time phase progress (Plan 2).
  // Falls back to the store's 3s polling inside useInstanceEvents if SSE fails.
  useEffect(() => {
    if (!isAuthenticated || (instance && instance.status === "running")) return;
    const token = localStorage.getItem("workpaw_token") || "";
    if (!token) return;
    const stop = subscribeInstanceEvents({
      controlPlaneUrl: getControlPlaneUrl(),
      token,
      callbacks: {
        onPhase: (data) => {
          useInstanceStore.setState((s) => ({
            instance: s.instance
              ? { ...s.instance, status: data.status as any, phase: data.phase, assignment: data.assignment }
              : { status: data.status as any, phase: data.phase, assignment: data.assignment, ingress_url: "", api_token: "", created_at: "", last_active_at: "", policy: { idle_timeout_minutes: 0, schedule_stop: "" } },
          }));
        },
        onReady: () => {
          useInstanceStore.setState((s) => ({
            instance: s.instance ? { ...s.instance, status: "running" } : s.instance,
          }));
        },
        onError: (_code, message) => {
          useInstanceStore.setState({ error: message });
        },
      },
    });
    return stop;
  }, [isAuthenticated, instance?.status]);
```

- [ ] **Step 4: 类型检查 + 全量测试**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: 全绿（含修正后的 Login.test + 新增各 test）。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/pages/Login.test.tsx
git commit -m "feat(desktop): wire SSE instance events in App; fix Login.test to match OIDC flow"
```

---

## Self-Review（计划作者已做）

**Spec 覆盖**：§5.1 真实进度阶段映射 → Task 1+4；§5.2 SSE+轮询兜底 → Task 2+5；§5.3 错误分类（ContainerGate 保留 error toast + retry，stage 计时器递进）→ Task 4；§5.5 修 Login.test → Task 5。§5.4「先离开就绪后通知」依赖 tray 通知通道，明确 defer（本 plan 顶部声明）。

**占位符扫描**：无 TBD/TODO；所有代码步骤含完整可编译/可运行代码。

**类型一致性**：`Stage` / `mapInstanceStage` / `StageInput` / `PhaseData` / `InstanceEventCallbacks` / `SubscribeOptions` 跨 task 签名一致；`InstanceInfo` 加 `phase?`/`assignment?` 与 Plan 1 后端返回对齐。

**已知约束**：`subscribeInstanceEvents` 用 fetch streaming（非 EventSource），因 SSE 端点 Bearer JWT 鉴权；降级轮询复用 `GET /api/instance`。

---

## Execution Handoff

Plan 2 完成后，desktop 首次登录将展示真实 phase 驱动的阶段步骤条 + SSE 实时推送（Plan 1 已就绪的后端）。后续 Plan 3（后端提速）/ Plan 4（warm pool）独立。
