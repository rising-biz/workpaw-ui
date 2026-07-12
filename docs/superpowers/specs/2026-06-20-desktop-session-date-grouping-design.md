# 桌面端会话列表按日期分组设计

> 日期：2026-06-20
> 状态：已确认
> 范围：workpaw-desktop

## 1. 概述与目标

桌面端（workpaw-desktop）会话列表当前为扁平列表，按「置顶优先 + `updated_at` 倒序」排序。本设计为其增加**按日期分组**能力，分组粒度随会话年龄递进，并在最顶部保留独立的「置顶」分组。

分组规则（以当前时刻 `now` 为基准）：

- **最近层（今天 / 昨天 / 前天，共 3 个日历日）**：按天成组，**默认展开**。
- **3 天 ~ 1 个月**：按天成组，默认折叠。
- **1 个月 ~ 1 年**：月 → 日 两层嵌套，默认折叠。
- **超过 1 年**：年 → 月 → 日 三层嵌套，默认折叠。

### 核心约束

- 桌面端第一版只支持中文，文案使用硬编码中文（沿用现有 `SessionSidebar` 风格，不引入 i18next）。
- 使用已安装的 `date-fns` v4 + `date-fns/locale` 的 `zhCN`。
- 分组是纯视图变换，`useChatStore` 不改动，仍返回扁平排序数组。

## 2. 现状

- 组件：`src/components/Chat/SessionSidebar.tsx`，结构为「头部（新建按钮）+ 搜索框 + 扁平 `SessionItem` 列表」。
- 数据：`Session = ChatSpec`（`src/lib/podApi.ts`），含 `updated_at: string | null`、`created_at: string | null`、`pinned?: boolean`。
- 排序：`useChatStore.loadSessions` / `togglePinSession` 中按「置顶优先 + `updated_at` 倒序」排序。
- 既有时间格式化：`SessionSidebar` 用 `formatDistanceToNow`（相对时间）；`MessageList` 有 QwenPaw 风格的 `formatMessageTime`（手动日期运算，中文注释）。
- 仓库内（web / admin / shared-ui）无任何既有日期分组工具，本设计为新增模式。

## 3. 方案选型

| 方案 | 说明 | 取舍 |
| --- | --- | --- |
| **A（采用）** | 纯函数分组工具 + 组件本地折叠状态 | 关注点分离最干净；分组逻辑可独立单测；不污染 store。折叠状态不跨重启持久化（可后加 localStorage） |
| B | 分组逻辑下沉进 store | 状态集中，但把临时视图关注点塞进全局 store，耦合更高 |
| C | 工具放进 workpaw-ui 共享包 | 便于复用，但 web/admin 当前均无会话列表（YAGNI），先放桌面端 |

采用 **方案 A**。

## 4. 数据模型

新增 `src/lib/sessionGrouping.ts`，定义纯函数与类型：

```ts
type GroupKind = "day" | "month" | "year";

interface GroupNode {
  key: string;            // 唯一路径键
  label: string;          // 今天 / 昨天 / 06-17 / 2026年5月 / 2025年 ...
  kind: GroupKind;
  depth: number;          // 缩进层级：0 / 1 / 2
  sessions: Session[];    // day 叶子节点有值
  children?: GroupNode[]; // month / year 分支节点有值
}

interface GroupResult {
  pinned: Session[];      // 置顶会话（updated_at desc）
  groups: GroupNode[];    // 日期分组（newest-first）
  unknown: Session[];     // 无任何时间字段的会话
}

// 入口纯函数
function groupSessionsByDate(sessions: Session[], now: Date): GroupResult;
```

`key` 采用带类型前缀的完整路径键，保证嵌套层级唯一、互不冲突：

- 最近层 / 3 天~1 月的天组：`d:2026-06-20`
- 1 月~1 年：月节点 `m:2026-05`，日子节点 `m:2026-05/d:2026-05-28`
- 超过 1 年：年节点 `y:2025`，月子节点 `y:2025/m:2025-12`，日孙节点 `y:2025/m:2025-12/d:2025-12-30`
- 置顶区：`pinned`
- 未知时间：`unknown`

## 5. 分组规则

**日期字段选择**：优先 `updated_at`；为 `null` 回退 `created_at`；两者皆空 → `unknown`。

**分层判定**（以 `now` 为基准，分组键按日历 Y/M/D）：

| 层级 | 判定 | 结构 | label | 默认展开 |
| --- | --- | --- | --- | --- |
| 最近层 | `updated` 落在 今天/昨天/前天（3 个日历日） | 天叶子 | 今天 / 昨天 / 前天 | 是 |
| 3 天~1 月 | `updated >= subMonths(now,1)` 且不在最近层 | 天叶子 | `M月D日`（跨年补年份） | 否 |
| 1 月~1 年 | `updated >= subYears(now,1)` 且早于 1 月 | 月分支 → 天叶子 | 月 `YYYY年M月`，日 `M月D日` | 否 |
| 超过 1 年 | 早于 1 年 | 年分支 → 月分支 → 天叶子 | 年 `YYYY年`，月 `M月`，日 `M月D日` | 否 |

**排序**：

- 组内会话按 `updated_at` 倒序（newest-first）。
- 组与组按时间 newest-first（今天 > 昨天 > 前天 > 近月天组 > 月分支 > 年分支）。
- 置顶区会话按 `updated_at` 倒序。

边界用 `date-fns` 的 `subMonths(now,1)` / `subYears(now,1)` 作为滚动窗口；最近层用日历日（今天 / 昨天 / 前天）判定。

## 6. 折叠 / 展开状态

`SessionSidebar` 本地维护两个集合：

```ts
const [expandedOverrides, setExpandedOverrides] = useState<Set<string>>(new Set());
const [collapsedOverrides, setCollapsedOverrides] = useState<Set<string>>(new Set());
```

**默认展开规则**：仅「最近层」的天组（今天/昨天/前天）与「置顶」区默认展开，其余默认折叠。

**有效展开**：

```
effectiveExpanded(key) =
  (defaultExpanded(key) && !collapsedOverrides.has(key)) || expandedOverrides.has(key)
```

切换某节点时：若当前有效展开则加入 `collapsedOverrides`，否则加入 `expandedOverrides`（保持两个集合互斥）。

**新建会话**落入「今天」组，因默认展开规则自动展开，无需特判。

## 7. 交互与渲染

- 新增 `src/components/Chat/SessionGroup.tsx`，递归渲染 `GroupNode`。
- **分组头**：chevron（▶/▼）+ label + 会话数，点击切换展开；缩进按 `depth`。
- 叶子天组展开后渲染现有 `SessionItem`（重命名 / 置顶 / 删除菜单行为不变）。
- 顺序：置顶区 → 日期分组 → 未知时间组。
- **搜索**：`searchQuery` 非空时退化为扁平列表（沿用现有过滤逻辑，不分组），避免稀疏分组。
- 加载中 / 空态文案沿用现有（`加载中...` / `未找到匹配的会话` / `暂无对话记录`）。

渲染结构示意：

```
置顶                [展开]
  📌 项目规划
▼ 今天              [展开]
   · 季度复盘
   · 招聘流程
▼ 昨天              [展开]
   · 周会纪要
▶ 06-17             [折叠]
▶ 06-15             [折叠]
▼ 2026年5月         [折叠]
   ▶ 05-28
   ▶ 05-12
▶ 2025年            [折叠]
```

## 8. 边界情况

- `updated_at` / `created_at` 解析失败（非法字符串） → 归入 `unknown`（「未知时间」组，置底）。
- 跨年日期 label 自动补年份，避免歧义。
- 仅当分组非空才渲染该分组头，不出现空组。
- 搜索态不分组；清空搜索恢复分组。

## 9. 文件清单

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `src/lib/sessionGrouping.ts` | 新增 | 纯函数 `groupSessionsByDate` + 类型 + label 工具 |
| `src/components/Chat/SessionGroup.tsx` | 新增 | 递归渲染分组节点 |
| `src/components/Chat/SessionSidebar.tsx` | 修改 | 引入分组树与折叠状态，复用 `SessionItem` |
| `useChatStore.ts` | 不改动 | 仍返回扁平排序数组 |

## 10. 测试策略

桌面端 `package.json` 当前无测试框架（无 vitest / jest）。`sessionGrouping.ts` 设计为纯函数、可独立单测；本次不引入新测试框架（YAGNI），以手动验证为主：

- 验证各层级分组与 label 正确（最近层 / 3 天~1 月 / 1 月~1 年 / 超过 1 年）。
- 验证默认展开：最近层 + 置顶展开，其余折叠。
- 验证折叠 / 展开切换、新建会话自动归入「今天」并展开。
- 验证搜索态扁平化、置顶区独立、无时间字段会话归入「未知时间」。

将来需要可补 vitest 对纯函数补测。

## 11. 非目标（YAGNI）

- 折叠状态跨重启持久化（localStorage）。
- 将分组工具提升到 workpaw-ui 共享包（web / admin 无会话列表）。
- 引入测试框架。
- 分组粒度可配置 / 用户自定义。
