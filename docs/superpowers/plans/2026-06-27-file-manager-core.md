# Desktop 文件管理系统 — Plan 1:Files 核心(树+列表+预览路由+生命周期)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 workpaw-desktop Files 页面重构为双栏文件管理器(目录树 + 文件列表/预览路由骨架),支持新建/建目录/编辑/复制/下载生命周期操作,不改 QwenPaw Pod(v1.1.12 锁定)。

**Architecture:** 纯前端增强。新增 `workspaceApi` 的 code-files 读写(Pod 已有 `/workspace/code-files`、`/files/preview`),`buildFileTree` 纯函数把扁平 path 列表构建递归树喂 react-complex-tree。Files 页面改双栏(react-resizable-panels,已装):左 FileTree + 右 FileList/FileViewer。FileViewer 按扩展名路由预览组件(本 plan 实现 MD/HTML/文本/图片/视频/PDF 占位,Office/CSV 在 Plan 2)。生命周期:新建/建目录用 PUT auto mkdir,复制用 GET+PUT,删除/重命名/移动灰掉(v1.1.12 无端点)。TDD,vitest。

**Tech Stack:** React 19, TypeScript, Tauri 2, Vite, zustand, react-complex-tree(新), react-textarea-autosize(新), react-resizable-panels(已装), streamdown(已装), Shadcn/base-ui, vitest + @testing-library/react。

## Global Constraints

- QwenPaw Pod 锁定 v1.1.12,不改 Pod 代码;只用已有 `/workspace/code-files`(递归列表+读写)、`/files/preview`(任意文件 FileResponse)、`/workspace/download`、`/workspace/upload`。
- 文件操作 agent-scoped(`X-Agent-Id` header),与 chat 共享 `selectedAgentId`。
- 删除/重命名/移动无 Pod 端点,v1 灰掉 + tooltip "v1.1.12 不支持";首次进 Files 顶部一次性提示条。
- 设计语言遵循 WorkPaw "精密控制台":Signal Orange ≤10%(仅选中/主操作)、扁平无阴影、Shadcn/base-ui、Geist、WCAG AA、reduced-motion 降级。
- podRequest 模式:`podRequest<T>(path)` path 相对 `/api`(如 `/workspace/code-files`);二进制用 `podHeaders()` + 直接 fetch。
- 每个 task 结束 commit;分支 `feat/file-manager-core`。
- 测试模式:`vi.mock("@/lib/podApi")` / `vi.mock("@/stores/useChatStore")` + `store.setState({...})`;render 包 `TooltipProvider`(若组件用 Tooltip)。

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `package.json` | 修改 | 加 react-complex-tree、react-textarea-autosize |
| `src/lib/fileTree.ts` | 新建 | `buildFileTree` 纯函数(扁平 path → 递归树)+ `FileTreeNode` 类型 |
| `src/lib/fileIcon.tsx` | 新建 | `fileIcon(name, isDir)` 扩展名 → lucide 图标映射 |
| `src/lib/workspaceApi.ts` | 修改 | 加 code-files API:listCodeFiles/loadCodeFile/saveCodeFile/codeFilePreviewUrl/downloadFile |
| `src/hooks/useWorkspace.ts` | 修改 | 加 code-files 树状态 + 生命周期(newFile/mkdir/copyFile/downloadFile/refreshTree) |
| `src/components/Files/FileTree.tsx` | 新建 | react-complex-tree 目录树(左栏) |
| `src/components/Files/FileList.tsx` | 新建 | 当前目录文件列表(右栏,排序/搜索/面包屑) |
| `src/components/Files/FileViewer.tsx` | 新建 | 预览路由(按扩展名)+ 文本/MD 编辑 |
| `src/components/Files/FileContextMenu.tsx` | 新建 | 右键菜单(shadcn context-menu) |
| `src/components/Files/NewFileDialog.tsx` | 新建 | 新建文件/文件夹对话框 |
| `src/components/Files/CopyDialog.tsx` | 新建 | 复制文件对话框 |
| `src/components/Files/LimitNotice.tsx` | 新建 | v1.1.12 限制提示条 |
| `src/pages/Files.tsx` | 修改 | 双栏布局(react-resizable-panels)+ 串联组件 |
| 测试 | 新建 | 各纯函数 + 组件测试 |

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `react-complex-tree`、`react-textarea-autosize` 可用。

- [ ] **Step 1: 安装**

Run:
```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
npm install react-complex-tree react-textarea-autosize
```

- [ ] **Step 2: 确认安装成功**

Run: `npm ls react-complex-tree react-textarea-autosize`
Expected: 两个包版本号输出,无 unmet。

- [ ] **Step 3: 确认 build 不破**

Run: `npm run build`
Expected: build 成功(无新依赖导致的类型错误)。

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(desktop): add react-complex-tree + react-textarea-autosize for file manager"
```

---

## Task 2: buildFileTree 纯函数

**Files:**
- Create: `src/lib/fileTree.ts`
- Test: `src/lib/__tests__/fileTree.test.ts`

**Interfaces:**
- Consumes: `MdFileInfo`(从 workspaceApi,但 code-files 用类似结构;本 task 自定义 `FlatFileEntry`)
- Produces:
  ```ts
  interface FlatFileEntry { path: string; filename: string; size: number; modified_time: string; }
  interface FileTreeNode {
    name: string; path: string; isDir: boolean;
    children: FileTreeNode[];
    file?: FlatFileEntry;  // 仅文件节点有
  }
  function buildFileTree(flat: FlatFileEntry[]): FileTreeNode[]
  ```

- [ ] **Step 1: 写失败测试**

Create `src/lib/__tests__/fileTree.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFileTree, type FlatFileEntry } from "../fileTree";

const f = (path: string, size = 100): FlatFileEntry => ({
  path, filename: path.split("/").pop() || path, size,
  modified_time: "2026-06-27T00:00:00Z",
});

describe("buildFileTree", () => {
  it("builds nested tree from flat paths", () => {
    const tree = buildFileTree([
      f("docs/notes.md"), f("docs/sub/deep.md"), f("README.md"), f("images/logo.png"),
    ]);
    // 根层:docs(dir)、README.md(file)、images(dir)
    const rootNames = tree.map((n) => n.name);
    expect(rootNames).toContain("docs");
    expect(rootNames).toContain("README.md");
    expect(rootNames).toContain("images");
    const docs = tree.find((n) => n.name === "docs")!;
    expect(docs.isDir).toBe(true);
    expect(docs.children.map((c) => c.name)).toEqual(["notes.md", "sub"]);
    const sub = docs.children.find((c) => c.name === "sub")!;
    expect(sub.isDir).toBe(true);
    expect(sub.children.map((c) => c.name)).toEqual(["deep.md"]);
  });

  it("attaches file entry to file nodes", () => {
    const tree = buildFileTree([f("a.md", 2048)]);
    expect(tree[0].file?.size).toBe(2048);
    expect(tree[0].file?.path).toBe("a.md");
  });

  it("handles empty input", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it("handles deep nesting", () => {
    const tree = buildFileTree([f("a/b/c/d/file.txt")]);
    let node = tree[0];
    expect(node.name).toBe("a");
    node = node.children[0]; expect(node.name).toBe("b");
    node = node.children[0]; expect(node.name).toBe("c");
    node = node.children[0]; expect(node.name).toBe("d");
    node = node.children[0]; expect(node.name).toBe("file.txt");
    expect(node.isDir).toBe(false);
  });

  it("dedupes directory entries (multiple files in same dir)", () => {
    const tree = buildFileTree([f("docs/a.md"), f("docs/b.md")]);
    const docs = tree.find((n) => n.name === "docs")!;
    expect(docs.children.length).toBe(2);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- fileTree`
Expected: FAIL — `undefined buildFileTree`。

- [ ] **Step 3: 实现 buildFileTree**

Create `src/lib/fileTree.ts`:

```ts
export interface FlatFileEntry {
  path: string;
  filename: string;
  size: number;
  modified_time: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: FileTreeNode[];
  file?: FlatFileEntry;
}

// buildFileTree constructs a recursive directory tree from a flat list of
// file paths (each entry's `path` may contain `/`-separated dir segments).
// Directories are synthesized; files carry their entry. Sibling order:
// directories first (by name), then files (by name).
export function buildFileTree(flat: FlatFileEntry[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const entry of flat) {
    const parts = entry.path.split("/").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join("/");
      let next = cur.children.find((c) => c.name === part);
      if (!next) {
        next = {
          name: part,
          path: childPath,
          isDir: !isLeaf,
          children: [],
          file: isLeaf ? entry : undefined,
        };
        cur.children.push(next);
      }
      cur = next;
    }
  }

  const sortNode = (node: FileTreeNode): void => {
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root.children;
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- fileTree`
Expected: PASS(5 tests)。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/lib/fileTree.ts src/lib/__tests__/fileTree.test.ts
git commit -m "feat(desktop): buildFileTree pure function (flat paths -> recursive tree)"
```

---

## Task 3: fileIcon 扩展名映射

**Files:**
- Create: `src/lib/fileIcon.tsx`
- Test: `src/lib/__tests__/fileIcon.test.tsx`

**Interfaces:**
- Produces: `fileIcon(name: string, isDir?: boolean): LucideIcon`(返回 lucide React 组件类型)

- [ ] **Step 1: 写失败测试**

Create `src/lib/__tests__/fileIcon.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { fileIcon } from "../fileIcon";
import { FileText, FileImage, FileVideo, FileCode, FileSpreadsheet, FileType, File, Folder, FolderOpen } from "lucide-react";

describe("fileIcon", () => {
  it("returns Folder for directories", () => {
    expect(fileIcon("docs", true)).toBe(Folder);
  });

  it("maps md/txt to FileText", () => {
    expect(fileIcon("a.md")).toBe(FileText);
    expect(fileIcon("a.txt")).toBe(FileText);
  });

  it("maps image extensions to FileImage", () => {
    expect(fileIcon("a.png")).toBe(FileImage);
    expect(fileIcon("a.jpg")).toBe(FileImage);
    expect(fileIcon("a.svg")).toBe(FileImage);
  });

  it("maps video extensions to FileVideo", () => {
    expect(fileIcon("a.mp4")).toBe(FileVideo);
    expect(fileIcon("a.webm")).toBe(FileVideo);
  });

  it("maps code extensions to FileCode", () => {
    expect(fileIcon("a.py")).toBe(FileCode);
    expect(fileIcon("a.js")).toBe(FileCode);
    expect(fileIcon("a.json")).toBe(FileCode);
  });

  it("maps csv/xlsx to FileSpreadsheet", () => {
    expect(fileIcon("a.csv")).toBe(FileSpreadsheet);
    expect(fileIcon("a.xlsx")).toBe(FileSpreadsheet);
  });

  it("maps docx to FileType", () => {
    expect(fileIcon("a.docx")).toBe(FileType);
  });

  it("returns File for unknown extensions", () => {
    expect(fileIcon("a.xyz")).toBe(File);
    expect(fileIcon("noext")).toBe(File);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- fileIcon`
Expected: FAIL — `undefined fileIcon`。

- [ ] **Step 3: 实现 fileIcon**

Create `src/lib/fileIcon.tsx`:

```tsx
import {
  File, FileText, FileImage, FileVideo, FileCode,
  FileSpreadsheet, FileType, Folder, FolderOpen,
  type LucideIcon,
} from "lucide-react";

const EXT_MAP: Record<string, LucideIcon> = {
  md: FileText, txt: FileText, pdf: FileText,
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage,
  webp: FileImage, svg: FileImage, bmp: FileImage, ico: FileImage,
  mp4: FileVideo, webm: FileVideo, ogg: FileVideo, mov: FileVideo,
  py: FileCode, js: FileCode, ts: FileCode, tsx: FileCode, jsx: FileCode,
  json: FileCode, yaml: FileCode, yml: FileCode, html: FileCode, htm: FileCode,
  css: FileCode, sh: FileCode, rs: FileCode, go: FileCode, java: FileCode,
  csv: FileSpreadsheet, xlsx: FileSpreadsheet, xls: FileSpreadsheet,
  docx: FileType, doc: FileType,
};

// fileIcon returns a lucide icon component for a file/directory by extension.
export function fileIcon(name: string, isDir = false): LucideIcon {
  if (isDir) return Folder;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return EXT_MAP[ext] ?? File;
}

export { FolderOpen };
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- fileIcon`
Expected: PASS(8 tests)。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/lib/fileIcon.tsx src/lib/__tests__/fileIcon.test.tsx
git commit -m "feat(desktop): fileIcon extension -> lucide icon mapping"
```

---

## Task 4: workspaceApi code-files 扩展

**Files:**
- Modify: `src/lib/workspaceApi.ts`(加 code-files API)
- Test: `src/lib/__tests__/workspaceApi.test.ts`

**Interfaces:**
- Consumes: `podRequest`、`getPodUrl`、`podHeaders`(from podApi)
- Produces:
  ```ts
  interface CodeFileEntry { path: string; filename: string; size: number; modified_time: string; }
  function listCodeFiles(): Promise<CodeFileEntry[]>
  function loadCodeFile(path: string): Promise<{ content: string }>
  function saveCodeFile(path: string, content: string): Promise<unknown>
  function codeFilePreviewUrl(path: string): string  // 二进制/视频等直接 URL
  function downloadFile(path: string): Promise<void>  // 单文件下载
  ```

- [ ] **Step 1: 写失败测试**

Create `src/lib/__tests__/workspaceApi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const podRequestMock = vi.fn();
const fetchMock = vi.fn();
vi.mock("@/lib/podApi", () => ({
  podRequest: (...args: unknown[]) => podRequestMock(...args),
  getPodUrl: () => "http://pod:8088",
  podHeaders: () => ({ Authorization: "Bearer tok" }),
}));

import { listCodeFiles, loadCodeFile, saveCodeFile, codeFilePreviewUrl, downloadFile } from "../workspaceApi";

describe("workspaceApi code-files", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listCodeFiles calls GET /workspace/code-files", async () => {
    podRequestMock.mockResolvedValue([
      { path: "a.md", filename: "a.md", size: 10, modified_time: "2026-06-27" },
    ]);
    const out = await listCodeFiles();
    expect(podRequestMock).toHaveBeenCalledWith("/workspace/code-files");
    expect(out[0].path).toBe("a.md");
  });

  it("loadCodeFile calls GET /workspace/code-files/{path}", async () => {
    podRequestMock.mockResolvedValue({ content: "hi" });
    const out = await loadCodeFile("docs/notes.md");
    expect(podRequestMock).toHaveBeenCalledWith("/workspace/code-files/docs/notes.md");
    expect(out.content).toBe("hi");
  });

  it("saveCodeFile calls PUT /workspace/code-files/{path} with {content}", async () => {
    podRequestMock.mockResolvedValue(undefined);
    await saveCodeFile("a.md", "new content");
    expect(podRequestMock).toHaveBeenCalledWith("/workspace/code-files/a.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "new content" }),
    });
  });

  it("codeFilePreviewUrl builds /api/files/preview/{path}?token=", () => {
    const url = codeFilePreviewUrl("images/logo.png");
    expect(url).toBe("http://pod:8088/api/files/preview/images/logo.png?token=tok");
  });

  it("downloadFile fetches blob and triggers download", async () => {
    const blob = new Blob(["data"], { type: "text/plain" });
    fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob), headers: { get: () => "attachment; filename=logo.png" } });
    vi.stubGlobal("fetch", fetchMock);
    const createUrl = vi.fn(() => "blob:url");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: revoke });
    const clickSpy = vi.fn();
    vi.stubGlobal("document", { createElement: () => ({ click: clickSpy, href: "", download: "" }), body: { appendChild: () => {}, removeChild: () => {} } });
    await downloadFile("images/logo.png");
    expect(fetchMock).toHaveBeenCalled();
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- workspaceApi`
Expected: FAIL — `undefined listCodeFiles` 等。

- [ ] **Step 3: 实现 code-files API**

在 `src/lib/workspaceApi.ts` 顶部 import 确认含 `podRequest, getPodUrl, podHeaders`(已有),在文件末尾追加:

```ts
// --- Code Files (任意格式文件,Pod /workspace/code-files) ---

export interface CodeFileEntry {
  path: string;
  filename: string;
  size: number;
  modified_time: string;
}

/** 递归列出工作区所有文件(path 含目录层级) */
export function listCodeFiles(): Promise<CodeFileEntry[]> {
  return podRequest<CodeFileEntry[]>("/workspace/code-files");
}

/** 读取任意文本文件(<=5MB, UTF-8) */
export function loadCodeFile(path: string): Promise<{ content: string }> {
  return podRequest<{ content: string }>(`/workspace/code-files/${path}`);
}

/** 写入文本文件(auto mkdir parent) */
export function saveCodeFile(path: string, content: string): Promise<unknown> {
  return podRequest(`/workspace/code-files/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

/** 二进制/视频等文件的直接预览 URL(img/video src 或 fetch blob) */
export function codeFilePreviewUrl(path: string): string {
  const base = getPodUrl();
  const token = podHeaders().Authorization?.replace("Bearer ", "") ?? "";
  return `${base}/api/files/preview/${path}${token ? `?token=${token}` : ""}`;
}

/** 下载单个文件(blob → 浏览器下载) */
export async function downloadFile(path: string): Promise<void> {
  const res = await fetch(codeFilePreviewUrl(path), { headers: podHeaders() });
  if (!res.ok) throw new Error(`下载失败: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = path.split("/").pop() || path;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- workspaceApi`
Expected: PASS(5 tests)。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/lib/workspaceApi.ts src/lib/__tests__/workspaceApi.test.ts
git commit -m "feat(desktop): workspaceApi code-files (list/load/save/preview/download)"
```

---

## Task 5: useWorkspace 增强(code-files 树 + 生命周期)

**Files:**
- Modify: `src/hooks/useWorkspace.ts`

**Interfaces:**
- Consumes: `listCodeFiles`/`loadCodeFile`/`saveCodeFile`/`downloadFile`(workspaceApi)、`buildFileTree`、`useChatStore.selectedAgentId`/`podUrl`
- Produces(useWorkspace 新增返回):
  ```ts
  codeTree: FileTreeNode[]            // 构建好的树
  codeFiles: CodeFileEntry[]          // 扁平列表
  currentPath: string                 // 当前目录(面包屑)
  selectedCodeFile: CodeFileEntry | null
  codeFileContent: string
  codeLoading: boolean
  codeError: string | null
  fetchCodeFiles(): Promise<void>
  selectCodeFile(file: CodeFileEntry | null): Promise<void>
  saveCodeFileContent(path: string, content: string): Promise<void>
  setCurrentPath(path: string): void
  newFile(path: string): Promise<void>       // PUT 空 content
  mkdir(name: string): Promise<void>         // PUT {name}/.keep
  copyFile(src: string, dst: string): Promise<void>  // GET + PUT
  downloadCodeFile(path: string): Promise<void>
  ```

- [ ] **Step 1: 写失败测试**

Create `src/hooks/__tests__/useWorkspace.code.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkspace } from "../useWorkspace";

const listCodeFilesMock = vi.fn();
const loadCodeFileMock = vi.fn();
const saveCodeFileMock = vi.fn();
const downloadFileMock = vi.fn();
vi.mock("@/lib/workspaceApi", async () => {
  const actual = await vi.importActual("@/lib/workspaceApi");
  return {
    ...actual,
    listCodeFiles: (...a: unknown[]) => listCodeFilesMock(...a),
    loadCodeFile: (...a: unknown[]) => loadCodeFileMock(...a),
    saveCodeFile: (...a: unknown[]) => saveCodeFileMock(...a),
    downloadFile: (...a: unknown[]) => downloadFileMock(...a),
    getSystemPromptFiles: vi.fn().mockResolvedValue([]),
    listFiles: vi.fn().mockResolvedValue([]),
    listDailyMemory: vi.fn().mockResolvedValue([]),
  };
});
vi.mock("@/stores/useChatStore", () => ({
  useChatStore: (sel: (s: { selectedAgentId: string | null; podUrl: string }) => unknown) =>
    sel({ selectedAgentId: "agent-1", podUrl: "http://pod" }),
}));

describe("useWorkspace code-files", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetchCodeFiles builds tree from flat list", async () => {
    listCodeFilesMock.mockResolvedValue([
      { path: "docs/a.md", filename: "a.md", size: 10, modified_time: "2026-06-27" },
      { path: "README.md", filename: "README.md", size: 20, modified_time: "2026-06-27" },
    ]);
    const { result } = renderHook(() => useWorkspace());
    await act(async () => { await result.current.fetchCodeFiles(); });
    expect(result.current.codeFiles.length).toBe(2);
    expect(result.current.codeTree.length).toBe(2);
    expect(result.current.codeTree.find((n) => n.name === "docs")?.isDir).toBe(true);
  });

  it("selectCodeFile loads content", async () => {
    loadCodeFileMock.mockResolvedValue({ content: "# hi" });
    const { result } = renderHook(() => useWorkspace());
    await act(async () => {
      await result.current.selectCodeFile({ path: "a.md", filename: "a.md", size: 1, modified_time: "" });
    });
    expect(loadCodeFileMock).toHaveBeenCalledWith("a.md");
    expect(result.current.codeFileContent).toBe("# hi");
    expect(result.current.selectedCodeFile?.path).toBe("a.md");
  });

  it("newFile PUTs empty content", async () => {
    saveCodeFileMock.mockResolvedValue(undefined);
    listCodeFilesMock.mockResolvedValue([]);
    const { result } = renderHook(() => useWorkspace());
    await act(async () => { await result.current.newFile("docs/new.md"); });
    expect(saveCodeFileMock).toHaveBeenCalledWith("docs/new.md", "");
  });

  it("mkdir PUTs {name}/.keep", async () => {
    saveCodeFileMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useWorkspace());
    await act(async () => { await result.current.mkdir("newdir"); });
    expect(saveCodeFileMock).toHaveBeenCalledWith("newdir/.keep", "");
  });

  it("copyFile reads src then writes dst", async () => {
    loadCodeFileMock.mockResolvedValue({ content: "data" });
    saveCodeFileMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useWorkspace());
    await act(async () => { await result.current.copyFile("a.md", "b.md"); });
    expect(loadCodeFileMock).toHaveBeenCalledWith("a.md");
    expect(saveCodeFileMock).toHaveBeenCalledWith("b.md", "data");
  });

  it("fetchCodeFiles sets error on failure", async () => {
    listCodeFilesMock.mockRejectedValue(new Error("net"));
    const { result } = renderHook(() => useWorkspace());
    await act(async () => { await result.current.fetchCodeFiles(); });
    expect(result.current.codeError).toBe("net");
    expect(result.current.codeTree).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- useWorkspace.code`
Expected: FAIL — `fetchCodeFiles` undefined。

- [ ] **Step 3: 实现 useWorkspace 增强**

在 `src/hooks/useWorkspace.ts` 顶部 import 加:
```ts
import {
  listCodeFiles, loadCodeFile, saveCodeFile, downloadFile,
  type CodeFileEntry,
} from "@/lib/workspaceApi";
import { buildFileTree, type FileTreeNode } from "@/lib/fileTree";
```

在 hook 内部(现有 state 之后)加 code-files state:
```ts
const [codeFiles, setCodeFiles] = useState<CodeFileEntry[]>([]);
const [codeTree, setCodeTree] = useState<FileTreeNode[]>([]);
const [currentPath, setCurrentPath] = useState("");
const [selectedCodeFile, setSelectedCodeFile] = useState<CodeFileEntry | null>(null);
const [codeFileContent, setCodeFileContent] = useState("");
const [codeLoading, setCodeLoading] = useState(false);
const [codeError, setCodeError] = useState<string | null>(null);
```

加 code-files 方法(在 return 之前):
```ts
const fetchCodeFiles = useCallback(async () => {
  setCodeLoading(true);
  setCodeError(null);
  try {
    const files = await listCodeFiles();
    setCodeFiles(files);
    setCodeTree(buildFileTree(files));
  } catch (e) {
    setCodeError(e instanceof Error ? e.message : "加载文件失败");
    setCodeFiles([]);
    setCodeTree([]);
  } finally {
    setCodeLoading(false);
  }
}, []);

const selectCodeFile = useCallback(async (file: CodeFileEntry | null) => {
  setSelectedCodeFile(file);
  setCodeFileContent("");
  if (!file) return;
  try {
    const { content } = await loadCodeFile(file.path);
    setCodeFileContent(content);
  } catch (e) {
    setCodeError(e instanceof Error ? e.message : "读取文件失败");
  }
}, []);

const saveCodeFileContent = useCallback(async (path: string, content: string) => {
  await saveCodeFile(path, content);
}, []);

const newFile = useCallback(async (path: string) => {
  await saveCodeFile(path, "");
  await fetchCodeFiles();
}, [fetchCodeFiles]);

const mkdir = useCallback(async (name: string) => {
  await saveCodeFile(`${name}/.keep`, "");
  await fetchCodeFiles();
}, [fetchCodeFiles]);

const copyFile = useCallback(async (src: string, dst: string) => {
  const { content } = await loadCodeFile(src);
  await saveCodeFile(dst, content);
  await fetchCodeFiles();
}, [fetchCodeFiles]);

const downloadCodeFile = useCallback(async (path: string) => {
  await downloadFile(path);
}, []);
```

在初始化 effect(现有 selectedAgentId 依赖的 effect)里,加 `fetchCodeFiles()` 调用。在现有 effect 末尾加:
```ts
fetchCodeFiles();
```

在 return 对象里加新字段:
```ts
return {
  // ... 现有返回 ...
  codeFiles, codeTree, currentPath, selectedCodeFile,
  codeFileContent, codeLoading, codeError,
  fetchCodeFiles, selectCodeFile, saveCodeFileContent,
  setCurrentPath, newFile, mkdir, copyFile, downloadCodeFile,
};
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- useWorkspace.code`
Expected: PASS(6 tests)。

- [ ] **Step 5: 确认既有 useWorkspace 测试不回归**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test`
Expected: 全 PASS(含既有)。

- [ ] **Step 6: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/hooks/useWorkspace.ts src/hooks/__tests__/useWorkspace.code.test.tsx
git commit -m "feat(desktop): useWorkspace code-files tree + lifecycle (new/mkdir/copy/download)"
```

---

## Task 6: FileTree 组件(react-complex-tree)

**Files:**
- Create: `src/components/Files/FileTree.tsx`
- Test: `src/components/Files/FileTree.test.tsx`

**Interfaces:**
- Consumes: `FileTreeNode`(fileTree)、`fileIcon`、`useWorkspace.codeTree`/`selectCodeFile`/`setCurrentPath`
- Produces: `FileTree` 组件,props `{ tree: FileTreeNode[]; selectedPath: string | null; onSelectFile: (file: CodeFileEntry) => void; onSelectDir: (path: string) => void; onRefresh: () => void; loading: boolean; error: string | null }`

- [ ] **Step 1: 写失败测试**

Create `src/components/Files/FileTree.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileTree } from "./FileTree";
import type { FileTreeNode } from "@/lib/fileTree";

const tree: FileTreeNode[] = [
  { name: "docs", path: "docs", isDir: true, children: [
    { name: "notes.md", path: "docs/notes.md", isDir: false, children: [], file: { path: "docs/notes.md", filename: "notes.md", size: 10, modified_time: "" } },
  ]},
  { name: "README.md", path: "README.md", isDir: false, children: [], file: { path: "README.md", filename: "README.md", size: 20, modified_time: "" } },
];

describe("FileTree", () => {
  it("renders tree nodes", () => {
    render(<FileTree tree={tree} selectedPath={null} onSelectFile={() => {}} onSelectDir={() => {}} onRefresh={() => {}} loading={false} error={null} />);
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("shows error state", () => {
    render(<FileTree tree={[]} selectedPath={null} onSelectFile={() => {}} onSelectDir={() => {}} onRefresh={() => {}} loading={false} error="加载失败" />);
    expect(screen.getByText(/无法加载文件/)).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<FileTree tree={[]} selectedPath={null} onSelectFile={() => {}} onSelectDir={() => {}} onRefresh={() => {}} loading={true} error={null} />);
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });

  it("calls onSelectFile on file click", async () => {
    const onSelectFile = vi.fn();
    render(<FileTree tree={tree} selectedPath={null} onSelectFile={onSelectFile} onSelectDir={() => {}} onRefresh={() => {}} loading={false} error={null} />);
    await userEvent.setup().click(screen.getByText("README.md"));
    expect(onSelectFile).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- FileTree`
Expected: FAIL — `undefined FileTree`。

- [ ] **Step 3: 实现 FileTree**

Create `src/components/Files/FileTree.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { fileIcon } from "@/lib/fileIcon";
import type { FileTreeNode } from "@/lib/fileTree";
import type { CodeFileEntry } from "@/lib/workspaceApi";

interface FileTreeProps {
  tree: FileTreeNode[];
  selectedPath: string | null;
  onSelectFile: (file: CodeFileEntry) => void;
  onSelectDir: (path: string) => void;
  onRefresh: () => void;
  loading: boolean;
  error: string | null;
}

export function FileTree({ tree, selectedPath, onSelectFile, onSelectDir, onRefresh, loading, error }: FileTreeProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">文件树</span>
        <Button variant="ghost" size="icon-xs" onClick={onRefresh} disabled={loading} title="刷新">
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {error ? (
          <div className="space-y-2 p-2 text-xs text-muted-foreground">
            <p>无法加载文件,请检查实例状态</p>
            <Button variant="outline" size="xs" onClick={onRefresh}>重试</Button>
          </div>
        ) : loading ? (
          <p className="p-2 text-xs text-muted-foreground">加载中…</p>
        ) : tree.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">暂无文件</p>
        ) : (
          <div className="space-y-0.5">
            {tree.map((node) => (
              <TreeRow key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelectFile={onSelectFile} onSelectDir={onSelectDir} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TreeRow({ node, depth, selectedPath, onSelectFile, onSelectDir }: {
  node: FileTreeNode; depth: number; selectedPath: string | null;
  onSelectFile: (f: CodeFileEntry) => void; onSelectDir: (p: string) => void;
}) {
  const Icon = fileIcon(node.name, node.isDir);
  const isSelected = node.path === selectedPath;
  return (
    <div>
      <button
        onClick={() => node.isDir ? onSelectDir(node.path) : node.file && onSelectFile(node.file)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors",
          isSelected ? "bg-accent text-foreground" : "text-foreground hover:bg-accent/50",
        )}
        style={{ paddingLeft: depth * 12 + 6 }}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </button>
      {node.isDir && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeRow key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelectFile={onSelectFile} onSelectDir={onSelectDir} />
          ))}
        </div>
      )}
    </div>
  );
}
```

注:本实现用自建轻量树渲染(递归 TreeRow)替代 react-complex-tree 的完整 API——react-complex-tree 的 ControlledTreeEnvironment API 较重,自建递归行更轻且可控、Shadcn 样式直接套。若后续需高级特性(多选/DnD/虚拟滚动)再切 react-complex-tree。本 task 仍保留 react-complex-tree 依赖供后续。

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- FileTree`
Expected: PASS(4 tests)。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/components/Files/FileTree.tsx src/components/Files/FileTree.test.tsx
git commit -m "feat(desktop): FileTree component (recursive dir tree)"
```

---

## Task 7: FileList 组件(当前目录列表)

**Files:**
- Create: `src/components/Files/FileList.tsx`
- Test: `src/components/Files/FileList.test.tsx`

**Interfaces:**
- Consumes: `CodeFileEntry`、`fileIcon`、`currentPath`
- Produces: `FileList` props `{ files: CodeFileEntry[]; currentPath: string; selectedPath: string | null; onSelectFile: (f: CodeFileEntry) => void; onOpenDir: (path: string) => void; onUp: () => void; onDownload: (path: string) => void; onCopy: (path: string) => void; onNewFile: () => void; onNewDir: () => void; onContextAction: (action: string, file: CodeFileEntry) => void }`

- [ ] **Step 1: 写失败测试**

Create `src/components/Files/FileList.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileList } from "./FileList";
import type { CodeFileEntry } from "@/lib/workspaceApi";

const files: CodeFileEntry[] = [
  { path: "docs/sub", filename: "sub", size: 0, modified_time: "2026-06-27" },
  { path: "docs/a.md", filename: "a.md", size: 2048, modified_time: "2026-06-27" },
  { path: "docs/b.png", filename: "b.png", size: 15360, modified_time: "2026-06-26" },
];

describe("FileList", () => {
  it("renders breadcrumb + files (dirs first)", () => {
    render(<FileList files={files} currentPath="docs" selectedPath={null} onSelectFile={() => {}} onOpenDir={() => {}} onUp={() => {}} onDownload={() => {}} onCopy={() => {}} onNewFile={() => {}} onNewDir={() => {}} onContextAction={() => {}} />);
    expect(screen.getByText(/docs/)).toBeInTheDocument();
    expect(screen.getByText("sub")).toBeInTheDocument();
    expect(screen.getByText("a.md")).toBeInTheDocument();
  });

  it("calls onOpenDir on directory double-click", async () => {
    const onOpenDir = vi.fn();
    render(<FileList files={files} currentPath="docs" selectedPath={null} onSelectFile={() => {}} onOpenDir={onOpenDir} onUp={() => {}} onDownload={() => {}} onCopy={() => {}} onNewFile={() => {}} onNewDir={() => {}} onContextAction={() => {}} />);
    await userEvent.setup().dblClick(screen.getByText("sub"));
    expect(onOpenDir).toHaveBeenCalledWith("docs/sub");
  });

  it("calls onSelectFile on file click", async () => {
    const onSelectFile = vi.fn();
    render(<FileList files={files} currentPath="docs" selectedPath={null} onSelectFile={onSelectFile} onOpenDir={() => {}} onUp={() => {}} onDownload={() => {}} onCopy={() => {}} onNewFile={() => {}} onNewDir={() => {}} onContextAction={() => {}} />);
    await userEvent.setup().click(screen.getByText("a.md"));
    expect(onSelectFile).toHaveBeenCalled();
  });

  it("filters by search query", async () => {
    render(<FileList files={files} currentPath="docs" selectedPath={null} onSelectFile={() => {}} onOpenDir={() => {}} onUp={() => {}} onDownload={() => {}} onCopy={() => {}} onNewFile={() => {}} onNewDir={() => {}} onContextAction={() => {}} />);
    await userEvent.setup().type(screen.getByPlaceholderText(/搜索/), "png");
    expect(screen.queryByText("a.md")).not.toBeInTheDocument();
    expect(screen.getByText("b.png")).toBeInTheDocument();
  });

  it("shows empty state", () => {
    render(<FileList files={[]} currentPath="docs" selectedPath={null} onSelectFile={() => {}} onOpenDir={() => {}} onUp={() => {}} onDownload={() => {}} onCopy={() => {}} onNewFile={() => {}} onNewDir={() => {}} onContextAction={() => {}} />);
    expect(screen.getByText(/暂无文件/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- FileList`
Expected: FAIL — `undefined FileList`。

- [ ] **Step 3: 实现 FileList**

Create `src/components/Files/FileList.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronUp, Plus, FilePlus, FolderPlus, Download, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { fileIcon } from "@/lib/fileIcon";
import type { CodeFileEntry } from "@/lib/workspaceApi";

interface FileListProps {
  files: CodeFileEntry[];
  currentPath: string;
  selectedPath: string | null;
  onSelectFile: (f: CodeFileEntry) => void;
  onOpenDir: (path: string) => void;
  onUp: () => void;
  onDownload: (path: string) => void;
  onCopy: (path: string) => void;
  onNewFile: () => void;
  onNewDir: () => void;
  onContextAction: (action: string, file: CodeFileEntry) => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function FileList({ files, currentPath, selectedPath, onSelectFile, onOpenDir, onUp, onDownload, onCopy, onNewFile, onNewDir }: FileListProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "size" | "time">("name");

  // 当前目录下的条目(直接子项)
  const entries = useMemo(() => {
    const prefix = currentPath ? `${currentPath}/` : "";
    return files
      .filter((f) => f.path.startsWith(prefix))
      .map((f) => {
        const rest = f.path.slice(prefix.length);
        const sep = rest.indexOf("/");
        if (sep === -1) return { ...f, name: rest, isDir: false };
        return { path: `${currentPath ? currentPath + "/" : ""}${rest.slice(0, sep)}`, filename: rest.slice(0, sep), size: 0, modified_time: "", name: rest.slice(0, sep), isDir: true };
      })
      .filter((e, i, arr) => arr.findIndex((x) => x.path === e.path) === i); // 目录去重
  }, [files, currentPath]);

  const filtered = useMemo(() => {
    let list = entries;
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (sortKey === "size") return a.size - b.size;
      if (sortKey === "time") return b.modified_time.localeCompare(a.modified_time);
      return a.name.localeCompare(b.name);
    });
  }, [entries, query, sortKey]);

  const crumbs = currentPath ? currentPath.split("/") : [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon-xs" onClick={onUp} disabled={!currentPath} title="上级">
          <ChevronUp className="size-3.5" />
        </Button>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <button onClick={() => onUp()} className="hover:text-foreground">工作区</button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <span>/</span>
              <button onClick={() => onOpenDir(crumbs.slice(0, i + 1).join("/"))} className="hover:text-foreground">{c}</button>
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" onClick={onNewFile} title="新建文件"><FilePlus className="size-3.5" /></Button>
          <Button variant="ghost" size="icon-xs" onClick={onNewDir} title="新建文件夹"><FolderPlus className="size-3.5" /></Button>
        </div>
      </div>
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索当前目录…" className="h-7 text-xs" />
        <Button variant="ghost" size="xs" onClick={() => setSortKey(sortKey === "name" ? "size" : sortKey === "size" ? "time" : "name")}>
          排序:{sortKey === "name" ? "名称" : sortKey === "size" ? "大小" : "时间"}
        </Button>
      </div>
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">暂无文件</p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {filtered.map((e) => {
                const Icon = fileIcon(e.name, e.isDir);
                const isSelected = e.path === selectedPath;
                return (
                  <tr key={e.path} className={cn("border-b hover:bg-accent/50", isSelected && "bg-accent")}
                    onClick={() => !e.isDir && onSelectFile(e as CodeFileEntry)}
                    onDoubleClick={() => e.isDir ? onOpenDir(e.path) : onSelectFile(e as CodeFileEntry)}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{e.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatSize(e.size)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.modified_time?.slice(0, 10) || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {!e.isDir && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-xs" onClick={(ev) => { ev.stopPropagation(); onCopy(e.path); }} title="复制"><Copy className="size-3" /></Button>
                          <Button variant="ghost" size="icon-xs" onClick={(ev) => { ev.stopPropagation(); onDownload(e.path); }} title="下载"><Download className="size-3" /></Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- FileList`
Expected: PASS(5 tests)。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/components/Files/FileList.tsx src/components/Files/FileList.test.tsx
git commit -m "feat(desktop): FileList component (current dir listing + sort/search/breadcrumb)"
```

---

## Task 8: FileViewer 预览路由 + 文本/MD 编辑

**Files:**
- Create: `src/components/Files/FileViewer.tsx`
- Test: `src/components/Files/FileViewer.test.tsx`

**Interfaces:**
- Consumes: `CodeFileEntry`、`streamdown`、`react-textarea-autosize`、`saveCodeFileContent`、`codeFilePreviewUrl`
- Produces: `FileViewer` props `{ file: CodeFileEntry | null; content: string; loading: boolean; hasChanges: boolean; onContentChange: (c: string) => void; onSave: () => void; onDownload: (path: string) => void }`。按扩展名路由预览;本 task 实现 MD(streamdown+编辑)/文本(textarea 编辑)/HTML(iframe)/图片(lightbox 占位用 img)/视频(video)/其他(下载提示)。PDF/CSV/Office 在 Plan 2 接入(本 task 占位"加载中…")。

- [ ] **Step 1: 写失败测试**

Create `src/components/Files/FileViewer.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileViewer } from "./FileViewer";
import type { CodeFileEntry } from "@/lib/workspaceApi";

vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div> }));
vi.mock("react-textarea-autosize", () => ({ default: (props: any) => <textarea {...props} /> }));

const mk = (path: string): CodeFileEntry => ({ path, filename: path.split("/").pop() || path, size: 10, modified_time: "" });

describe("FileViewer routing", () => {
  const baseProps = { content: "# hi", loading: false, hasChanges: false, onContentChange: () => {}, onSave: () => {}, onDownload: () => {} };

  it("renders markdown preview for .md", () => {
    render(<FileViewer file={mk("a.md")} {...baseProps} />);
    expect(screen.getByTestId("md")).toBeInTheDocument();
  });

  it("renders textarea for .txt", () => {
    render(<FileViewer file={mk("a.txt")} {...baseProps} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders iframe for .html", () => {
    render(<FileViewer file={mk("a.html")} {...baseProps} />);
    expect(document.querySelector("iframe")).toBeInTheDocument();
  });

  it("renders img for .png", () => {
    render(<FileViewer file={mk("a.png")} {...baseProps} />);
    expect(document.querySelector("img")).toBeInTheDocument();
  });

  it("renders video for .mp4", () => {
    render(<FileViewer file={mk("a.mp4")} {...baseProps} />);
    expect(document.querySelector("video")).toBeInTheDocument();
  });

  it("renders download hint for .pptx", () => {
    render(<FileViewer file={mk("a.pptx")} {...baseProps} />);
    expect(screen.getByText(/下载查看/)).toBeInTheDocument();
  });

  it("renders empty state when no file", () => {
    render(<FileViewer file={null} {...baseProps} />);
    expect(screen.getByText(/选择文件/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- FileViewer`
Expected: FAIL — `undefined FileViewer`。

- [ ] **Step 3: 实现 FileViewer**

Create `src/components/Files/FileViewer.tsx`:

```tsx
import { useState } from "react";
import { Streamdown } from "streamdown";
import TextareaAutosize from "react-textarea-autosize";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Download, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CodeFileEntry } from "@/lib/workspaceApi";
import { codeFilePreviewUrl } from "@/lib/workspaceApi";

interface FileViewerProps {
  file: CodeFileEntry | null;
  content: string;
  loading: boolean;
  hasChanges: boolean;
  onContentChange: (c: string) => void;
  onSave: () => void;
  onDownload: (path: string) => void;
}

const TEXT_EXTS = ["md", "txt", "json", "yaml", "yml", "py", "js", "ts", "tsx", "jsx", "html", "htm", "css", "sh", "rs", "go", "java", "csv"];
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
const VIDEO_EXTS = ["mp4", "webm", "ogg", "mov"];

function extOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

export function FileViewer({ file, content, loading, hasChanges, onContentChange, onSave, onDownload }: FileViewerProps) {
  const [editMode, setEditMode] = useState(false);

  if (!file) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择文件进行预览</div>;
  }
  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>;
  }

  const ext = extOf(file.filename);
  const isText = TEXT_EXTS.includes(ext);
  const isImage = IMAGE_EXTS.includes(ext);
  const isVideo = VIDEO_EXTS.includes(ext);
  const isHtml = ext === "html" || ext === "htm";
  const isMd = ext === "md";
  const previewUrl = codeFilePreviewUrl(file.path);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-sm font-medium">{file.filename}</span>
        <span className="font-mono text-xs text-muted-foreground">{file.path}</span>
        <div className="ml-auto flex items-center gap-2">
          {isText && (
            <>
              {isMd && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span>预览</span>
                  <Switch checked={editMode} onCheckedChange={setEditMode} />
                  <span>编辑</span>
                </div>
              )}
              <Button variant="ghost" size="xs" onClick={onSave} disabled={!hasChanges}>
                <Save className="size-3" /> 保存
              </Button>
            </>
          )}
          <Button variant="ghost" size="xs" onClick={() => onDownload(file.path)}>
            <Download className="size-3" /> 下载
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {isText ? (
          editMode || !isMd ? (
            <TextareaAutosize
              value={content}
              onChange={(e) => onContentChange((e.target as HTMLTextAreaElement).value)}
              className="w-full resize-y rounded-md border bg-background p-3 font-mono text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[280px]"
            />
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <Streamdown>{content}</Streamdown>
            </div>
          )
        ) : isImage ? (
          <div className="flex items-center justify-center">
            <img src={previewUrl} alt={file.filename} className="max-h-[70vh] rounded-md" />
          </div>
        ) : isVideo ? (
          <div className="flex items-center justify-center">
            <video controls src={previewUrl} className="max-h-[70vh] rounded-md" />
          </div>
        ) : isHtml ? (
          <iframe sandbox="allow-same-origin" srcDoc={content} className="h-[70vh] w-full rounded-md border" title={file.filename} />
        ) : ext === "pdf" || ext === "csv" || ext === "docx" || ext === "xlsx" ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <div className="space-y-2 text-center">
              <p>此格式预览组件加载中(Plan 2 接入)</p>
              <Button variant="outline" size="sm" onClick={() => onDownload(file.path)}><Download className="size-3.5" /> 下载查看</Button>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <div className="space-y-2 text-center">
              <p>此格式不支持预览</p>
              <Button variant="outline" size="sm" onClick={() => onDownload(file.path)}><Download className="size-3.5" /> 下载查看</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- FileViewer`
Expected: PASS(7 tests)。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/components/Files/FileViewer.tsx src/components/Files/FileViewer.test.tsx
git commit -m "feat(desktop): FileViewer routes by extension (md/text/html/image/video)"
```

---

## Task 9: NewFile / Copy 对话框 + LimitNotice

**Files:**
- Create: `src/components/Files/NewFileDialog.tsx`、`src/components/Files/CopyDialog.tsx`、`src/components/Files/LimitNotice.tsx`

**Interfaces:**
- Produces: `NewFileDialog` props `{ open; onClose; onSubmit: (path: string, isDir: boolean) => void; currentPath: string }`;`CopyDialog` props `{ open; srcPath; onClose; onSubmit: (dst: string) => void }`;`LimitNotice`(无 props,自管 localStorage)。

- [ ] **Step 1: 写失败测试**

Create `src/components/Files/Dialogs.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewFileDialog } from "./NewFileDialog";
import { CopyDialog } from "./CopyDialog";
import { LimitNotice } from "./LimitNotice";

describe("NewFileDialog", () => {
  it("submits file path", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<NewFileDialog open onClose={onClose} onSubmit={onSubmit} currentPath="docs" isDir={false} />);
    await userEvent.setup().type(screen.getByPlaceholderText(/文件名/), "new.md");
    await userEvent.setup().click(screen.getByRole("button", { name: /创建/ }));
    expect(onSubmit).toHaveBeenCalledWith("docs/new.md", false);
  });

  it("submits dir path", async () => {
    const onSubmit = vi.fn();
    render(<NewFileDialog open onClose={() => {}} onSubmit={onSubmit} currentPath="" isDir={true} />);
    await userEvent.setup().type(screen.getByPlaceholderText(/文件夹名/), "newdir");
    await userEvent.setup().click(screen.getByRole("button", { name: /创建/ }));
    expect(onSubmit).toHaveBeenCalledWith("newdir", true);
  });
});

describe("CopyDialog", () => {
  it("submits destination path", async () => {
    const onSubmit = vi.fn();
    render(<CopyDialog open srcPath="a.md" onClose={() => {}} onSubmit={onSubmit} />);
    await userEvent.setup().clear(screen.getByDisplayValue("a.md"));
    await userEvent.setup().type(screen.getByDisplayValue(""), "b.md");
    await userEvent.setup().click(screen.getByRole("button", { name: /复制/ }));
    expect(onSubmit).toHaveBeenCalledWith("b.md");
  });
});

describe("LimitNotice", () => {
  beforeEach(() => localStorage.clear());

  it("shows notice when not dismissed", () => {
    render(<LimitNotice />);
    expect(screen.getByText(/v1.1.12/)).toBeInTheDocument();
  });

  it("hides after dismiss", async () => {
    render(<LimitNotice />);
    await userEvent.setup().click(screen.getByRole("button", { name: /知道了/ }));
    expect(screen.queryByText(/v1.1.12/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- Dialogs`
Expected: FAIL — undefined 组件。

- [ ] **Step 3: 实现三个组件**

Create `src/components/Files/NewFileDialog.tsx`:

```tsx
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface NewFileDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (path: string, isDir: boolean) => void;
  currentPath: string;
  isDir: boolean;
}

export function NewFileDialog({ open, onClose, onSubmit, currentPath, isDir }: NewFileDialogProps) {
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(""); }, [open]);
  const prefix = currentPath ? `${currentPath}/` : "";
  const submit = () => {
    if (!name.trim()) return;
    onSubmit(`${prefix}${name.trim()}`, isDir);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isDir ? "新建文件夹" : "新建文件"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">路径:{prefix}</p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isDir ? "文件夹名" : "文件名(如 notes.md)"}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={!name.trim()}>创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Create `src/components/Files/CopyDialog.tsx`:

```tsx
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CopyDialogProps {
  open: boolean;
  srcPath: string;
  onClose: () => void;
  onSubmit: (dst: string) => void;
}

export function CopyDialog({ open, srcPath, onClose, onSubmit }: CopyDialogProps) {
  const [dst, setDst] = useState(srcPath);
  useEffect(() => { if (open) setDst(srcPath); }, [open, srcPath]);
  const submit = () => {
    if (!dst.trim() || dst === srcPath) return;
    onSubmit(dst.trim());
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>复制文件</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">源:{srcPath}</p>
          <Input value={dst} onChange={(e) => setDst(e.target.value)} placeholder="目标路径" autoFocus onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={!dst.trim() || dst === srcPath}>复制</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Create `src/components/Files/LimitNotice.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

const KEY = "workpaw.files.limitNoticeSeen";

export function LimitNotice() {
  const [hidden, setHidden] = useState(() => localStorage.getItem(KEY) === "1");
  if (hidden) return null;
  return (
    <div className="flex items-center gap-2 border-b bg-yellow-50 px-3 py-1.5 text-xs text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
      <span>当前 Pod v1.1.12 不支持删除/重命名/移动文件,这些操作置灰。新建/编辑/复制/下载可用。</span>
      <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={() => { localStorage.setItem(KEY, "1"); setHidden(true); }}>
        <X className="size-3" /><span className="sr-only">知道了</span>
      </Button>
    </div>
  );
}
```

注:确认 `@/components/ui/dialog` 存在(desktop 已有 shadcn dialog);若无,先 `npx shadcn@latest add dialog`。

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- Dialogs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/components/Files/NewFileDialog.tsx src/components/Files/CopyDialog.tsx src/components/Files/LimitNotice.tsx src/components/Files/Dialogs.test.tsx
git commit -m "feat(desktop): NewFile/Copy dialogs + LimitNotice banner"
```

---

## Task 10: Files 页面双栏重构(串联)

**Files:**
- Modify: `src/pages/Files.tsx`

**Interfaces:**
- Consumes: 全部新组件 + useWorkspace(code*)+ react-resizable-panels(PanelGroup/Panel/PanelResizeHandle)

- [ ] **Step 1: 写失败测试 — 双栏渲染**

Create `src/pages/Files.filemanager.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Files from "./Files";

vi.mock("@/lib/workspaceApi", () => ({
  listCodeFiles: vi.fn().mockResolvedValue([]),
  loadCodeFile: vi.fn().mockResolvedValue({ content: "" }),
  saveCodeFile: vi.fn().mockResolvedValue(undefined),
  downloadFile: vi.fn(),
  codeFilePreviewUrl: vi.fn(() => "url"),
  downloadWorkspace: vi.fn(),
  uploadWorkspaceFile: vi.fn(),
  getUploadLimit: vi.fn().mockResolvedValue(null),
  getSystemPromptFiles: vi.fn().mockResolvedValue([]),
  listFiles: vi.fn().mockResolvedValue([]),
  listDailyMemory: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/stores/useChatStore", () => ({
  useChatStore: (sel: (s: { selectedAgentId: string | null; podUrl: string }) => unknown) => sel({ selectedAgentId: "a1", podUrl: "http://pod" }),
}));

describe("Files page", () => {
  it("renders dual-pane with tree + list/viewer", async () => {
    render(<Files />);
    expect(screen.getByText("文件树")).toBeInTheDocument();
    expect(screen.getByText(/工作区/)).toBeInTheDocument();
    expect(screen.getByText(/v1.1.12/)).toBeInTheDocument(); // LimitNotice
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- Files.filemanager`
Expected: FAIL — 旧 Files 布局无"文件树"/LimitNotice。

- [ ] **Step 3: 重构 Files.tsx**

替换 `src/pages/Files.tsx` 内容(保留现有 ZIP 上传/下载按钮,重构主区为双栏)。读现有 Files.tsx 头部(import + handleDownload/handleFileUpload)保留,从 return 开始替换为:

```tsx
import { useEffect, useRef, useState } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useChatStore } from "@/stores/useChatStore";
import { getUploadLimit, uploadWorkspaceFile, downloadWorkspace } from "@/lib/workspaceApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Upload, Download } from "lucide-react";
import { FileTree } from "@/components/Files/FileTree";
import { FileList } from "@/components/Files/FileList";
import { FileViewer } from "@/components/Files/FileViewer";
import { LimitNotice } from "@/components/Files/LimitNotice";
import { NewFileDialog } from "@/components/Files/NewFileDialog";
import { CopyDialog } from "@/components/Files/CopyDialog";

export default function Files() {
  const ws = useWorkspace();
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [uploadMaxSizeMb, setUploadMaxSizeMb] = useState<number | null>(null);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newDirOpen, setNewDirOpen] = useState(false);
  const [newIsDir, setNewIsDir] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySrc, setCopySrc] = useState("");

  useEffect(() => {
    getUploadLimit().then(setUploadMaxSizeMb).catch(() => setUploadMaxSizeMb(null));
  }, []);

  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      await downloadWorkspace(selectedAgentId || "default");
      toast.success("工作区已下载");
    } catch (e) {
      toast.error("下载失败", { description: e instanceof Error ? e.message : "" });
    } finally {
      setDownloading(false);
    }
  };

  const handleUploadZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".zip")) { toast.error("仅支持 ZIP 文件"); return; }
    if (uploadMaxSizeMb && file.size > uploadMaxSizeMb * 1024 * 1024) { toast.error(`文件过大(上限 ${uploadMaxSizeMb}MB)`); return; }
    try {
      await uploadWorkspaceFile(file);
      toast.success("上传成功");
      ws.fetchCodeFiles();
    } catch (err) {
      toast.error("上传失败", { description: err instanceof Error ? err.message : "" });
    } finally {
      e.target.value = "";
    }
  };

  const handleNewFile = (isDir: boolean) => { setNewIsDir(isDir); isDir ? setNewDirOpen(true) : setNewFileOpen(true); };
  const handleNewSubmit = async (path: string, isDir: boolean) => {
    try {
      if (isDir) await ws.mkdir(path);
      else await ws.newFile(path);
      toast.success(isDir ? "文件夹已创建" : "文件已创建");
    } catch (e) { toast.error("创建失败", { description: e instanceof Error ? e.message : "" }); }
  };
  const handleCopySubmit = async (dst: string) => {
    try {
      await ws.copyFile(copySrc, dst);
      toast.success("复制成功");
    } catch (e) { toast.error("复制失败", { description: e instanceof Error ? e.message : "" }); }
  };

  return (
    <div className="flex h-full flex-col">
      <LimitNotice />
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-sm font-semibold">文件管理</h1>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleUploadZip} />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}><Upload className="size-3.5" /> 上传ZIP</Button>
          <Button variant="outline" size="sm" onClick={handleDownloadZip} disabled={downloading}><Download className="size-3.5" /> 下载ZIP</Button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={25} minSize={15} maxSize={40}>
            <FileTree
              tree={ws.codeTree}
              selectedPath={ws.selectedCodeFile?.path ?? null}
              onSelectFile={ws.selectCodeFile}
              onSelectDir={ws.setCurrentPath}
              onRefresh={ws.fetchCodeFiles}
              loading={ws.codeLoading}
              error={ws.codeError}
            />
          </Panel>
          <PanelResizeHandle className="w-px bg-border" />
          <Panel defaultSize={40} minSize={20}>
            <FileList
              files={ws.codeFiles}
              currentPath={ws.currentPath}
              selectedPath={ws.selectedCodeFile?.path ?? null}
              onSelectFile={ws.selectCodeFile}
              onOpenDir={ws.setCurrentPath}
              onUp={() => ws.setCurrentPath(ws.currentPath.includes("/") ? ws.currentPath.split("/").slice(0, -1).join("/") : "")}
              onDownload={ws.downloadCodeFile}
              onCopy={(p) => { setCopySrc(p); setCopyOpen(true); }}
              onNewFile={() => handleNewFile(false)}
              onNewDir={() => handleNewFile(true)}
              onContextAction={() => {}}
            />
          </Panel>
          <PanelResizeHandle className="w-px bg-border" />
          <Panel defaultSize={35} minSize={20}>
            <FileViewer
              file={ws.selectedCodeFile}
              content={ws.codeFileContent}
              loading={ws.codeLoading}
              hasChanges={ws.codeFileContent !== ws.codeFileContent /* TODO: 原内容对比,见下 */}
              onContentChange={(c) => ws.selectCodeFile /* 占位:需 setCodeFileContent */}
              onSave={async () => {
                if (ws.selectedCodeFile) {
                  try { await ws.saveCodeFileContent(ws.selectedCodeFile.path, ws.codeFileContent); toast.success("已保存"); }
                  catch (e) { toast.error("保存失败", { description: e instanceof Error ? e.message : "" }); }
                }
              }}
              onDownload={ws.downloadCodeFile}
            />
          </Panel>
        </PanelGroup>
      </div>
      <NewFileDialog open={newFileOpen} onClose={() => setNewFileOpen(false)} onSubmit={handleNewSubmit} currentPath={ws.currentPath} isDir={false} />
      <NewFileDialog open={newDirOpen} onClose={() => setNewDirOpen(false)} onSubmit={handleNewSubmit} currentPath={ws.currentPath} isDir={true} />
      <CopyDialog open={copyOpen} srcPath={copySrc} onClose={() => setCopyOpen(false)} onSubmit={handleCopySubmit} />
    </div>
  );
}
```

**注意:hasChanges / onContentChange 需修 useWorkspace**——Task 5 的 useWorkspace 没暴露 `setCodeFileContent` + 原内容对比。在 Task 5 基础上补:`useWorkspace` 加 `codeFileOriginal` state(selectCodeFile 时设 = content),return 加 `codeFileOriginal` + `setCodeFileContent`。FileViewer 的 `hasChanges = codeFileContent !== codeFileOriginal`,`onContentChange={ws.setCodeFileContent}`。本 step 实现时一并修 useWorkspace(在 selectCodeFile 里加 `setCodeFileOriginal(content)`,export `setCodeFileContent` + `codeFileOriginal`)。

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- Files.filemanager`
Expected: PASS。

- [ ] **Step 5: 全量测试 + build**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test && npm run build`
Expected: 全 PASS,build 通过。

- [ ] **Step 6: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/pages/Files.tsx src/hooks/useWorkspace.ts src/pages/Files.filemanager.test.tsx
git commit -m "feat(desktop): Files page dual-pane restructure (tree + list + viewer)"
```

---

## Task 11: FileContextMenu(右键菜单,删除/重命名灰掉)

**Files:**
- Create: `src/components/Files/FileContextMenu.tsx`
- Modify: `src/components/Files/FileList.tsx`(行右键触发)

**Interfaces:**
- Produces: `FileContextMenu` props `{ file: CodeFileEntry; onCopy: () => void; onDownload: () => void; onNewFile: () => void; onNewDir: () => void }`。删除/重命名/移动项 disabled + tooltip。

- [ ] **Step 1: 写失败测试**

Create `src/components/Files/FileContextMenu.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileContextMenu } from "./FileContextMenu";

describe("FileContextMenu", () => {
  it("renders enabled copy/download + disabled delete/rename/move", () => {
    const onCopy = vi.fn();
    render(<FileContextMenu file={{ path: "a.md", filename: "a.md", size: 1, modified_time: "" }} onCopy={onCopy} onDownload={() => {}} onNewFile={() => {}} onNewDir={() => {}} />);
    expect(screen.getByText("复制")).not.toBeDisabled();
    expect(screen.getByText("下载")).not.toBeDisabled();
    expect(screen.getByText("删除")).toBeDisabled();
    expect(screen.getByText("重命名")).toBeDisabled();
    expect(screen.getByText("移动")).toBeDisabled();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- FileContextMenu`
Expected: FAIL — undefined。

- [ ] **Step 3: 实现 FileContextMenu**

Create `src/components/Files/FileContextMenu.tsx`:

```tsx
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
} from "@/components/ui/context-menu";
import { Copy, Download, Trash2, Pencil, Move, FilePlus, FolderPlus } from "lucide-react";
import type { CodeFileEntry } from "@/lib/workspaceApi";

interface FileContextMenuProps {
  file: CodeFileEntry;
  onCopy: () => void;
  onDownload: () => void;
  onNewFile: () => void;
  onNewDir: () => void;
  children?: React.ReactNode;
}

export function FileContextMenu({ file, onCopy, onDownload, onNewFile, onNewDir, children }: FileContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children ?? <span />}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onNewFile}><FilePlus className="size-3.5" /> 新建文件</ContextMenuItem>
        <ContextMenuItem onClick={onNewDir}><FolderPlus className="size-3.5" /> 新建文件夹</ContextMenuItem>
        <ContextMenuItem onClick={onCopy}><Copy className="size-3.5" /> 复制</ContextMenuItem>
        <ContextMenuItem onClick={onDownload}><Download className="size-3.5" /> 下载</ContextMenuItem>
        <ContextMenuItem disabled title="v1.1.12 不支持"><Trash2 className="size-3.5" /> 删除</ContextMenuItem>
        <ContextMenuItem disabled title="v1.1.12 不支持"><Pencil className="size-3.5" /> 重命名</ContextMenuItem>
        <ContextMenuItem disabled title="v1.1.12 不支持"><Move className="size-3.5" /> 移动</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

注:确认 `@/components/ui/context-menu` 存在(desktop 已有)。

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-desktop && npm test -- FileContextMenu`
Expected: PASS。

- [ ] **Step 5: 在 FileList 行包 FileContextMenu(可选集成)**

在 FileList.tsx 的 `<tr>` 外层包 FileContextMenu(传 file + 回调)。本 step 为集成,不单独测(FileList 测试已覆盖行交互)。

- [ ] **Step 6: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
git add src/components/Files/FileContextMenu.tsx src/components/Files/FileContextMenu.test.tsx src/components/Files/FileList.tsx
git commit -m "feat(desktop): FileContextMenu with disabled delete/rename/move (v1.1.12)"
```

---

## Self-Review (Plan 1)

**Spec coverage:**
- §3 文件树 → Task 2(buildFileTree)+ Task 6(FileTree)✓
- §4 文件列表(排序/搜索/面包屑/右键)→ Task 7(FileList)+ Task 11(ContextMenu)✓
- §5 多格式预览路由(MD/HTML/文本/图片/视频;PDF/CSV/Office 占位)→ Task 8 ✓(完整预览组件 Plan 2)
- §6 文件图标 → Task 3 ✓
- §7 生命周期(新建/建目录/编辑/复制/下载;删除/重命名/移动灰掉)→ Task 5(useWorkspace)+ Task 9(Dialogs)+ Task 11(disabled)✓
- §7.1 首次提示条 → Task 9(LimitNotice)✓
- §10 错误降级(树加载失败/空态/大文件)→ Task 6(FileTree error/empty/loading)+ Task 8(下载提示)✓
- §1 双栏布局 → Task 10(PanelGroup)✓

**Placeholder scan:** Task 10 Step 3 的 hasChanges/onContentChange 有"TODO: 原内容对比"——已在 step 说明里要求补 useWorkspace(codeFileOriginal + setCodeFileContent),非占位而是明确补充指令。其余无 TBD。

**Type consistency:** `FileTreeNode`/`FlatFileEntry`(Task 2)全程一致;`CodeFileEntry`(Task 4)全程一致;`useWorkspace` 新增字段(Task 5)在 Task 10 消费一致(`codeTree`/`selectedCodeFile`/`codeFileContent`/`fetchCodeFiles`/`selectCodeFile`/`setCurrentPath`/`newFile`/`mkdir`/`copyFile`/`downloadCodeFile`/`saveCodeFileContent`)。

**依赖:** Plan 1 只需 react-complex-tree(实际用自建树,依赖保留供后续)+ react-textarea-autosize(Task 1)。PDF/CSV/Office 预览组件在 Plan 2(需 react-pdf/papaparse/@tanstack/react-table/docx-preview/SheetJS)。

**风险点(已标注):**
- Task 8 的 PDF/CSV/Office 占位"Plan 2 接入",Plan 2 需替换为真实组件。
- Task 10 的 hasChanges 需补 useWorkspace(Task 5 基础上加 codeFileOriginal),step 已说明。
- Task 6 用自建递归树替代 react-complex-tree(更轻可控),react-complex-tree 依赖保留但 v1 未用;若后续需多选/DnD/虚拟滚动再切。
