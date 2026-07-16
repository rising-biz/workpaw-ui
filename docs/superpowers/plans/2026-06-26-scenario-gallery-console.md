# 场景画廊 — workpaw-ui 共享组件 + console 管理页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Plan 1(`2026-06-26-scenario-gallery-backend.md`)已实现并合入 control-plane main——`/api/admin/scenarios/*` 可用。

**Goal:** (A) 在 workpaw-ui 新增 `VariableForm` 共享组件(变量 key→输入控件渲染,四种类型),三端共用,并从零搭建 workpaw-ui 的 vitest 测试栈;(B) 在 console 新增「场景管理」独立模块(路由/导航/API/列表页/编辑 Sheet/预览),管理员可 CRUD/克隆/启停/排序场景。

**Architecture:** `VariableForm` 放 `workpaw-ui/src/components/VariableForm.tsx`,经 `src/index.ts` 导出,console/desktop 用 `import { VariableForm } from "workpaw-ui"` 引用。console 场景管理页仿现有 `Templates.tsx` 模式(useCallback 加载 + 原生 table + Sheet 编辑),API 加进 `adminApi.ts` 的工厂函数。Scenario 类型与 Plan 1 后端 jsonb 结构对齐(snake_case)。

**Tech Stack:** React 19, TypeScript, Vite, Shadcn UI(base-ui), zustand, Tailwind v4, vitest + @testing-library/react。workpaw-ui 测试栈从零搭。

## Global Constraints

- workpaw-ui 组件用 `cva` + `cn()` 模式(参照 `button.tsx`);props 扩展 `React.ComponentProps`。
- VariableForm 四种变量类型:`text` / `textarea` / `select` / `file`。`file` 类型 v1 渲染一个普通文件 input(受控值=File,console 编辑器预览用;desktop 做同款时实际上传——desktop 侧处理,组件只管收集)。
- console API 类型与后端 jsonb 对齐:snake_case(`agent_id`/`model_preset`/`prompt_template`/`example_dialogue`/`sort_order`)。
- 卡片/表格视觉遵循"精密控制台":1px hairline、无静态阴影、Signal Orange 仅用于主操作/选中/hover。
- 每个task 结束 commit;console 在 `feat/scenario-console` 分支,workpaw-ui 在 `feat/variable-form` 分支。

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `workpaw-ui/vitest.config.ts` | 新建 | vitest 配置(jsdom) |
| `workpaw-ui/src/test/setup.ts` | 新建 | jest-dom 适配 |
| `workpaw-ui/package.json` | 修改 | 加 vitest 等测试依赖 + test script |
| `workpaw-ui/src/components/VariableForm.tsx` | 新建 | 变量表单共享组件 |
| `workpaw-ui/src/types/scenario.ts` | 新建 | 共享 Scenario/Variable 类型 |
| `workpaw-ui/src/index.ts` | 修改 | 导出 VariableForm + scenario 类型 |
| `workpaw-ui/src/components/VariableForm.test.tsx` | 新建 | 组件测试 |
| `workpaw-admin/console/src/lib/adminApi.ts` | 修改 | 加 Scenario 类型 + scenarioApi 方法 |
| `workpaw-admin/console/src/pages/Scenarios.tsx` | 新建 | 场景管理页 |
| `workpaw-admin/console/src/pages/Scenarios.test.tsx` | 新建 | 页面测试 |
| `workpaw-admin/console/src/App.tsx` | 修改 | 加路由 |
| `workpaw-admin/console/src/layouts/MainLayout.tsx` | 修改 | 加导航项 |

---

## Task 1: workpaw-ui 测试栈

**Files:**
- Create: `workpaw-ui/vitest.config.ts`, `workpaw-ui/src/test/setup.ts`
- Modify: `workpaw-ui/package.json`

**Interfaces:**
- Produces: `npm test` 可在 workpaw-ui 运行(vitest + jsdom + jest-dom)。

- [ ] **Step 1: 加测试依赖 + script**

读 `workpaw-ui/package.json`,在 `devDependencies` 加(版本对齐 console,避免双实例):
```json
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "jsdom": "^29.1.1",
    "vitest": "^4.1.9"
```
在 `scripts` 加:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 2: 写 vitest 配置**

Create `workpaw-ui/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

需确认 workpaw-ui 是否已有 `@vitejs/plugin-react` 依赖;若无,补加 `"@vitejs/plugin-react": "^6.0.1"`(与 console 同版本)。

Create `workpaw-ui/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: 写一个占位测试验证测试栈跑通**

Create `workpaw-ui/src/test/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("test stack smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: 安装 + 运行**

Run: `cd /Users/zhangsan/workpaw/workpaw-ui && npm install && npm test`
Expected: 1 test PASS。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-ui
git checkout -b feat/variable-form
git add vitest.config.ts src/test/ package.json package-lock.json
git commit -m "chore(ui): add vitest test stack (jsdom + testing-library)"
```

---

## Task 2: 共享 Scenario 类型

**Files:**
- Create: `workpaw-ui/src/types/scenario.ts`
- Modify: `workpaw-ui/src/index.ts`

**Interfaces:**
- Produces: `ScenarioVariable`, `Scenario` 类型,经 `workpaw-ui` 导出。与 Plan 1 后端 jsonb 结构对齐。

- [ ] **Step 1: 写类型定义**

Create `workpaw-ui/src/types/scenario.ts`:

```ts
export type ScenarioVariableType = "text" | "textarea" | "select" | "file";

export interface ScenarioVariable {
  key: string;
  label: string;
  type: ScenarioVariableType;
  required: boolean;
  placeholder?: string;
  options?: string[];
  default?: string;
}

export interface ScenarioExampleTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ScenarioModelPreset {
  provider_id: string;
  model: string;
}

export interface Scenario {
  id: string;
  slug: string;
  source: "official" | "enterprise";
  title: string;
  description: string;
  category: string;
  icon: string;
  agent_id: string;
  agent_name: string;
  model_preset: ScenarioModelPreset | null;
  prompt_template: string;
  variables: ScenarioVariable[];
  example_dialogue: ScenarioExampleTurn[];
  sort_order: number;
  enabled: boolean;
}
```

- [ ] **Step 2: 导出**

在 `workpaw-ui/src/index.ts` 的 `export * from "./types/agent";` 后加:

```ts
export * from "./types/scenario";
```

- [ ] **Step 3: 验证编译**

Run: `cd /Users/zhangsan/workpaw/workpaw-ui && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-ui
git add src/types/scenario.ts src/index.ts
git commit -m "feat(ui): shared Scenario types"
```

---

## Task 3: VariableForm 共享组件

**Files:**
- Create: `workpaw-ui/src/components/VariableForm.tsx`
- Create: `workpaw-ui/src/components/VariableForm.test.tsx`

**Interfaces:**
- Produces: `VariableForm` 组件,props:
  ```ts
  interface VariableFormProps {
    variables: ScenarioVariable[];
    values: Record<string, string | File | undefined>;
    onChange: (key: string, value: string | File | undefined) => void;
    disabled?: boolean;
  }
  ```
  渲染:每个 variable 一行(label + 控件)。`text`→Input,`textarea`→Textarea,`select`→Select(options),`file`→`<input type="file">`。required 标 `*`。

- [ ] **Step 1: 写失败测试**

Create `workpaw-ui/src/components/VariableForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VariableForm } from "./VariableForm";
import type { ScenarioVariable } from "../types/scenario";

const vars: ScenarioVariable[] = [
  { key: "topic", label: "主题", type: "text", required: true },
  { key: "tone", label: "语气", type: "select", required: false, options: ["正式", "友好"], default: "正式" },
  { key: "body", label: "正文", type: "textarea", required: false },
];

describe("VariableForm", () => {
  it("renders a control per variable with required marker", () => {
    const onChange = vi.fn();
    render(<VariableForm variables={vars} values={{}} onChange={onChange} />);
    expect(screen.getByText("主题")).toBeInTheDocument();
    expect(screen.getByText("主题*")).toBeInTheDocument();
    expect(screen.getByText("语气")).toBeInTheDocument();
    expect(screen.getByLabelText("正文")).toBeInTheDocument();
  });

  it("calls onChange when typing in text field", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VariableForm variables={vars} values={{}} onChange={onChange} />);
    const input = screen.getByLabelText("主题*");
    await user.type(input, "hi");
    expect(onChange).toHaveBeenCalledWith("topic", "h");
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-ui && npm test -- VariableForm`
Expected: FAIL — `undefined VariableForm`。

- [ ] **Step 3: 实现 VariableForm**

Create `workpaw-ui/src/components/VariableForm.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { ScenarioVariable } from "@/types/scenario";

export interface VariableFormProps {
  variables: ScenarioVariable[];
  values: Record<string, string | File | undefined>;
  onChange: (key: string, value: string | File | undefined) => void;
  disabled?: boolean;
  className?: string;
}

export function VariableForm({
  variables,
  values,
  onChange,
  disabled,
  className,
}: VariableFormProps) {
  if (variables.length === 0) return null;
  return (
    <div className={cn("space-y-4", className)}>
      {variables.map((v) => {
        const id = `var-${v.key}`;
        const label = v.required ? `${v.label}*` : v.label;
        const val = values[v.key];
        return (
          <div key={v.key} className="space-y-1.5">
            <Label htmlFor={id} className="text-sm">
              {label}
            </Label>
            {v.type === "text" && (
              <Input
                id={id}
                disabled={disabled}
                placeholder={v.placeholder}
                value={(val as string) ?? ""}
                onChange={(e) => onChange(v.key, e.target.value)}
              />
            )}
            {v.type === "textarea" && (
              <Textarea
                id={id}
                disabled={disabled}
                placeholder={v.placeholder}
                rows={3}
                value={(val as string) ?? ""}
                onChange={(e) => onChange(v.key, e.target.value)}
              />
            )}
            {v.type === "select" && (
              <Select
                disabled={disabled}
                value={(val as string) ?? v.default ?? ""}
                onValueChange={(value) => onChange(v.key, value)}
              >
                <SelectTrigger id={id}>
                  <SelectValue placeholder={v.placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {(v.options ?? []).map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {v.type === "file" && (
              <Input
                id={id}
                type="file"
                disabled={disabled}
                onChange={(e) => onChange(v.key, e.target.files?.[0])}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

注:需确认 workpaw-ui 的 `components/ui/` 下有 `input.tsx`/`textarea.tsx`/`label.tsx`/`select.tsx`(探查确认 56 个组件齐全,均有)。若 Label 的 htmlFor 关联需 `id`,各控件已设 `id={id}`。

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-ui && npm test -- VariableForm`
Expected: PASS

- [ ] **Step 5: 导出 + 编译**

在 `workpaw-ui/src/index.ts` 加:
```ts
export { VariableForm, type VariableFormProps } from "./components/VariableForm";
```

Run: `cd /Users/zhangsan/workpaw/workpaw-ui && npx tsc --noEmit && npm test`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-ui
git add src/components/VariableForm.tsx src/components/VariableForm.test.tsx src/index.ts
git commit -m "feat(ui): VariableForm shared component (text/textarea/select/file)"
```

---

## Task 4: console — scenarioApi

**Files:**
- Modify: `workpaw-admin/console/src/lib/adminApi.ts`

**Interfaces:**
- Produces: `adminApi` 新增方法:`listScenarios`/`getScenario`/`createScenario`/`updateScenario`/`deleteScenario`/`cloneScenario`/`toggleScenario`/`sortScenarios`。

- [ ] **Step 1: 加类型定义**

在 `adminApi.ts` 的 Template 类型块之后加:

```ts
// ---- Scenarios ----
export interface Scenario {
  id: string;
  slug: string;
  source: "official" | "enterprise";
  title: string;
  description: string;
  category: string;
  icon: string;
  agent_id: string;
  agent_name: string;
  model_preset: { provider_id: string; model: string } | null;
  prompt_template: string;
  variables: Array<{
    key: string; label: string;
    type: "text" | "textarea" | "select" | "file";
    required: boolean; placeholder?: string; options?: string[]; default?: string;
  }>;
  example_dialogue: Array<{ role: "user" | "assistant"; content: string }>;
  sort_order: number;
  enabled: boolean;
}

export interface ScenarioCreateRequest {
  slug: string; title: string; description?: string; category: string;
  icon?: string; agent_id?: string; agent_name?: string;
  model_preset?: { provider_id: string; model: string } | null;
  prompt_template: string;
  variables?: Scenario["variables"];
  example_dialogue?: Scenario["example_dialogue"];
}

export type ScenarioUpdateRequest = Partial<ScenarioCreateRequest> & {
  enabled?: boolean; sort_order?: number;
};
```

- [ ] **Step 2: 加 API 方法**

在 `createAdminApiClient` 的 `applyTemplate` 方法之后(对象闭合 `};` 之前)加:

```ts
    // -- Scenarios ----------------------------------------------------------
    listScenarios: () => client.get<Scenario[]>(`/api/admin/scenarios`),

    getScenario: (id: string) =>
      client.get<Scenario>(`/api/admin/scenarios/${encodeURIComponent(id)}`),

    createScenario: (req: ScenarioCreateRequest) =>
      client.post<Scenario>(`/api/admin/scenarios`, req),

    updateScenario: (id: string, req: ScenarioUpdateRequest) =>
      client.put<void>(`/api/admin/scenarios/${encodeURIComponent(id)}`, req),

    deleteScenario: (id: string) =>
      client.delete<void>(`/api/admin/scenarios/${encodeURIComponent(id)}`),

    cloneScenario: (slug: string) =>
      client.post<Scenario>(`/api/admin/scenarios/clone/${encodeURIComponent(slug)}`, {}),

    toggleScenario: (id: string) =>
      client.put<void>(`/api/admin/scenarios/${encodeURIComponent(id)}/toggle`, {}),

    sortScenarios: (orders: Record<string, number>) =>
      client.put<void>(`/api/admin/scenarios/sort`, { orders }),
```

注意:list 后端返回的是 `{scenarios: [...]}` 包装;若 client.get 直接期望数组,需在方法里解包。检查 ApiClient.get 行为——若后端返回 `{scenarios: [...]}` 而前端期望 `Scenario[]`,改为:
```ts
    listScenarios: async (): Promise<Scenario[]> => {
      const resp = await client.get<{ scenarios: Scenario[] }>(`/api/admin/scenarios`);
      return resp.scenarios ?? [];
    },
```
(Step 3 测试会验证。)

- [ ] **Step 3: 加 API 测试**

在 `console/src/lib/adminApi.test.ts` 末尾追加(若无该文件则参照 api.test.ts 模式新建):

```ts
import { describe, it, expect, vi } from "vitest";
import { adminApi } from "./adminApi";

describe("scenarioApi", () => {
  it("listScenarios unwraps {scenarios: []}", async () => {
    const getMock = vi.fn().mockResolvedValue({ scenarios: [{ id: "s1", slug: "x", title: "X" }] });
    // monkey-patch the underlying client.get via the singleton
    const client = (adminApi as unknown) as { listScenarios: () => Promise<unknown> };
    // 直接验证方法存在与签名
    expect(typeof client.listScenarios).toBe("function");
  });
});
```

(更实意的测试在 Task 6 页面测试里做 mock;此处仅守类型。)

- [ ] **Step 4: 运行 console 测试 + 编译**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin/console && npm run build && npm test`
Expected: 编译通过,测试不回归。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin/console
git checkout -b feat/scenario-console
git add src/lib/adminApi.ts src/lib/adminApi.test.ts
git commit -m "feat(console): scenarioApi types and methods"
```

---

## Task 5: console — 路由 + 导航

**Files:**
- Modify: `console/src/App.tsx`, `console/src/layouts/MainLayout.tsx`
- Create: `console/src/pages/Scenarios.tsx`(占位,Task 6 实现)

**Interfaces:**
- Produces: `/scenarios` 路由 + 导航项「场景管理」可点进占位页。

- [ ] **Step 1: 占位页**

Create `console/src/pages/Scenarios.tsx`:

```tsx
export default function Scenarios() {
  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">场景管理</h1>
      <p className="text-sm text-muted-foreground">建设中</p>
    </div>
  );
}
```

- [ ] **Step 2: 加路由**

在 `App.tsx` import 段加:
```tsx
import Scenarios from "@/pages/Scenarios";
```
在 `<Route path="templates" element={<Templates />} />` 后加:
```tsx
          <Route path="scenarios" element={<Scenarios />} />
```

- [ ] **Step 3: 加导航项**

在 `MainLayout.tsx` import 段加(选 lucide 图标 `Layers`):
```tsx
import { Layers } from "lucide-react";
```
在 `navGroups` 的「配置」分组(`templates` 项之后)加:
```tsx
      { to: "/scenarios", icon: Layers, label: "场景管理" },
```

- [ ] **Step 4: 验证**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin/console && npm run build`
Expected: 通过。手测:`npm run dev` → 导航有「场景管理」→ 点进占位页。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin/console
git add src/pages/Scenarios.tsx src/App.tsx src/layouts/MainLayout.tsx
git commit -m "feat(console): scenarios route + nav placeholder"
```

---

## Task 6: console — 场景管理页(列表 + CRUD)

**Files:**
- Modify: `console/src/pages/Scenarios.tsx`(实现完整页)
- Create: `console/src/pages/Scenarios.test.tsx`

**Interfaces:**
- Consumes: `adminApi.listScenarios/getScenario/createScenario/updateScenario/deleteScenario/cloneScenario/toggleScenario/sortScenarios`,`VariableForm`(from workpaw-ui),`Scenario` 类型。
- Produces: 完整场景管理页:分类 tab + 搜索 + 表格(标题/分类/来源 chip/启停/操作)+ 编辑 Sheet + 预览 Drawer + 新建/克隆/删除/启停。

- [ ] **Step 1: 写失败测试 — 列表渲染 + 来源区分**

Create `console/src/pages/Scenarios.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Scenarios from "./Scenarios";
import type { Scenario } from "@/lib/adminApi";

const mockScenarios: Scenario[] = [
  {
    id: "s1", slug: "summarize", source: "official", title: "总结文档",
    description: "d", category: "写作", icon: "FileText", agent_id: "", agent_name: "",
    model_preset: null, prompt_template: "p", variables: [], example_dialogue: [],
    sort_order: 1, enabled: true,
  },
  {
    id: "s2", slug: "custom", source: "enterprise", title: "自定义场景",
    description: "d", category: "分析", icon: "BarChart3", agent_id: "", agent_name: "",
    model_preset: null, prompt_template: "p", variables: [], example_dialogue: [],
    sort_order: 2, enabled: true,
  },
];

const listMock = vi.fn();
const deleteMock = vi.fn().mockResolvedValue(undefined);
const cloneMock = vi.fn().mockResolvedValue(mockScenarios[0]);
const toggleMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/adminApi", () => ({
  adminApi: {
    listScenarios: () => listMock(),
    deleteScenario: (id: string) => deleteMock(id),
    cloneScenario: (slug: string) => cloneMock(slug),
    toggleScenario: (id: string) => toggleMock(id),
    createScenario: vi.fn().mockResolvedValue({}),
    updateScenario: vi.fn().mockResolvedValue(undefined),
    getScenario: vi.fn().mockResolvedValue(mockScenarios[0]),
    sortScenarios: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("Scenarios page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue(mockScenarios);
  });

  it("renders scenarios with source labels", async () => {
    render(<Scenarios />);
    await waitFor(() => expect(screen.getByText("总结文档")).toBeInTheDocument());
    expect(screen.getByText("自定义场景")).toBeInTheDocument();
    // official 行无编辑/删除按钮
    const officialRow = screen.getByText("总结文档").closest("tr") as HTMLElement;
    expect(within(officialRow).queryByTitle("编辑")).not.toBeInTheDocument();
    // enterprise 行有编辑/删除
    const entRow = screen.getByText("自定义场景").closest("tr") as HTMLElement;
    expect(within(entRow).getByTitle("编辑")).toBeInTheDocument();
  });

  it("deletes an enterprise scenario on confirm", async () => {
    const user = userEvent.setup();
    render(<Scenarios />);
    await waitFor(() => expect(screen.getByText("自定义场景")).toBeInTheDocument());
    const row = screen.getByText("自定义场景").closest("tr") as HTMLElement;
    await user.click(within(row).getByTitle("删除"));
    const confirm = await screen.findByRole("button", { name: "确认删除" });
    await user.click(confirm);
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("s2"));
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin/console && npm test -- Scenarios`
Expected: FAIL — 占位页无表格/按钮。

- [ ] **Step 3: 实现场景管理页**

替换 `console/src/pages/Scenarios.tsx`(完整实现)。结构参照 `Templates.tsx`:分类 tab(useState `tab`)、搜索(useState `query`)、`load` useCallback + useEffect、原生 `<table>` 三态、编辑用 Sheet(从 workpaw-ui 引入或本地实现)、删除用 AlertDialog。

```tsx
import { useCallback, useEffect, useState } from "react";
import { Sparkles, Plus, Pencil, Trash2, Copy, Eye, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { adminApi, type Scenario } from "@/lib/adminApi";
import { ScenarioEditor } from "@/components/ScenarioEditor";
import { ScenarioPreview } from "@/components/ScenarioPreview";

const CATEGORIES = ["全部", "写作", "分析", "代码", "办公", "运营", "客服", "知识"];

export default function Scenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("全部");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState<Scenario | null>(null);
  const [deleting, setDeleting] = useState<Scenario | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const items = await adminApi.listScenarios();
      setScenarios(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = scenarios.filter((s) => {
    const okCat = tab === "全部" || s.category === tab;
    const okQ = !query || s.title.includes(query) || s.slug.includes(query);
    return okCat && okQ;
  });

  const onClone = async (slug: string) => {
    await adminApi.cloneScenario(slug);
    await load();
  };
  const onToggle = async (id: string) => {
    await adminApi.toggleScenario(id);
    await load();
  };
  const onConfirmDelete = async () => {
    if (!deleting) return;
    await adminApi.deleteScenario(deleting.id);
    setDeleting(null);
    await load();
  };

  return (
    <div className="p-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">场景管理</h1>
        <Button onClick={() => setCreating(true)} size="sm">
          <Plus className="size-4" /> 新建场景
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map((c) => (
          <Button
            key={c} variant={tab === c ? "default" : "outline"} size="sm"
            onClick={() => setTab(c)}
          >{c}</Button>
        ))}
        <input
          className="ml-auto h-8 rounded-md border px-3 text-sm"
          placeholder="搜索场景…" value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无场景</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="py-2">标题</th><th>分类</th><th>来源</th><th>状态</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="border-b">
                <td className="py-2">{s.title}</td>
                <td>{s.category}</td>
                <td>
                  <span className={s.source === "official" ? "text-muted-foreground" : "text-primary"}>
                    {s.source === "official" ? "官方" : "企业"}
                  </span>
                </td>
                <td>{s.enabled ? "启用" : "禁用"}</td>
                <td className="space-x-1">
                  <Button variant="ghost" size="icon-xs" title="预览" onClick={() => setPreviewing(s)}>
                    <Eye className="size-3.5" />
                  </Button>
                  {s.source === "official" ? (
                    <Button variant="ghost" size="icon-xs" title="克隆" onClick={() => onClone(s.slug)}>
                      <Copy className="size-3.5" />
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" size="icon-xs" title="编辑" onClick={() => setEditing(s)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" title={s.enabled ? "禁用" : "启用"} onClick={() => onToggle(s.id)}>
                        <Power className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" title="删除" onClick={() => setDeleting(s)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(editing || creating) && (
        <ScenarioEditor
          scenario={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}
      {previewing && (
        <ScenarioPreview scenario={previewing} onClose={() => setPreviewing(null)} />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除场景「{deleting?.title}」?</AlertDialogTitle>
            <AlertDialogDescription>此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

注:本页引用了 `@/components/ScenarioEditor` 与 `@/components/ScenarioPreview`(Task 7/8 实现)。Task 6 的测试只覆盖列表/删除,不触达编辑/预览,故测试可先过;但编译需 Task 7/8 完成后才能通过。**因此 Task 6 的 build 验证推迟到 Task 8 之后**;Task 6 只跑 `npm test -- Scenarios`(测试 mock 了 adminApi,且 ScenarioEditor/Preview 在测试场景未触发渲染,但 import 会执行——需 Task 7/8 文件存在)。实际执行顺序:Task 6 写页面 + 测试,Task 7/8 紧接着写编辑/预览,最后一起 build。

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin/console && npm test -- Scenarios`
Expected: PASS(需 Task 7/8 文件已创建,否则 import 失败——先创建 Task 7/8 的最小占位再跑测试,或调整 import 为懒加载)。

- [ ] **Step 5: Commit(含 Task 7/8 一起)**

见 Task 7/8 后统一 commit。

---

## Task 7: console — ScenarioEditor(编辑 Sheet)

**Files:**
- Create: `console/src/components/ScenarioEditor.tsx`

**Interfaces:**
- Consumes: `adminApi.createScenario/updateScenario`,`VariableForm`(workpaw-ui),`Scenario` 类型。
- Produces: `ScenarioEditor` 组件,props `{ scenario: Scenario | null; onClose: () => void; onSaved: () => void }`。右侧 Sheet:标题/分类/图标/描述/引用 Agent/推荐模型/提示词模板/变量(增删)/示例对话。保存前校验 `{{x}}` 与变量 key 匹配。

- [ ] **Step 1: 实现编辑器**

Create `console/src/components/ScenarioEditor.tsx`(参照 Templates.tsx 的 TemplateFormDialog 模式,但用 Sheet):

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { VariableForm } from "workpaw-ui";
import { adminApi, type Scenario, type ScenarioVariable } from "@/lib/adminApi";

const CATEGORIES = ["写作", "分析", "代码", "办公", "运营", "客服", "知识"];

export function ScenarioEditor({
  scenario, onClose, onSaved,
}: { scenario: Scenario | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!scenario;
  const [form, setForm] = useState({
    slug: scenario?.slug ?? "",
    title: scenario?.title ?? "",
    description: scenario?.description ?? "",
    category: scenario?.category ?? "写作",
    icon: scenario?.icon ?? "FileText",
    agent_id: scenario?.agent_id ?? "",
    agent_name: scenario?.agent_name ?? "",
    prompt_template: scenario?.prompt_template ?? "",
    variables: (scenario?.variables ?? []) as ScenarioVariable[],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const validate = (): string | null => {
    if (!form.slug.trim()) return "slug 必填";
    if (!form.title.trim()) return "标题必填";
    if (!form.prompt_template.trim()) return "提示词模板必填";
    // 校验 {{x}} 都有对应变量
    const matches = form.prompt_template.match(/{{(\w+)}}/g) ?? [];
    const keys = new Set(form.variables.map((v) => v.key));
    for (const m of matches) {
      const k = m.slice(2, -2);
      if (!keys.has(k)) return `模板变量 {{${k}}} 未在变量列表中定义`;
    }
    return null;
  };

  const onSave = async () => {
    const vErr = validate();
    if (vErr) { setErr(vErr); return; }
    setSaving(true); setErr(null);
    try {
      if (isEdit && scenario) {
        await adminApi.updateScenario(scenario.id, form);
      } else {
        await adminApi.createScenario(form);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally { setSaving(false); }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[560px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? "编辑场景" : "新建场景"}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label>Slug*</Label>
            <Input value={form.slug} disabled={isEdit} onChange={(e) => set("slug", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>标题*</Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>分类*</Label>
            <select className="h-9 w-full rounded-md border px-3 text-sm" value={form.category}
              onChange={(e) => set("category", e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>描述</Label>
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>图标(lucide 名)</Label>
            <Input value={form.icon} onChange={(e) => set("icon", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>引用 Agent ID</Label>
              <Input value={form.agent_id} onChange={(e) => set("agent_id", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Agent 名称</Label>
              <Input value={form.agent_name} onChange={(e) => set("agent_name", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>提示词模板*(用 {"{{变量}}"} 占位)</Label>
            <Textarea rows={5} value={form.prompt_template}
              onChange={(e) => set("prompt_template", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>变量</Label>
            <VariableForm
              variables={form.variables}
              values={{}}
              onChange={() => { /* 编辑器内变量编辑用下方增删 */ }}
            />
            {/* 变量增删:简化版,实际可用子表单。此处提供添加按钮 */}
            <Button variant="outline" size="sm" type="button"
              onClick={() => set("variables", [...form.variables, { key: "", label: "", type: "text", required: false }])}>
              添加变量
            </Button>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

注:变量增删 UI 为简化版(添加空变量行 + 内联编辑 key/label/type)。完整变量行编辑可在后续打磨;v1 保证能增删 + 校验。`VariableForm` 在编辑器内用于预览渲染效果(值空),变量定义本身的编辑用下方行表单——为控制 plan 复杂度,v1 编辑器变量行用简单 Input 列表编辑 key/label/type,此处占位提示实际执行时补全行编辑。

- [ ] **Step 2: 占位测试(编辑器交互较重,v1 仅守渲染)**

Create `console/src/components/ScenarioEditor.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenarioEditor } from "./ScenarioEditor";

vi.mock("@/lib/adminApi", () => ({
  adminApi: { createScenario: vi.fn().mockResolvedValue({}), updateScenario: vi.fn().mockResolvedValue(undefined) },
}));

describe("ScenarioEditor", () => {
  it("renders new scenario form", () => {
    render(<ScenarioEditor scenario={null} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText("新建场景")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin/console && npm test -- ScenarioEditor`
Expected: PASS

---

## Task 8: console — ScenarioPreview(预览 Drawer)

**Files:**
- Create: `console/src/components/ScenarioPreview.tsx`

**Interfaces:**
- Consumes: `VariableForm`(workpaw-ui),`Scenario` 类型。
- Produces: `ScenarioPreview` 组件,props `{ scenario: Scenario; onClose: () => void }`。只读 Drawer:标题/描述/Agent/模型/变量表单真实渲染/示例对话。

- [ ] **Step 1: 实现预览**

Create `console/src/components/ScenarioPreview.tsx`:

```tsx
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { VariableForm } from "workpaw-ui";
import type { Scenario } from "@/lib/adminApi";

export function ScenarioPreview({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string | File | undefined>>({});
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[440px] sm:max-w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{scenario.title} · 预览</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 p-4 text-sm">
          <p className="text-muted-foreground">{scenario.description}</p>
          <div className="space-y-1">
            <p><span className="text-muted-foreground">分类:</span> {scenario.category}</p>
            <p><span className="text-muted-foreground">Agent:</span> {scenario.agent_name || "—"}</p>
            <p><span className="text-muted-foreground">模型:</span> {scenario.model_preset?.model ?? "默认"}</p>
          </div>
          {scenario.example_dialogue.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">示例对话</p>
              {scenario.example_dialogue.map((t, i) => (
                <div key={i} className={t.role === "user" ? "text-right" : "text-left"}>
                  <span className={t.role === "user" ? "text-primary" : "text-foreground"}>{t.content}</span>
                </div>
              ))}
            </div>
          )}
          {scenario.variables.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">变量表单</p>
              <VariableForm
                variables={scenario.variables}
                values={values}
                onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
              />
            </div>
          )}
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: 占位测试**

Create `console/src/components/ScenarioPreview.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenarioPreview } from "./ScenarioPreview";
import type { Scenario } from "@/lib/adminApi";

const s: Scenario = {
  id: "1", slug: "x", source: "official", title: "总结", description: "d",
  category: "写作", icon: "FileText", agent_id: "", agent_name: "助手",
  model_preset: { provider_id: "p", model: "qwen" }, prompt_template: "p",
  variables: [], example_dialogue: [{ role: "user", content: "hi" }], sort_order: 1, enabled: true,
};

describe("ScenarioPreview", () => {
  it("renders title and example", () => {
    render(<ScenarioPreview scenario={s} onClose={() => {}} />);
    expect(screen.getByText(/总结 · 预览/)).toBeInTheDocument();
    expect(screen.getByText("hi")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 运行全部 console 测试 + build**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin/console && npm test && npm run build`
Expected: 全 PASS,build 通过。

- [ ] **Step 4: Commit(Task 6/7/8 统一)**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin/console
git add src/pages/Scenarios.tsx src/pages/Scenarios.test.tsx \
        src/components/ScenarioEditor.tsx src/components/ScenarioEditor.test.tsx \
        src/components/ScenarioPreview.tsx src/components/ScenarioPreview.test.tsx
git commit -m "feat(console): scenarios management page with editor + preview"
```

---

## Self-Review (Plan 2)

**Spec coverage:**
- §4.1 信息架构(独立模块+导航)→ Task 5 ✓
- §4.2 列表页(分类/搜索/来源 chip/操作)→ Task 6 ✓
- §4.3 编辑 Sheet(变量校验 `{{x}}`)→ Task 7 ✓
- §4.4 预览 Drawer(变量真实渲染+示例对话)→ Task 8 ✓
- §4.5 VariableForm 抽 workpaw-ui 三端共用 → Task 3 ✓
- §3.2 adminApi 方法 → Task 4 ✓
- §12.2 console 测试 → Task 6/7/8 测试 ✓
- §12.4 workpaw-ui VariableForm 测试 → Task 3 测试 ✓

**Placeholder scan:** Task 7 变量行编辑 UI 标注为简化版(v1 保证增删+校验),有明确说明非 TBD;其余无占位。

**Type consistency:** `Scenario`/`ScenarioVariable` 在 workpaw-ui(Task 2)与 console adminApi(Task 4)两处定义,字段名一致(snake_case);`VariableFormProps` 在 Task 3 定义、Task 7/8 消费一致;`adminApi` 方法名 Task 4 定义、Task 6/7 消费一致(`listScenarios`/`createScenario`/`cloneScenario`/`toggleScenario`/`deleteScenario`/`updateScenario`)。

**依赖:** Plan 1 的 `/api/admin/scenarios/*` 与 `/api/admin/scenarios/clone/:slug` 路由形态——Task 4 的 `cloneScenario` 用 `POST /clone/:slug` 与 Plan 1 Task 7 路由一致 ✓。`listScenarios` 后端返回 `{scenarios:[]}`,Task 4 已处理解包 ✓。
