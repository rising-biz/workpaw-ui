# 场景画廊 — desktop 画廊 + 做同款 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Plan 1(`/api/scenarios` 只读 API 已上线)+ Plan 2(`VariableForm` 已在 workpaw-ui 导出)。

**Goal:** 在 desktop chat 页面落地"场景化最佳实践画廊 + 做同款":空状态 6 卡画廊、header `[✨场景]` 完整画廊 Sheet、做同款三段式(预览→填变量→新建会话执行)、`/` 斜杠命令接入场景,以及全套降级。

**Architecture:** 新建 `scenarioApi.ts`(裸 fetch 调 control-plane,仿 useInstanceStore 模式)+ `useScenarioStore`(zustand)。改造 `WelcomeScreen` 为画廊(有场景显示 6 卡,无场景回退现有 3 chip)。`Chat.tsx` header 加 `[✨场景]` 按钮 → `ScenarioGallerySheet`。做同款执行链复用 `useChatStore` 的 `createSession`/`setSelectedAgent`/`setActiveModel`/`sendMessage`,失败回滚删空会话。`/` 斜杠在 `ChatInput` 接入场景命令填入输入框。VariableForm 从 workpaw-ui 引入。

**Tech Stack:** React 19, TypeScript, Tauri 2, Vite, zustand, Shadcn UI, vitest + @testing-library/react。

## Global Constraints

- 场景库加载失败/为空时**不阻断主 chat**:WelcomeScreen 回退 3 chip、Sheet 显示空态、`/` 只留 `/clear` `/compact`。
- 做同款 = **新建会话**(不在已有会话中途切 Agent/Model);执行链任一步失败回滚删除已建空会话。
- 场景引用的 agent 若当前用户 Pod 未启用 → 卡片置灰 + 预览提示"需启用",不硬塞。
- 卡片视觉遵循"精密控制台":1px hairline、无静态阴影、Signal Orange 仅 hover 边框 + "做同款"文字 + 分类标签。
- control-plane 调用用裸 fetch + `localStorage.getItem("workpaw_token")`,baseURL 用 `import.meta.env.VITE_CONTROL_PLANE_URL || "http://localhost:8090"`。
- 每个 task 结束 commit;分支 `feat/scenario-desktop`。

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `src/lib/scenarioApi.ts` | 新建 | control-plane `/api/scenarios` fetch 封装 + Scenario 类型(或从 workpaw-ui 引入) |
| `src/stores/useScenarioStore.ts` | 新建 | 场景库 zustand store(fetch/缓存/分组/降级) |
| `src/components/Scenario/ScenarioCard.tsx` | 新建 | 单张场景卡片(克制视觉) |
| `src/components/Scenario/ScenarioGallerySheet.tsx` | 新建 | 完整画廊 Sheet(分类 tab + 搜索 + 网格) |
| `src/components/Scenario/ScenarioRunSheet.tsx` | 新建 | 做同款三段式(预览 + 变量表单 + 执行) |
| `src/components/Scenario/runScenario.ts` | 新建 | 执行链纯函数(新建会话+切Agent+切Model+渲染prompt+发送+回滚) |
| `src/components/Chat/MessageList.tsx` | 修改 | WelcomeScreen 改造为画廊 |
| `src/pages/Chat.tsx` | 修改 | header 加 [✨场景] 按钮 + 触发 fetchScenarios |
| `src/components/Chat/ChatInput.tsx` | 修改 | `/` 斜杠接入场景命令 |
| `src/stores/useChatStore.ts` | 修改 | 暴露 deleteSession 给执行链回滚(已有) |
| 测试 | 新建 | 各组件/store/执行链测试 |

---

## Task 1: scenarioApi

**Files:**
- Create: `src/lib/scenarioApi.ts`

**Interfaces:**
- Produces: `listScenarios(): Promise<Scenario[]>`,类型从 workpaw-ui 引入(`Scenario`)。

- [ ] **Step 1: 写失败测试**

Create `src/lib/__tests__/scenarioApi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listScenarios } from "../scenarioApi";

describe("scenarioApi.listScenarios", () => {
  beforeEach(() => {
    localStorage.setItem("workpaw_token", "fake-jwt");
    vi.stubEnv("VITE_CONTROL_PLANE_URL", "http://cp:8090");
  });

  it("GETs /api/scenarios with bearer token and unwraps {scenarios:[]}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ scenarios: [{ id: "s1", slug: "x", title: "X" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await listScenarios();
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("X");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://cp:8090/api/scenarios",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer fake-jwt" }),
      }),
    );
  });

  it("throws on non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    await expect(listScenarios()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- scenarioApi`
Expected: FAIL — `undefined listScenarios`。

- [ ] **Step 3: 实现 scenarioApi**

Create `src/lib/scenarioApi.ts`:

```ts
import type { Scenario } from "workpaw-ui";

function getControlPlaneUrl(): string {
  return import.meta.env.VITE_CONTROL_PLANE_URL || "http://localhost:8090";
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("workpaw_token") || "";
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function listScenarios(): Promise<Scenario[]> {
  const res = await fetch(`${getControlPlaneUrl()}/api/scenarios`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`scenarios ${res.status}: ${text || res.statusText}`);
  }
  const data = await res.json();
  return (data.scenarios ?? []) as Scenario[];
}

export type { Scenario };
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- scenarioApi`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git checkout -b feat/scenario-desktop
git add src/lib/scenarioApi.ts src/lib/__tests__/scenarioApi.test.ts
git commit -m "feat(desktop): scenarioApi client for control-plane /api/scenarios"
```

---

## Task 2: useScenarioStore

**Files:**
- Create: `src/stores/useScenarioStore.ts`

**Interfaces:**
- Produces: `useScenarioStore` zustand store:
  - state: `scenarios: Scenario[]`, `loading: boolean`, `error: string | null`
  - actions: `fetchScenarios(): Promise<void>`, `getEnabled(): Scenario[]`, `scenariosByCategory(): Record<string, Scenario[]>`, `topForWelcome(n: number): Scenario[]`(sort_order 最靠前 n 个)

- [ ] **Step 1: 写失败测试**

Create `src/stores/__tests__/useScenarioStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useScenarioStore } from "../useScenarioStore";
import * as api from "@/lib/scenarioApi";

describe("useScenarioStore", () => {
  beforeEach(() => {
    useScenarioStore.setState({ scenarios: [], loading: false, error: null });
    vi.clearAllMocks();
  });

  it("fetchScenarios loads and stores scenarios", async () => {
    const mockList = vi.spyOn(api, "listScenarios").mockResolvedValue([
      { id: "s1", slug: "a", title: "A", category: "写作", sort_order: 2, enabled: true, source: "official", description: "", icon: "", agent_id: "", agent_name: "", model_preset: null, prompt_template: "", variables: [], example_dialogue: [] },
      { id: "s2", slug: "b", title: "B", category: "代码", sort_order: 1, enabled: true, source: "official", description: "", icon: "", agent_id: "", agent_name: "", model_preset: null, prompt_template: "", variables: [], example_dialogue: [] },
    ]);
    await useScenarioStore.getState().fetchScenarios();
    expect(mockList).toHaveBeenCalled();
    expect(useScenarioStore.getState().scenarios).toHaveLength(2);
    expect(useScenarioStore.getState().error).toBeNull();
  });

  it("fetchScenarios sets error on failure, does not throw", async () => {
    vi.spyOn(api, "listScenarios").mockRejectedValue(new Error("net"));
    await useScenarioStore.getState().fetchScenarios();
    expect(useScenarioStore.getState().error).toBe("net");
    expect(useScenarioStore.getState().scenarios).toEqual([]);
  });

  it("topForWelcome returns n by sort_order asc", async () => {
    vi.spyOn(api, "listScenarios").mockResolvedValue([
      { id: "1", slug: "a", title: "A", category: "c", sort_order: 3, enabled: true, source: "official", description: "", icon: "", agent_id: "", agent_name: "", model_preset: null, prompt_template: "", variables: [], example_dialogue: [] },
      { id: "2", slug: "b", title: "B", category: "c", sort_order: 1, enabled: true, source: "official", description: "", icon: "", agent_id: "", agent_name: "", model_preset: null, prompt_template: "", variables: [], example_dialogue: [] },
      { id: "3", slug: "c", title: "C", category: "c", sort_order: 2, enabled: true, source: "official", description: "", icon: "", agent_id: "", agent_name: "", model_preset: null, prompt_template: "", variables: [], example_dialogue: [] },
    ] as any);
    await useScenarioStore.getState().fetchScenarios();
    const top = useScenarioStore.getState().topForWelcome(2);
    expect(top.map((s) => s.title)).toEqual(["B", "C"]);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- useScenarioStore`
Expected: FAIL — `undefined useScenarioStore`。

- [ ] **Step 3: 实现 store**

Create `src/stores/useScenarioStore.ts`:

```ts
import { create } from "zustand";
import type { Scenario } from "workpaw-ui";
import { listScenarios } from "@/lib/scenarioApi";

interface ScenarioState {
  scenarios: Scenario[];
  loading: boolean;
  error: string | null;
  fetchScenarios: () => Promise<void>;
  getEnabled: () => Scenario[];
  scenariosByCategory: () => Record<string, Scenario[]>;
  topForWelcome: (n: number) => Scenario[];
}

export const useScenarioStore = create<ScenarioState>((set, get) => ({
  scenarios: [],
  loading: false,
  error: null,

  fetchScenarios: async () => {
    set({ loading: true, error: null });
    try {
      const scenarios = await listScenarios();
      set({ scenarios, loading: false });
    } catch (e) {
      // 不抛:场景库是锦上添花,绝不阻断主 chat。
      set({ scenarios: [], loading: false, error: e instanceof Error ? e.message : "加载场景失败" });
    }
  },

  getEnabled: () => get().scenarios,

  scenariosByCategory: () => {
    const map: Record<string, Scenario[]> = {};
    for (const s of get().scenarios) {
      (map[s.category] ??= []).push(s);
    }
    return map;
  },

  topForWelcome: (n) =>
    [...get().scenarios].sort((a, b) => a.sort_order - b.sort_order).slice(0, n),
}));
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- useScenarioStore`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/stores/useScenarioStore.ts src/stores/__tests__/useScenarioStore.test.ts
git commit -m "feat(desktop): useScenarioStore with graceful failure"
```

---

## Task 3: ScenarioCard

**Files:**
- Create: `src/components/Scenario/ScenarioCard.tsx`

**Interfaces:**
- Produces: `ScenarioCard` props `{ scenario: Scenario; agentUnavailable?: boolean; onRun: () => void; onPreview: () => void }`。克制视觉:1px hairline、无阴影、hover 边框转 primary、"做同款"文字用 primary。agentUnavailable 时整卡置灰 + 角标"需启用",onRun 禁用。

- [ ] **Step 1: 写失败测试**

Create `src/components/Scenario/ScenarioCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScenarioCard } from "./ScenarioCard";
import type { Scenario } from "workpaw-ui";

const s = {
  id: "1", slug: "x", title: "总结文档", description: "上传文档生成摘要",
  category: "分析", icon: "FileText", agent_id: "a1", agent_name: "助手",
  model_preset: null, prompt_template: "p", variables: [], example_dialogue: [],
  sort_order: 1, enabled: true, source: "official",
} as Scenario;

describe("ScenarioCard", () => {
  it("renders title, category, 做同款 and calls onRun", async () => {
    const onRun = vi.fn();
    const onPreview = vi.fn();
    render(<ScenarioCard scenario={s} onRun={onRun} onPreview={onPreview} />);
    expect(screen.getByText("总结文档")).toBeInTheDocument();
    expect(screen.getByText("分析")).toBeInTheDocument();
    expect(screen.getByText("做同款")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText("做同款"));
    expect(onRun).toHaveBeenCalled();
  });

  it("disables run and shows 需启用 when agentUnavailable", () => {
    render(<ScenarioCard scenario={s} agentUnavailable onRun={vi.fn()} onPreview={vi.fn()} />);
    expect(screen.getByText("需启用")).toBeInTheDocument();
    expect(screen.getByText("做同款").closest("button")).toBeDisabled();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- ScenarioCard`
Expected: FAIL — `undefined ScenarioCard`。

- [ ] **Step 3: 实现 ScenarioCard**

Create `src/components/Scenario/ScenarioCard.tsx`:

```tsx
import { FileText } from "lucide-react";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";
import type { Scenario } from "workpaw-ui";

interface ScenarioCardProps {
  scenario: Scenario;
  agentUnavailable?: boolean;
  onRun: () => void;
  onPreview: () => void;
}

export function ScenarioCard({ scenario, agentUnavailable, onRun, onPreview }: ScenarioCardProps) {
  const IconComp = (Icons as Record<string, React.ComponentType<{ className?: string }>>)[scenario.icon] ?? FileText;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPreview}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPreview()}
      className={cn(
        "group relative flex h-full w-full cursor-pointer flex-col gap-2 rounded-xl p-4 text-left",
        "ring-1 ring-foreground/10 transition-all hover:ring-primary/50 hover:-translate-y-px",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        agentUnavailable && "opacity-50",
      )}
    >
      {agentUnavailable && (
        <span className="absolute right-2 top-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          需启用
        </span>
      )}
      <IconComp className="size-5 text-foreground" />
      <div className="text-sm font-medium text-foreground">{scenario.title}</div>
      <div className="line-clamp-2 text-xs text-muted-foreground">{scenario.description}</div>
      <div className="mt-auto flex items-center justify-between pt-2">
        <span className="text-[11px] text-primary">{scenario.category}</span>
        <button
          type="button"
          disabled={agentUnavailable}
          onClick={(e) => { e.stopPropagation(); onRun(); }}
          className="text-xs font-medium text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          做同款 →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- ScenarioCard`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/components/Scenario/ScenarioCard.tsx src/components/Scenario/ScenarioCard.test.tsx
git commit -m "feat(desktop): ScenarioCard with restrained console styling"
```

---

## Task 4: 做同款执行链(纯函数 + 回滚)

**Files:**
- Create: `src/components/Scenario/runScenario.ts`

**Interfaces:**
- Consumes: `useChatStore`(createSession/setSelectedAgent/setActiveModel/sendMessage/deleteSession)、`podApi`(uploadFile)、`useScenarioStore` 无需。
- Produces: `runScenario(scenario, values, opts): Promise<void>` 执行链;`renderPrompt(template, values): string` 提示词渲染。

- [ ] **Step 1: 写失败测试 — renderPrompt**

Create `src/components/Scenario/runScenario.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderPrompt } from "./runScenario";

describe("renderPrompt", () => {
  it("replaces {{key}} with values", () => {
    expect(renderPrompt("你好 {{name}},风格 {{style}}", { name: "张三", style: "正式" }))
      .toBe("你好 张三,风格 正式");
  });
  it("leaves unknown placeholder as-is", () => {
    expect(renderPrompt("{{x}}", {})).toBe("{{x}}");
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- runScenario`
Expected: FAIL — `undefined renderPrompt`。

- [ ] **Step 3: 实现 runScenario**

Create `src/components/Scenario/runScenario.ts`:

```ts
import type { Scenario } from "workpaw-ui";
import { useChatStore } from "@/stores/useChatStore";
import { podApi } from "@/lib/podApi";

// renderPrompt replaces {{key}} placeholders with values. Unknown placeholders
// are left as-is (defensive against dirty data — see spec §10.4).
export function renderPrompt(
  template: string,
  values: Record<string, string | File | undefined>,
): string {
  return template.replace(/{{(\w+)}}/g, (m, key) => {
    const v = values[key];
    if (v === undefined || v === "") return m; // leave placeholder
    return v instanceof File ? v.name : String(v);
  });
}

export interface RunScenarioOpts {
  // required 校验:返回缺失 key 列表;空数组=通过
  validate?: (scenario: Scenario, values: Record<string, string | File | undefined>) => string[];
  onError?: (msg: string) => void;
}

// runScenario executes the "做同款" chain: create session → set agent → set
// model → upload file vars → render prompt → send. On any pre-send failure
// the just-created empty session is rolled back (deleted). Send failures are
// left to the existing sendMessage error path (session retained).
export async function runScenario(
  scenario: Scenario,
  values: Record<string, string | File | undefined>,
  opts: RunScenarioOpts = {},
): Promise<void> {
  const store = useChatStore.getState();
  const { validate, onError } = opts;

  // 1. required 校验
  if (validate) {
    const missing = validate(scenario, values);
    if (missing.length > 0) {
      onError?.(`请填写: ${missing.join(", ")}`);
      return;
    }
  }

  // 2. 新建会话
  let newChatId: string | null = null;
  try {
    await store.createSession();
    newChatId = useChatStore.getState().currentSessionId;
    if (!newChatId) throw new Error("创建会话失败");

    // 3. 切 Agent
    store.setSelectedAgent(scenario.agent_id || null);

    // 4. 切 Model(可选)
    if (scenario.model_preset) {
      await podApi.setActiveModel(
        scenario.model_preset.provider_id,
        scenario.model_preset.model,
        scenario.agent_id || undefined,
      );
    }

    // 5. file 变量上传 + 渲染提示词
    const attachments: Array<{ url: string; name: string; type?: string }> = [];
    for (const v of scenario.variables) {
      if (v.type === "file") {
        const file = values[v.key];
        if (file instanceof File) {
          const uploaded = await podApi.uploadFile(file);
          attachments.push({
            url: uploaded.url || uploaded.stored_name || "",
            name: uploaded.file_name || file.name,
            type: file.type,
          });
        }
      }
    }
    const prompt = renderPrompt(scenario.prompt_template, values);

    // 6. 发送(走现有 SSE)
    await store.sendMessage(prompt, attachments.length > 0 ? attachments : undefined);
    // 成功:newChatId 保留,执行链结束。视图已由 createSession 切到新会话。
  } catch (e) {
    const msg = e instanceof Error ? e.message : "做同款失败";
    // 回滚:若会话已建但发送未成功,删除空会话
    if (newChatId) {
      try { await store.deleteSession(newChatId); } catch { /* best-effort */ }
    }
    onError?.(msg);
  }
}
```

注:`podApi.uploadFile` 返回 `ChatUploadResponse`(含 `url`/`stored_name`/`file_name`,见 podApi.ts:216);`store.deleteSession(id)` 已存在(useChatStore.ts:474);`store.sendMessage(content, files?)` 签名见 useChatStore.ts:538。`createSession` 已把 `currentSessionId` 设到新会话(useChatStore.ts:465),故发送即在新会话内。

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- runScenario`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/components/Scenario/runScenario.ts src/components/Scenario/runScenario.test.ts
git commit -m "feat(desktop): runScenario execution chain with rollback"
```

---

## Task 5: ScenarioRunSheet(做同款三段式)

**Files:**
- Create: `src/components/Scenario/ScenarioRunSheet.tsx`

**Interfaces:**
- Consumes: `VariableForm`(workpaw-ui),`runScenario`,`useChatStore.agents`(校验 agent 可用),`Scenario`。
- Produces: `ScenarioRunSheet` props `{ scenario: Scenario | null; onClose: () => void }`。打开时:预览(描述+示例对话+Agent/模型)+ 变量表单 + `[做同款]` 主按钮。agent 不可用 → 顶部黄色提示 + 按钮置灰。

- [ ] **Step 1: 写失败测试 — 渲染 + agent 不可用提示**

Create `src/components/Scenario/ScenarioRunSheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenarioRunSheet } from "./ScenarioRunSheet";
import type { Scenario } from "workpaw-ui";

vi.mock("@/stores/useChatStore", () => ({
  useChatStore: (sel: any) => sel({ agents: [{ id: "a1", name: "助手", enabled: true }] }),
}));

const s = {
  id: "1", slug: "x", title: "总结文档", description: "上传文档生成摘要",
  category: "分析", icon: "FileText", agent_id: "a1", agent_name: "助手",
  model_preset: { provider_id: "p", model: "qwen" }, prompt_template: "总结 {{doc}}",
  variables: [{ key: "doc", label: "文档", type: "file", required: true }],
  example_dialogue: [{ role: "user", content: "总结这份报告" }, { role: "assistant", content: "要点:..." }],
  sort_order: 1, enabled: true, source: "official",
} as Scenario;

describe("ScenarioRunSheet", () => {
  it("renders preview, variables, and 做同款 button", () => {
    render(<ScenarioRunSheet scenario={s} onClose={() => {}} />);
    expect(screen.getByText("总结文档")).toBeInTheDocument();
    expect(screen.getByText("总结这份报告")).toBeInTheDocument();
    expect(screen.getByText("文档*")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /做同款/ })).not.toBeDisabled();
  });

  it("shows 需启用 hint and disables button when agent missing", () => {
    const s2 = { ...s, agent_id: "missing" } as Scenario;
    render(<ScenarioRunSheet scenario={s2} onClose={() => {}} />);
    expect(screen.getByText(/需启用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /做同款/ })).toBeDisabled();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- ScenarioRunSheet`
Expected: FAIL — `undefined ScenarioRunSheet`。

- [ ] **Step 3: 实现 ScenarioRunSheet**

Create `src/components/Scenario/ScenarioRunSheet.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { VariableForm } from "workpaw-ui";
import { Bot, User } from "lucide-react";
import type { Scenario } from "workpaw-ui";
import { useChatStore } from "@/stores/useChatStore";
import { runScenario } from "./runScenario";

export function ScenarioRunSheet({ scenario, onClose }: { scenario: Scenario | null; onClose: () => void }) {
  const agents = useChatStore((s) => s.agents);
  const [values, setValues] = useState<Record<string, string | File | undefined>>({});
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const agentUnavailable = useMemo(() => {
    if (!scenario) return false;
    if (!scenario.agent_id) return false; // 无指定 agent 视为可用(用默认)
    return !agents.some((a) => a.id === scenario.agent_id && a.enabled);
  }, [scenario, agents]);

  if (!scenario) return null;

  const onRun = async () => {
    setRunning(true); setErr(null);
    await runScenario(scenario, values, {
      validate: (sc, vals) => sc.variables.filter((v) => v.required && !vals[v.key]).map((v) => v.label),
      onError: (m) => { setErr(m); setRunning(false); },
    });
    if (!err) onClose(); // 成功则关闭(若 onError 已触发,err 非空则保持开)
    setRunning(false);
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[440px] sm:max-w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{scenario.title}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 p-4 text-sm">
          {agentUnavailable && (
            <div className="rounded-md bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
              此场景需要「{scenario.agent_name || "Agent"}」,请到 Web 配置启用后再使用。
            </div>
          )}
          <p className="text-muted-foreground">{scenario.description}</p>
          <div className="text-xs text-muted-foreground">
            分类 {scenario.category} · Agent {scenario.agent_name || "—"} · 模型 {scenario.model_preset?.model ?? "默认"}
          </div>
          {scenario.example_dialogue.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              {scenario.example_dialogue.map((t, i) => (
                <div key={i} className="flex gap-2">
                  {t.role === "user" ? <User className="size-4 shrink-0" /> : <Bot className="size-4 shrink-0 text-primary" />}
                  <span>{t.content}</span>
                </div>
              ))}
            </div>
          )}
          {scenario.variables.length > 0 && (
            <VariableForm
              variables={scenario.variables}
              values={values}
              onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
            />
          )}
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={onRun} disabled={agentUnavailable || running}>
            {running ? "执行中…" : "✨ 做同款"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- ScenarioRunSheet`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/components/Scenario/ScenarioRunSheet.tsx src/components/Scenario/ScenarioRunSheet.test.tsx
git commit -m "feat(desktop): ScenarioRunSheet preview + variable form + run"
```

---

## Task 6: ScenarioGallerySheet(完整画廊)

**Files:**
- Create: `src/components/Scenario/ScenarioGallerySheet.tsx`

**Interfaces:**
- Consumes: `useScenarioStore`,`ScenarioCard`,`ScenarioRunSheet`。
- Produces: `ScenarioGallerySheet` props `{ open: boolean; onOpenChange: (o: boolean) => void }`。内含分类 tab + 搜索 + 网格;点卡片→打开 `ScenarioRunSheet`;点"做同款"→直接打开 RunSheet(无变量也可,RunSheet 内执行)。

- [ ] **Step 1: 写失败测试 — 渲染分类 + 搜索过滤**

Create `src/components/Scenario/ScenarioGallerySheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScenarioGallerySheet } from "./ScenarioGallerySheet";
import { useScenarioStore } from "@/stores/useScenarioStore";
import type { Scenario } from "workpaw-ui";

vi.mock("@/stores/useChatStore", () => ({ useChatStore: (sel: any) => sel({ agents: [] }) }));

const mk = (id: string, title: string, cat: string): Scenario => ({
  id, slug: id, title, description: "d", category: cat, icon: "FileText",
  agent_id: "", agent_name: "", model_preset: null, prompt_template: "p",
  variables: [], example_dialogue: [], sort_order: 1, enabled: true, source: "official",
} as Scenario);

describe("ScenarioGallerySheet", () => {
  beforeEach(() => {
    useScenarioStore.setState({
      scenarios: [mk("1", "总结文档", "写作"), mk("2", "SQL生成", "代码")],
      loading: false, error: null,
    });
  });

  it("renders categories and cards, filters by search", async () => {
    render(<ScenarioGallerySheet open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("总结文档")).toBeInTheDocument());
    expect(screen.getByText("SQL生成")).toBeInTheDocument();
    await userEvent.setup().type(screen.getByPlaceholderText("搜索场景…"), "SQL");
    expect(screen.queryByText("总结文档")).not.toBeInTheDocument();
    expect(screen.getByText("SQL生成")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- ScenarioGallerySheet`
Expected: FAIL — `undefined ScenarioGallerySheet`。

- [ ] **Step 3: 实现 GallerySheet**

Create `src/components/Scenario/ScenarioGallerySheet.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useScenarioStore } from "@/stores/useScenarioStore";
import { useChatStore } from "@/stores/useChatStore";
import type { Scenario } from "workpaw-ui";
import { ScenarioCard } from "./ScenarioCard";
import { ScenarioRunSheet } from "./ScenarioRunSheet";

const CATEGORIES = ["全部", "写作", "分析", "代码", "办公", "运营", "客服", "知识"];

export function ScenarioGallerySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const scenarios = useScenarioStore((s) => s.scenarios);
  const error = useScenarioStore((s) => s.error);
  const agents = useChatStore((s) => s.agents);
  const [tab, setTab] = useState("全部");
  const [query, setQuery] = useState("");
  const [runTarget, setRunTarget] = useState<Scenario | null>(null);

  const filtered = useMemo(() => {
    return scenarios.filter((s) => {
      const okCat = tab === "全部" || s.category === tab;
      const okQ = !query || s.title.includes(query) || s.slug.includes(query);
      return okCat && okQ;
    });
  }, [scenarios, tab, query]);

  const agentUnavailable = (s: Scenario) =>
    !!s.agent_id && !agents.some((a) => a.id === s.agent_id && a.enabled);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[640px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>场景库</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 p-4">
            <input
              className="h-9 w-full rounded-md border px-3 text-sm"
              placeholder="搜索场景…" value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <Button key={c} variant={tab === c ? "default" : "outline"} size="sm"
                  onClick={() => setTab(c)} className="h-7 text-xs">{c}</Button>
              ))}
            </div>
            {error && <p className="text-sm text-muted-foreground">场景加载失败,请稍后重试。</p>}
            {!error && filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">暂无场景</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {filtered.map((s) => (
                <ScenarioCard
                  key={s.id}
                  scenario={s}
                  agentUnavailable={agentUnavailable(s)}
                  onRun={() => setRunTarget(s)}
                  onPreview={() => setRunTarget(s)}
                />
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <ScenarioRunSheet scenario={runTarget} onClose={() => setRunTarget(null)} />
    </>
  );
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- ScenarioGallerySheet`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/components/Scenario/ScenarioGallerySheet.tsx src/components/Scenario/ScenarioGallerySheet.test.tsx
git commit -m "feat(desktop): ScenarioGallerySheet with categories + search"
```

---

## Task 7: WelcomeScreen 改造(空状态画廊 + 降级)

**Files:**
- Modify: `src/components/Chat/MessageList.tsx`(WelcomeScreen 部分)

**Interfaces:**
- Consumes: `useScenarioStore.topForWelcome`,`ScenarioCard`,`ScenarioRunSheet`。
- Produces: 有场景 → 显示 6 卡画廊 + "浏览全部场景→"(打开 GallerySheet,需上层传入 onOpenGallery);无场景/失败 → 回退现有 3 chip。

- [ ] **Step 1: 写失败测试 — 有场景显示卡片,无场景回退 chip**

Create `src/components/Chat/WelcomeScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WelcomeScreen } from "../Chat/MessageList";
import { useScenarioStore } from "@/stores/useScenarioStore";
import type { Scenario } from "workpaw-ui";

vi.mock("@/stores/useChatStore", () => ({ useChatStore: (sel: any) => sel({ agents: [] }) }));
vi.mock("workpaw-ui", async () => {
  const actual = await vi.importActual("workpaw-ui");
  return { ...actual };
});

const mk = (id: string, title: string): Scenario => ({
  id, slug: id, title, description: "d", category: "写作", icon: "FileText",
  agent_id: "", agent_name: "", model_preset: null, prompt_template: "p",
  variables: [], example_dialogue: [], sort_order: 1, enabled: true, source: "official",
} as Scenario);

describe("WelcomeScreen", () => {
  beforeEach(() => {
    useScenarioStore.setState({ scenarios: [], loading: false, error: null });
  });

  it("shows scenario cards when scenarios exist", () => {
    useScenarioStore.setState({ scenarios: [mk("1", "总结文档"), mk("2", "起草邮件")] });
    render(<WelcomeScreen onOpenGallery={() => {}} />);
    expect(screen.getByText("总结文档")).toBeInTheDocument();
    expect(screen.getByText("起草邮件")).toBeInTheDocument();
    expect(screen.queryByText("总结这份文档")).not.toBeInTheDocument(); // 旧 chip 不出现
  });

  it("falls back to example chips when no scenarios", () => {
    render(<WelcomeScreen onOpenGallery={() => {}} />);
    expect(screen.getByText("总结这份文档")).toBeInTheDocument();
    expect(screen.queryByText("浏览全部场景")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- WelcomeScreen`
Expected: FAIL — `WelcomeScreen` 不接受 `onOpenGallery` props / 无画廊逻辑。

- [ ] **Step 3: 改造 WelcomeScreen**

在 `MessageList.tsx` 中:
(a) 顶部 import 加:
```tsx
import { useScenarioStore } from "@/stores/useScenarioStore";
import { ScenarioCard } from "@/components/Scenario/ScenarioCard";
import { ScenarioRunSheet } from "@/components/Scenario/ScenarioRunSheet";
import { useState } from "react";
```
(b) 把现有 `WelcomeScreen` 改为接受 props 并加画廊逻辑:

```tsx
function WelcomeScreen({ onOpenGallery }: { onOpenGallery: () => void }) {
  const controller = usePromptInputController();
  const topScenarios = useScenarioStore((s) => s.topForWelcome(6));
  const [runTarget, setRunTarget] = useState<import("workpaw-ui").Scenario | null>(null);
  const agents = useChatStore((s) => s.agents);

  const fillExample = (prompt: string) => {
    controller.textInput.setInput(prompt);
  };

  const hasScenarios = topScenarios.length > 0;
  const examples = ["总结这份文档", "帮我起草一封邮件", "解释这个表格的数据"];

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Bot className="size-8" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">你好,我是你的 AI 助手</h2>
        <p className="text-sm text-muted-foreground">
          {hasScenarios ? "从一个场景开始,或直接提问 ↓" : "直接在下方输入问题就行"}
        </p>
        <WelcomeHint />
      </div>

      {hasScenarios ? (
        <>
          <div className="grid w-full max-w-2xl grid-cols-3 gap-3">
            {topScenarios.map((s) => (
              <ScenarioCard
                key={s.id}
                scenario={s}
                agentUnavailable={!!s.agent_id && !agents.some((a) => a.id === s.agent_id && a.enabled)}
                onRun={() => setRunTarget(s)}
                onPreview={() => setRunTarget(s)}
              />
            ))}
          </div>
          <button
            onClick={onOpenGallery}
            className="text-sm text-primary hover:underline"
          >
            浏览全部场景 →
          </button>
          <ScenarioRunSheet scenario={runTarget} onClose={() => setRunTarget(null)} />
        </>
      ) : (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {examples.map((prompt) => (
            <button key={prompt} onClick={() => fillExample(prompt)}
              className="rounded-full border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
              {prompt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

(c) 修改 WelcomeScreen 的调用处(`messages.length === 0` 分支,约 55 行),传入 `onOpenGallery`。由于 MessageList 不持有 gallery 开关,需从 ChatPage 透传:`MessageList` 增加 `onOpenGallery` prop,ChatPage 把 header 的 gallery 状态传下来。

调整 `MessageList` 签名(在组件 props 解构处加 `onOpenGallery`),并在空状态渲染处:
```tsx
if (messages.length === 0) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto">
      <WelcomeScreen onOpenGallery={onOpenGallery} />
    </div>
  );
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- WelcomeScreen`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/components/Chat/MessageList.tsx src/components/Chat/WelcomeScreen.test.tsx
git commit -m "feat(desktop): WelcomeScreen scenario gallery with chip fallback"
```

---

## Task 8: Chat header [✨场景] 按钮 + fetchScenarios 触发

**Files:**
- Modify: `src/pages/Chat.tsx`

**Interfaces:**
- Consumes: `useScenarioStore.fetchScenarios`,`ScenarioGallerySheet`。
- Produces: header 加 `[✨场景]` 按钮(打开 GallerySheet);组件挂载时触发 `fetchScenarios`;把 gallery 开关状态透传给 MessageList。

- [ ] **Step 1: 写失败测试 — 按钮存在 + 触发 fetch**

Create `src/pages/Chat.scenario.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatPage } from "./Chat";
import { useScenarioStore } from "@/stores/useScenarioStore";
import { useChatStore } from "@/stores/useChatStore";
import { useInstanceStore } from "@/stores/useInstanceStore";

vi.mock("@/components/Chat/SessionSidebar", () => ({ SessionSidebar: () => <div /> }));
vi.mock("@/components/Chat/MessageList", () => ({
  MessageList: (props: any) => <div data-testid="ml" onClick={props.onOpenGallery}>ml</div>,
}));
vi.mock("@/components/Chat/ChatInput", () => ({ default: () => <div /> }));

describe("ChatPage scenario button", () => {
  beforeEach(() => {
    useChatStore.setState({ podUrl: "http://x", podToken: "t" } as any);
    useInstanceStore.setState({ instance: { status: "running", ingress_url: "u", api_token: "t" } as any });
  });

  it("renders 场景 button and triggers fetchScenarios on mount", () => {
    const fetchSpy = vi.spyOn(useScenarioStore.getState(), "fetchScenarios").mockResolvedValue(undefined);
    render(<ChatPage />);
    expect(screen.getByRole("button", { name: /场景/ })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- Chat.scenario`
Expected: FAIL — 无"场景"按钮 / 无 fetchScenarios 调用。

- [ ] **Step 3: 改造 ChatPage**

在 `Chat.tsx`:
(a) import 加:
```tsx
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useScenarioStore } from "@/stores/useScenarioStore";
import { ScenarioGallerySheet } from "@/components/Scenario/ScenarioGallerySheet";
```
(b) 在 `ChatPage` 内加状态与 effect:
```tsx
const [galleryOpen, setGalleryOpen] = useState(false);
const fetchScenarios = useScenarioStore((s) => s.fetchScenarios);
useEffect(() => { fetchScenarios(); }, [fetchScenarios]);
```
(c) header 的按钮区(`AgentSelector`/`ModelSelector`/新建按钮之间)加:
```tsx
<Button onClick={() => setGalleryOpen(true)} variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
  <Sparkles className="size-3.5" />
  <span>场景</span>
</Button>
```
(d) `<MessageList />` 改为 `<MessageList onOpenGallery={() => setGalleryOpen(true)} />`。
(e) 在 `PromptInputProvider` 闭合前加:
```tsx
<ScenarioGallerySheet open={galleryOpen} onOpenChange={setGalleryOpen} />
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- Chat.scenario`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/pages/Chat.tsx src/pages/Chat.scenario.test.tsx
git commit -m "feat(desktop): chat header scenario button + fetch on mount"
```

---

## Task 9: `/` 斜杠命令接入场景

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx`

**Interfaces:**
- Consumes: `useScenarioStore.scenarios`。
- Produces: `SLASH_COMMANDS` 在 `/clear` `/compact` 之后动态追加场景命令(`/场景标题`);选中场景命令 → 把 `prompt_template`(含 `{{占位符}}`)填入输入框。场景为空时不追加。

- [ ] **Step 1: 写失败测试 — 场景命令填入输入框**

Create `src/components/Chat/ChatInput.scenario.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatInput from "./ChatInput";
import { useScenarioStore } from "@/stores/useScenarioStore";

vi.mock("@/stores/useChatStore", () => ({
  useChatStore: () => ({ sendMessage: vi.fn(), streaming: false, podUrl: "http://x" }),
}));
vi.mock("@/lib/podApi", () => ({ uploadFile: vi.fn() }));

describe("ChatInput slash scenarios", () => {
  beforeEach(() => {
    useScenarioStore.setState({
      scenarios: [{
        id: "1", slug: "summarize", title: "总结文档", description: "", category: "写作",
        icon: "", agent_id: "", agent_name: "", model_preset: null,
        prompt_template: "请总结:{{doc}}", variables: [{ key: "doc", label: "文档", type: "file", required: true }],
        example_dialogue: [], sort_order: 1, enabled: true, source: "official",
      }],
      loading: false, error: null,
    });
  });

  it("typing / shows scenario command, selecting fills prompt template", async () => {
    const user = userEvent.setup();
    render(<ChatInput />);
    const textarea = screen.getByPlaceholderText(/输入你的问题/);
    await user.type(textarea, "/");
    await waitFor(() => expect(screen.getByText(/总结文档/)).toBeInTheDocument());
    await user.click(screen.getByText(/总结文档/));
    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toContain("请总结:{{doc}}"));
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- ChatInput.scenario`
Expected: FAIL — 场景命令未注入。

- [ ] **Step 3: 改造 ChatInput 斜杠命令**

在 `ChatInput.tsx`:
(a) import 加 `useScenarioStore`:
```tsx
import { useScenarioStore } from "@/stores/useScenarioStore";
```
(b) 把 `SLASH_COMMANDS` 从模块常量改为组件内动态构建(或保留常量 + 组件内 concat)。在组件内:
```tsx
const scenarios = useScenarioStore((s) => s.scenarios);
const scenarioCommands = scenarios.map((s) => ({
  command: `/${s.title}`,
  description: `场景: ${s.description || s.title}`,
  value: s.prompt_template, // 选中后填入的是模板(含占位符)
}));
const allCommands = [
  { command: "/clear", description: "清除对话历史", value: "/clear" },
  { command: "/compact", description: "压缩对话上下文", value: "/compact" },
  ...scenarioCommands,
];
```
(c) 斜杠建议下拉用 `allCommands` 替换原 `SLASH_COMMANDS`;选中场景命令时,填入 `value`(=prompt_template)到输入框(而非 sendMessage)。在选中处理逻辑里判断:若 `value` 以 `/` 开头且是 `/clear`/`/compact` → 走原命令逻辑;否则(场景模板)→ `controller.textInput.setInput(value)` 填入,不发送。

具体:在现有选中命令的处理处(原 `sendMessage(text)` 那段),改为:
```tsx
const cmd = allCommands.find((c) => c.value === trimmed || c.command === trimmed);
if (cmd) {
  if (cmd.value === "/clear" || cmd.value === "/compact") {
    // 保留原有 TODO 行为(发送原文本)
    sendMessage(text);
    return;
  }
  // 场景模板:填入输入框,不发送
  controller.textInput.setInput(cmd.value);
  return;
}
```
注:`controller` 来自 `usePromptInputController()`(ChatInput 已有)。`setInput` 方法已用于 WelcomeScreen 的 fillExample,签名一致。

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- ChatInput.scenario`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/components/Chat/ChatInput.tsx src/components/Chat/ChatInput.scenario.test.tsx
git commit -m "feat(desktop): slash command injects scenario prompt templates"
```

---

## Task 10: 全量验证 + build

**Files:** 无新文件,验证整体。

- [ ] **Step 1: 全量测试**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test`
Expected: 全 PASS(含既有测试不回归)。

- [ ] **Step 2: build**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm run build`
Expected: build 成功。

- [ ] **Step 3: 手测清单(交付前)**

- 端到端:启动 control-plane(含 Plan 1 seed)→ desktop 启动 → 空状态显示 6 卡 → 点"做同款" → 填变量 → 新会话正确切 Agent/Model → 流式输出。
- 降级:断 control-plane → 空状态回退 3 chip、chat 正常、`[✨场景]` Sheet 显示"场景加载失败"。
- 防御:场景引用未启用 agent → 卡片置灰"需启用" → RunSheet 黄色提示 + 按钮置灰。
- 斜杠:输入 `/` → 见场景命令 → 选中 → 输入框填入模板(含 `{{占位符}}`)。
- 视觉:Signal Orange ≤10% 面积、扁平无阴影、暗色模式可读、reduced-motion 降级。

- [ ] **Step 4: 最终 Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add -A
git commit -m "test(desktop): scenario gallery full test pass + build green"
```

---

## Self-Review (Plan 3)

**Spec coverage:**
- §5 desktop 数据层(scenarioApi + useScenarioStore)→ Task 1/2 ✓
- §6 空状态画廊(6 卡 + 降级回退 chip)→ Task 7 ✓
- §6.2 卡片克制视觉 → Task 3 ✓
- §7 画廊 Sheet(分类 tab + 搜索)→ Task 6 ✓
- §8 做同款三段式(预览+变量+执行)→ Task 5 + Task 4 ✓
- §8.2 执行链(新建会话+切Agent+切Model+渲染+发送)→ Task 4 ✓
- §8.3 / §10.3 执行链失败回滚 → Task 4 try/catch + deleteSession ✓
- §9 `/` 斜杠接入场景 → Task 9 ✓
- §10.1 加载失败降级 → Task 2(不抛)+ Task 7(回退 chip)+ Task 6(空态)✓
- §10.2 agent 不可用置灰 + 提示 → Task 3 + Task 5 ✓
- §10.4 变量渲染异常(保留占位符)→ Task 4 renderPrompt ✓
- §10.5 模型预设失效 → Task 4 setActiveModel 失败触发 catch 回滚 ✓
- header [✨场景] 持久入口 + fetchScenarios → Task 8 ✓

**Placeholder scan:** 所有 step 含完整代码;无 TBD;手测清单为明确步骤非占位。

**Type consistency:** `Scenario` 类型从 workpaw-ui 引入(Task 1),全程一致;`runScenario(scenario, values, opts)` 签名 Task 4 定义、Task 5 消费一致;`VariableForm` props(Task 3 Plan 2 定义)`{variables, values, onChange, disabled?}` 与 Task 5/7 消费一致;`useChatStore` 的 `createSession`/`setSelectedAgent`/`sendMessage`/`deleteSession`/`agents` 均为现有 API(探查确认)。

**依赖:** Plan 2 的 `VariableForm` 从 `workpaw-ui` 导入(Task 5/7 import);Plan 1 的 `/api/scenarios` 返回 `{scenarios:[]}` 由 Task 1 解包 ✓。

**风险点(已标注):**
- Task 7 改造 WelcomeScreen 需透传 `onOpenGallery` 到 MessageList,涉及改 MessageList 签名 + ChatPage 传参,链路在 Task 8 闭合。
- Task 9 斜杠命令的 `controller.textInput.setInput` 依赖 PromptInputProvider 上下文(ChatInput 已在 Provider 内),签名与 WelcomeScreen fillExample 一致。
- Task 4 的 `podApi.uploadFile` 返回字段(`url`/`stored_name`/`file_name`)依据探查(podApi.ts:216),若实际字段名有出入,执行时按 podApi.ts 实际类型对齐。
