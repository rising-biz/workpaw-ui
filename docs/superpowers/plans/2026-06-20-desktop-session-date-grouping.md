# 桌面端会话列表按日期分组 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 workpaw-desktop 会话列表按会话年龄递进的日期分组（最近层按天展开、3天~1月按天、1月~1年 月→日、>1年 年→月→日），并保留独立的「置顶」分组。

**Architecture:** 新增纯函数 `groupSessionsByDate(sessions, now)` 把扁平会话列表变换为分组树；新增递归组件 `SessionGroup` 渲染分组节点；`SessionSidebar` 用两个 override Set 管理折叠状态。`useChatStore` 不改动（仍返回扁平排序数组），分组是纯视图变换。搜索时退化为扁平列表。

**Tech Stack:** React 19、TypeScript（strict）、date-fns v4 + `date-fns/locale` 的 `zhCN`、zustand、shadcn/ui、lucide-react、Tauri 2。

## Global Constraints

- 桌面端第一版只支持中文，文案使用硬编码中文（不引入 i18next）。
- 日期处理只用已安装的 `date-fns` v4 + `zhCN`；不引入新依赖。
- 不引入测试框架（无 vitest/jest）；纯函数用 Node 内置 TS 执行（`node --experimental-strip-types`）的零依赖验证脚本校验，非测试框架。
- `useChatStore.ts` 不改动；分组是纯视图变换。
- 遵循现有 `SessionSidebar` 的硬编码中文风格与 `cn` 工具（`@/lib/utils`）。
- Node 版本 v22.16（支持 `--experimental-strip-types` 运行 `.ts`）。

## 前置准备（Git）

桌面仓库 `workpaw-desktop` 当前在 `main` 且有 WIP 改动。开始前切到 feature 分支：

```bash
git -C /Users/zhangsan/workpaw/workpaw-desktop checkout -b feat/desktop-session-date-grouping
```

> 若你希望继续在 `main` 或其他分支，跳过此步即可，下方提交命令会提交到当前分支。每个 Task 结尾都会提交，仅 `git add` 该 Task 涉及的文件，避免误带无关 WIP（`SessionSidebar.tsx` 本身已有 WIP，其改动会一并提交，属同一功能区域，可接受）。

## File Structure

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `src/lib/sessionGrouping.ts` | 新增 | 纯函数 `groupSessionsByDate` + `GroupNode`/`GroupResult` 类型 + label/path 工具；运行时仅依赖 `date-fns` |
| `scripts/verify-session-grouping.ts` | 新增 | 零依赖验证脚本（Node 内置 TS 执行），断言各层级分组结构 |
| `src/components/Chat/SessionGroup.tsx` | 新增 | 递归渲染 `GroupNode`；导出 `GroupHeader` 供置顶/未知区复用 |
| `src/components/Chat/SessionSidebar.tsx` | 修改 | 引入分组树、折叠状态、置顶/未知区；搜索态扁平化；复用 `SessionItem` |

---

### Task 1: 分组纯函数 `groupSessionsByDate`

**Files:**
- Create: `workpaw-desktop/src/lib/sessionGrouping.ts`
- Create: `workpaw-desktop/scripts/verify-session-grouping.ts`

**Interfaces:**
- Consumes: `type { Session } from "@/stores/useChatStore"`（仅类型导入，运行时擦除）；`date-fns` 的 `subMonths/subYears/subDays/isSameDay/format` 与 `date-fns/locale` 的 `zhCN`。
- Produces:
  - `export type GroupKind = "day" | "month" | "year"`
  - `export interface GroupNode { key: string; label: string; kind: GroupKind; depth: number; count: number; defaultExpanded: boolean; sessions: Session[]; children?: GroupNode[] }`
  - `export interface GroupResult { pinned: Session[]; groups: GroupNode[]; unknown: Session[] }`
  - `export function groupSessionsByDate(sessions: Session[], now: Date): GroupResult`

- [ ] **Step 1: 写 `src/lib/sessionGrouping.ts`**

```ts
import {
  subMonths,
  subYears,
  subDays,
  isSameDay,
  format,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import type { Session } from "@/stores/useChatStore";

// ---------------------------------------------------------------------------
// 会话列表按日期分组
//
// 以 now 为基准，按会话年龄递进分组粒度：
//   最近层（今天/昨天/前天）：按天，默认展开
//   3 天 ~ 1 个月：按天
//   1 个月 ~ 1 年：月 → 日
//   超过 1 年：年 → 月 → 日
// 置顶会话与无时间字段会话由调用方单独渲染（见 GroupResult）。
// ---------------------------------------------------------------------------

export type GroupKind = "day" | "month" | "year";

export interface GroupNode {
  key: string;
  label: string;
  kind: GroupKind;
  depth: number;
  count: number;
  defaultExpanded: boolean;
  sessions: Session[];      // day 叶子节点有值
  children?: GroupNode[];   // month / year 分支节点有值
}

export interface GroupResult {
  pinned: Session[];
  groups: GroupNode[];
  unknown: Session[];
}

/** 解析会话时间字段；优先 updated_at，回退 created_at；均无效返回 null。 */
function sessionDate(s: Session): Date | null {
  const raw = s.updated_at ?? s.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

interface Seg {
  key: string;
  label: string;
  kind: GroupKind;
}

/** 是否落在最近层（今天/昨天/前天）。 */
function isRecent(date: Date, now: Date): boolean {
  return (
    isSameDay(date, now) ||
    isSameDay(date, subDays(now, 1)) ||
    isSameDay(date, subDays(now, 2))
  );
}

/** 计算一个日期在分组树中的路径（root → leaf 段）。 */
function pathFor(date: Date, now: Date): Seg[] {
  const yKey = format(date, "yyyy");
  const ymKey = format(date, "yyyy-MM");
  const ymdKey = format(date, "yyyy-MM-dd");
  const sameYear = date.getFullYear() === now.getFullYear();
  const dayLabel = sameYear
    ? format(date, "M月d日", { locale: zhCN })
    : format(date, "yyyy年M月d日", { locale: zhCN });

  // 最近层：今天 / 昨天 / 前天（单层天叶子，默认展开）
  if (isRecent(date, now)) {
    const label = isSameDay(date, now)
      ? "今天"
      : isSameDay(date, subDays(now, 1))
        ? "昨天"
        : "前天";
    return [{ key: `d:${ymdKey}`, label, kind: "day" }];
  }

  // 3 天 ~ 1 个月：按天
  if (date >= subMonths(now, 1)) {
    return [{ key: `d:${ymdKey}`, label: dayLabel, kind: "day" }];
  }

  // 1 个月 ~ 1 年：月 → 日
  if (date >= subYears(now, 1)) {
    return [
      { key: `m:${ymKey}`, label: format(date, "yyyy年M月", { locale: zhCN }), kind: "month" },
      { key: `m:${ymKey}/d:${ymdKey}`, label: dayLabel, kind: "day" },
    ];
  }

  // 超过 1 年：年 → 月 → 日
  return [
    { key: `y:${yKey}`, label: format(date, "yyyy年", { locale: zhCN }), kind: "year" },
    { key: `y:${yKey}/m:${ymKey}`, label: format(date, "M月", { locale: zhCN }), kind: "month" },
    { key: `y:${yKey}/m:${ymKey}/d:${ymdKey}`, label: dayLabel, kind: "day" },
  ];
}

/** 节点子树内最新会话时间，用于排序（newest-first）。 */
function nodeTime(node: GroupNode): number {
  let max = 0;
  for (const s of node.sessions) {
    const t = sessionDate(s)?.getTime() ?? 0;
    if (t > max) max = t;
  }
  if (node.children) {
    for (const c of node.children) {
      const t = nodeTime(c);
      if (t > max) max = t;
    }
  }
  return max;
}

function sortNodes(nodes: GroupNode[]): GroupNode[] {
  return nodes
    .map((n) => (n.children ? { ...n, children: sortNodes(n.children) } : n))
    .sort((a, b) => nodeTime(b) - nodeTime(a));
}

/** 主入口：将会话列表按日期分组。now 通常传 new Date()；测试可传固定值。 */
export function groupSessionsByDate(sessions: Session[], now: Date): GroupResult {
  const pinned: Session[] = [];
  const unknown: Session[] = [];
  const dated: Session[] = [];

  for (const s of sessions) {
    if (s.pinned) {
      pinned.push(s);
      continue;
    }
    if (!sessionDate(s)) {
      unknown.push(s);
      continue;
    }
    dated.push(s);
  }

  // 按时间倒序，保证插入后同层顺序稳定
  dated.sort((a, b) => (sessionDate(b)?.getTime() ?? 0) - (sessionDate(a)?.getTime() ?? 0));

  const byKey = new Map<string, GroupNode>();
  const topOrder: GroupNode[] = [];

  const ensureNode = (segs: Seg[]): GroupNode => {
    let parentChildren: GroupNode[] | undefined = undefined;
    let cur: GroupNode | undefined = undefined;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      let node = byKey.get(seg.key);
      if (!node) {
        node = {
          key: seg.key,
          label: seg.label,
          kind: seg.kind,
          depth: i,
          count: 0,
          defaultExpanded: false,
          sessions: [],
          children: seg.kind === "day" ? undefined : [],
        };
        byKey.set(seg.key, node);
        if (parentChildren) parentChildren.push(node);
        else if (!topOrder.includes(node)) topOrder.push(node);
      }
      parentChildren = node.children;
      cur = node;
    }
    return cur!;
  };

  for (const s of dated) {
    const d = sessionDate(s)!;
    const segs = pathFor(d, now);
    const leaf = ensureNode(segs);
    leaf.sessions.push(s);
    // 最近层天叶子默认展开（segs.length===1 且 kind day 且落在最近层）
    if (segs.length === 1 && segs[0].kind === "day" && isRecent(d, now)) {
      leaf.defaultExpanded = true;
    }
  }

  // 计算 count
  const recomputeCount = (n: GroupNode): number => {
    n.count =
      n.sessions.length +
      (n.children ? n.children.reduce((acc, c) => acc + recomputeCount(c), 0) : 0);
    return n.count;
  };
  for (const t of topOrder) recomputeCount(t);

  const groups = sortNodes(topOrder);

  // pinned / unknown 排序（按时间倒序，空值置后）
  const byUpdatedDesc = (a: Session, b: Session) =>
    (b.updated_at ? new Date(b.updated_at).getTime() : 0) -
    (a.updated_at ? new Date(a.updated_at).getTime() : 0);
  pinned.sort(byUpdatedDesc);
  unknown.sort(
    (a, b) =>
      (b.created_at ? new Date(b.created_at).getTime() : 0) -
      (a.created_at ? new Date(a.created_at).getTime() : 0),
  );

  return { pinned, groups, unknown };
}
```

- [ ] **Step 2: 写验证脚本 `scripts/verify-session-grouping.ts`**

```ts
// 零依赖验证脚本（Node 内置 TS 执行，非测试框架）。
// 运行: node --experimental-strip-types scripts/verify-session-grouping.ts
import assert from "node:assert/strict";
import { groupSessionsByDate } from "../src/lib/sessionGrouping.ts";

type MockSession = {
  id: string;
  session_id: string;
  user_id: string;
  channel: string;
  name?: string;
  created_at: string | null;
  updated_at: string | null;
  pinned?: boolean;
};

const now = new Date("2026-06-20T12:00:00");

const mk = (
  id: string,
  updated: string | null,
  name: string,
  opts: Partial<MockSession> = {},
): MockSession => ({
  id,
  session_id: `sid:${id}`,
  user_id: "default",
  channel: "console",
  name,
  created_at: updated,
  updated_at: updated,
  ...opts,
});

const sessions: MockSession[] = [
  mk("s1", "2026-06-20T10:00:00", "今天A"),
  mk("s2", "2026-06-19T10:00:00", "昨天A"),
  mk("s3", "2026-06-18T10:00:00", "前天A"),
  mk("s4", "2026-06-15T10:00:00", "0615A"), // 3 天~1 月
  mk("s5", "2026-05-10T10:00:00", "0510A"), // 1 月~1 年
  mk("s6", "2025-12-30T10:00:00", "2025A"), // >1 年
  mk("s7", "2026-06-10T10:00:00", "置顶A", { pinned: true }),
  mk("s8", null, "未知A", { created_at: null }),
];

const result = groupSessionsByDate(sessions as unknown as Parameters<typeof groupSessionsByDate>[0], now);

// pinned
assert.equal(result.pinned.length, 1, "pinned count");
assert.equal(result.pinned[0].id, "s7", "pinned id");

// unknown
assert.equal(result.unknown.length, 1, "unknown count");
assert.equal(result.unknown[0].id, "s8", "unknown id");

// top-level groups order & shape
const g = result.groups;
assert.equal(g.length, 6, "top-level group count");

assert.equal(g[0].key, "d:2026-06-20", "g0 key");
assert.equal(g[0].label, "今天", "g0 label");
assert.equal(g[0].defaultExpanded, true, "g0 expanded");
assert.equal(g[0].depth, 0, "g0 depth");
assert.equal(g[0].count, 1, "g0 count");
assert.equal(g[0].sessions[0].id, "s1", "g0 session");

assert.equal(g[1].label, "昨天", "g1 label");
assert.equal(g[1].defaultExpanded, true, "g1 expanded");
assert.equal(g[2].label, "前天", "g2 label");
assert.equal(g[2].defaultExpanded, true, "g2 expanded");

assert.equal(g[3].label, "6月15日", "g3 label");
assert.equal(g[3].defaultExpanded, false, "g3 collapsed");
assert.equal(g[3].kind, "day", "g3 kind");

// month tier (1 月~1 年)
assert.equal(g[4].key, "m:2026-05", "g4 key");
assert.equal(g[4].label, "2026年5月", "g4 label");
assert.equal(g[4].kind, "month", "g4 kind");
assert.equal(g[4].defaultExpanded, false, "g4 collapsed");
assert.equal(g[4].depth, 0, "g4 depth");
assert.equal(g[4].children!.length, 1, "g4 children");
const mday = g[4].children![0];
assert.equal(mday.key, "m:2026-05/d:2026-05-10", "g4c key");
assert.equal(mday.label, "5月10日", "g4c label");
assert.equal(mday.depth, 1, "g4c depth");
assert.equal(mday.defaultExpanded, false, "g4c collapsed");
assert.equal(mday.sessions[0].id, "s5", "g4c session");

// year tier (>1 年)
assert.equal(g[5].key, "y:2025", "g5 key");
assert.equal(g[5].label, "2025年", "g5 label");
assert.equal(g[5].kind, "year", "g5 kind");
assert.equal(g[5].defaultExpanded, false, "g5 collapsed");
const ym = g[5].children![0];
assert.equal(ym.key, "y:2025/m:2025-12", "g5c key");
assert.equal(ym.label, "12月", "g5c label");
assert.equal(ym.depth, 1, "g5c depth");
const yd = ym.children![0];
assert.equal(yd.key, "y:2025/m:2025-12/d:2025-12-30", "g5cc key");
assert.equal(yd.label, "12月30日", "g5cc label");
assert.equal(yd.depth, 2, "g5cc depth");
assert.equal(yd.sessions[0].id, "s6", "g5cc session");

console.log("PASS: session grouping verification");
```

- [ ] **Step 3: 运行验证脚本，确认通过**

Run:
```bash
cd /Users/zhangsan/workpaw/workpaw-desktop && node --experimental-strip-types scripts/verify-session-grouping.ts
```
Expected output（出现 experimental 警告属正常）：
```
PASS: session grouping verification
```

> 若 Node strip-types 执行报错（如 `date-fns/locale` 解析问题），回退为人工核对：对照脚本中 8 条 mock 会话与断言，逐条确认 `groupSessionsByDate` 输出结构（key/label/depth/defaultExpanded/count/嵌套）与断言一致。

- [ ] **Step 4: 类型检查**

Run:
```bash
cd /Users/zhangsan/workpaw/workpaw-desktop && npx tsc
```
Expected: 无错误（`scripts/` 不在 tsconfig `include` 内，仅检查 `src/`；`src/lib/sessionGrouping.ts` 应通过）。

- [ ] **Step 5: 提交**

```bash
git -C /Users/zhangsan/workpaw/workpaw-desktop add src/lib/sessionGrouping.ts scripts/verify-session-grouping.ts
git -C /Users/zhangsan/workpaw/workpaw-desktop commit -m "feat(desktop): add session date grouping pure function

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 递归分组渲染组件 `SessionGroup`

**Files:**
- Create: `workpaw-desktop/src/components/Chat/SessionGroup.tsx`

**Interfaces:**
- Consumes: `type { GroupNode } from "@/lib/sessionGrouping"`；`type { Session } from "@/stores/useChatStore"`；`cn` from `@/lib/utils`；lucide `ChevronRightIcon`/`ChevronDownIcon`（仓库已用）。
- Produces:
  - `export function SessionGroup(props: SessionGroupProps): JSX.Element`
  - `export function GroupHeader(props: GroupHeaderProps): JSX.Element`
  - `SessionGroupProps = { node: GroupNode; isExpanded: (key: string, defaultExpanded: boolean) => boolean; onToggle: (key: string, defaultExpanded: boolean) => void; renderItem: (session: Session) => ReactNode }`
  - `GroupHeaderProps = { label: string; count: number; depth: number; expanded: boolean; onClick: () => void }`

- [ ] **Step 1: 写 `src/components/Chat/SessionGroup.tsx`**

```tsx
import type { ReactNode } from "react";
import { ChevronRightIcon, ChevronDownIcon } from "lucide-react";
import type { GroupNode } from "@/lib/sessionGrouping";
import type { Session } from "@/stores/useChatStore";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// 递归渲染分组节点。叶子天组展开后通过 renderItem 渲染会话条目。
// ---------------------------------------------------------------------------

export interface GroupHeaderProps {
  label: string;
  count: number;
  depth: number;
  expanded: boolean;
  onClick: () => void;
}

/** 分组表头：chevron + label + 计数；缩进按 depth。供分组节点与置顶/未知区复用。 */
export function GroupHeader({ label, count, depth, expanded, onClick }: GroupHeaderProps) {
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-gray-100 dark:hover:bg-gray-800",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <Chevron className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
      <span className="ml-auto text-[10px] text-muted-foreground/70">{count}</span>
    </button>
  );
}

export interface SessionGroupProps {
  node: GroupNode;
  isExpanded: (key: string, defaultExpanded: boolean) => boolean;
  onToggle: (key: string, defaultExpanded: boolean) => void;
  renderItem: (session: Session) => ReactNode;
}

export function SessionGroup({ node, isExpanded, onToggle, renderItem }: SessionGroupProps) {
  const expanded = isExpanded(node.key, node.defaultExpanded);

  return (
    <div>
      <GroupHeader
        label={node.label}
        count={node.count}
        depth={node.depth}
        expanded={expanded}
        onClick={() => onToggle(node.key, node.defaultExpanded)}
      />

      {expanded &&
        (node.children ? (
          <div>
            {node.children.map((child) => (
              <SessionGroup
                key={child.key}
                node={child}
                isExpanded={isExpanded}
                onToggle={onToggle}
                renderItem={renderItem}
              />
            ))}
          </div>
        ) : (
          <div style={{ paddingLeft: node.depth * 12 }}>
            {node.sessions.map((s) => (
              <div key={s.id}>{renderItem(s)}</div>
            ))}
          </div>
        ))}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run:
```bash
cd /Users/zhangsan/workpaw/workpaw-desktop && npx tsc
```
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git -C /Users/zhangsan/workpaw/workpaw-desktop add src/components/Chat/SessionGroup.tsx
git -C /Users/zhangsan/workpaw/workpaw-desktop commit -m "feat(desktop): add SessionGroup recursive renderer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 接入 `SessionSidebar`（折叠状态 + 置顶/未知区 + 搜索扁平化）

**Files:**
- Modify: `workpaw-desktop/src/components/Chat/SessionSidebar.tsx`

**Interfaces:**
- Consumes: `groupSessionsByDate` + `GroupResult`/`GroupNode` from `@/lib/sessionGrouping`；`SessionGroup` + `GroupHeader` from `@/components/Chat/SessionGroup`；现有 `SessionItem`、`useChatStore`、`cn`、`formatDistanceToNow`/`zhCN`。
- Produces: 修改后的 `SessionSidebar`，对外行为不变（仍是默认导出 `SessionSidebar`）。

- [ ] **Step 1: 更新 import**

在 `SessionSidebar.tsx` 顶部 import 区追加（保留现有 import 不动）：

```ts
import { groupSessionsByDate } from "@/lib/sessionGrouping";
import { SessionGroup, GroupHeader } from "@/components/Chat/SessionGroup";
```

- [ ] **Step 2: 增加折叠状态与辅助函数**

在 `SessionSidebar` 组件内，现有 `useState` 声明之后、`useEffect` 之前，加入：

```ts
const [expandedOverrides, setExpandedOverrides] = useState<Set<string>>(new Set());
const [collapsedOverrides, setCollapsedOverrides] = useState<Set<string>>(new Set());

const now = useMemo(() => new Date(), []);

const isExpanded = useCallback(
  (key: string, defaultExpanded: boolean) =>
    (defaultExpanded && !collapsedOverrides.has(key)) || expandedOverrides.has(key),
  [expandedOverrides, collapsedOverrides],
);

const onToggle = useCallback(
  (key: string, defaultExpanded: boolean) => {
    if (isExpanded(key, defaultExpanded)) {
      setExpandedOverrides((prev) => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
      setCollapsedOverrides((prev) => new Set(prev).add(key));
    } else {
      setCollapsedOverrides((prev) => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
      setExpandedOverrides((prev) => new Set(prev).add(key));
    }
  },
  [isExpanded],
);
```

- [ ] **Step 3: 计算分组树与 renderItem 闭包**

在 `filteredSessions` 的 `useMemo` 之后，加入：

```ts
const searching = searchQuery.trim().length > 0;
const grouped = useMemo(
  () => groupSessionsByDate(filteredSessions, now),
  [filteredSessions, now],
);

const renderItem = useCallback(
  (session: Session) => (
    <SessionItem
      session={session}
      isActive={currentSessionId === session.id}
      isEditing={editingId === session.id}
      editValue={editValue}
      formatTime={formatTime}
      onSelect={() => selectSession(session.id)}
      onStartRename={() => handleStartRename(session)}
      onConfirmRename={() => handleConfirmRename(session.id)}
      onCancelRename={handleCancelRename}
      onEditValueChange={setEditValue}
      onTogglePin={() => togglePinSession(session.id)}
      onDelete={() => setDeleteTarget(session.id)}
    />
  ),
  [
    currentSessionId,
    editingId,
    editValue,
    formatTime,
    selectSession,
    handleStartRename,
    handleConfirmRename,
    handleCancelRename,
    togglePinSession,
  ],
);
```

> 说明：`useMemo`、`useCallback` 已在文件顶部 import（现有代码已用）。`Session` 类型已从 `@/stores/useChatStore` import。

- [ ] **Step 4: 替换会话列表渲染块**

把现有的列表渲染块：

```tsx
{sessionsLoading && sessions.length === 0 ? (
  <div className="py-8 text-center text-xs text-muted-foreground">
    加载中...
  </div>
) : filteredSessions.length === 0 ? (
  <div className="py-8 text-center text-xs text-muted-foreground">
    {searchQuery ? "未找到匹配的会话" : "暂无对话记录"}
  </div>
) : (
  <div className="space-y-0.5">
    {filteredSessions.map((session) => (
      <SessionItem
        key={session.id}
        session={session}
        isActive={currentSessionId === session.id}
        isEditing={editingId === session.id}
        editValue={editValue}
        formatTime={formatTime}
        onSelect={() => selectSession(session.id)}
        onStartRename={() => handleStartRename(session)}
        onConfirmRename={() => handleConfirmRename(session.id)}
        onCancelRename={handleCancelRename}
        onEditValueChange={setEditValue}
        onTogglePin={() => togglePinSession(session.id)}
        onDelete={() => setDeleteTarget(session.id)}
      />
    ))}
  </div>
)}
```

替换为：

```tsx
{sessionsLoading && sessions.length === 0 ? (
  <div className="py-8 text-center text-xs text-muted-foreground">
    加载中...
  </div>
) : filteredSessions.length === 0 ? (
  <div className="py-8 text-center text-xs text-muted-foreground">
    {searchQuery ? "未找到匹配的会话" : "暂无对话记录"}
  </div>
) : searching ? (
  <div className="space-y-0.5">
    {filteredSessions.map((session) => (
      <div key={session.id}>{renderItem(session)}</div>
    ))}
  </div>
) : (
  <div className="space-y-0.5">
    {/* 置顶区 */}
    {grouped.pinned.length > 0 && (
      <div>
        <GroupHeader
          label="置顶"
          count={grouped.pinned.length}
          depth={0}
          expanded={isExpanded("pinned", true)}
          onClick={() => onToggle("pinned", true)}
        />
        {isExpanded("pinned", true) && (
          <div>
            {grouped.pinned.map((s) => (
              <div key={s.id}>{renderItem(s)}</div>
            ))}
          </div>
        )}
      </div>
    )}

    {/* 日期分组 */}
    {grouped.groups.map((node) => (
      <SessionGroup
        key={node.key}
        node={node}
        isExpanded={isExpanded}
        onToggle={onToggle}
        renderItem={renderItem}
      />
    ))}

    {/* 未知时间区 */}
    {grouped.unknown.length > 0 && (
      <div>
        <GroupHeader
          label="未知时间"
          count={grouped.unknown.length}
          depth={0}
          expanded={isExpanded("unknown", false)}
          onClick={() => onToggle("unknown", false)}
        />
        {isExpanded("unknown", false) && (
          <div>
            {grouped.unknown.map((s) => (
              <div key={s.id}>{renderItem(s)}</div>
            ))}
          </div>
        )}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: 类型检查 + 构建**

Run:
```bash
cd /Users/zhangsan/workpaw/workpaw-desktop && npx tsc
```
Expected: 无错误。

Run:
```bash
cd /Users/zhangsan/workpaw/workpaw-desktop && pnpm build
```
Expected: 构建成功（`tsc && vite build` 通过）。

- [ ] **Step 6: 人工端到端验证**

启动应用（需后端 Pod 可达）：
```bash
cd /Users/zhangsan/workpaw/workpaw-desktop && pnpm tauri dev
```
（或仅前端 `pnpm dev`，视联调需要。）

逐项核对：
- [ ] 会话列表按日期分组：今天/昨天/前天 默认展开；3 天~1 月按天且默认折叠；1 月~1 年 月→日；>1 年 年→月→日。
- [ ] 各分组表头显示 chevron + label + 计数；点击切换展开/折叠。
- [ ] 置顶会话出现在最顶部「置顶」区，默认展开；取消置顶后回到对应日期分组。
- [ ] 新建会话落入「今天」组且自动展开。
- [ ] 搜索框输入关键字 → 列表退化为扁平过滤结果；清空 → 恢复分组。
- [ ] 会话条目的重命名 / 置顶 / 删除菜单行为不变；运行中状态点不变。
- [ ] 无 `updated_at`/`created_at` 的会话归入「未知时间」区（置底，默认折叠）。
- [ ] 跨年日期 label 自动补年份（如 2025 年 12 月的会话在年分组下显示「12月」「12月30日」）。

- [ ] **Step 7: 提交**

```bash
git -C /Users/zhangsan/workpaw/workpaw-desktop add src/components/Chat/SessionSidebar.tsx
git -C /Users/zhangsan/workpaw/workpaw-desktop commit -m "feat(desktop): group sessions by date in sidebar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- 最近层（今天/昨天/前天）按天默认展开 → Task 1 `pathFor`/`isRecent` + `defaultExpanded`；Task 3 渲染。✅
- 3 天~1 月按天（默认折叠）→ Task 1 `pathFor` day 分支；`defaultExpanded` 仅最近层为 true。✅
- 1 月~1 年 月→日 → Task 1 `pathFor` month 分支；Task 2 递归渲染。✅
- >1 年 年→月→日 → Task 1 `pathFor` year 分支。✅
- 独立「置顶」区置于最顶 → Task 3 置顶区渲染。✅
- 日期字段 updated_at 回退 created_at，皆空归 unknown → Task 1 `sessionDate`。✅
- 折叠状态：最近层 + 置顶默认展开，其余折叠；override Sets → Task 3 `isExpanded`/`onToggle`。✅
- 搜索退化为扁平列表 → Task 3 `searching` 分支。✅
- `useChatStore` 不改动 → 全计划未触及 store。✅
- 不引入测试框架，纯函数用 Node strip-types 脚本 → Task 1 Step 2-3。✅
- 跨年 label 补年份 → Task 1 `dayLabel` 同年判定。✅

**2. Placeholder scan:** 无 TBD/TODO；每个代码步骤均含完整代码；命令含预期输出。✅

**3. Type consistency:**
- `GroupNode` 字段（key/label/kind/depth/count/defaultExpanded/sessions/children）在 Task 1 定义，Task 2/3 使用一致。✅
- `SessionGroupProps.isExpanded`/`onToggle` 签名 `(key, defaultExpanded) => ...` 在 Task 2 定义，Task 3 `isExpanded`/`onToggle` 一致。✅
- `GroupHeader` props 在 Task 2 定义，Task 3 置顶/未知区调用参数（label/count/depth/expanded/onClick）一致。✅
- `groupSessionsByDate(sessions, now)` 签名 Task 1 定义，Task 3 与验证脚本调用一致。✅

无问题，计划完整。
