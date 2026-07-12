# Desktop 文件管理系统 — Plan 2:多格式预览组件 + chat@文件

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Plan 1(`2026-06-27-file-manager-core.md`)已实现——Files 双栏骨架(FileTree/FileList/FileViewer 路由)+ useWorkspace code-files + 生命周期。FileViewer 对 PDF/CSV/docx/xlsx 是占位"Plan 2 接入"。

**Goal:** 实现各格式真实预览组件(PDF/CSV/docx/xlsx 懒加载 + 图片 lightbox),替换 Plan 1 占位;并加 chat @文件选择器(输入 @ 触发,文本插内容,二进制引导附件)。

**Architecture:** 预览组件放 `src/components/Files/preview/`,重组件 `React.lazy` 懒加载(打开对应文件才加载),各包 ErrorBoundary。PDF 用 react-pdf(+ pdfjs worker Vite 配置),docx 用 docx-preview,xlsx 用 SheetJS(CDN 版)+ react-table,CSV 用 papaparse + react-table,图片用 yet-another-react-lightbox。chat @文件:ChatInput 加 `@` 触发(类似现有 `/` 斜杠),FileMentionPicker 用 cmdk(已装)做搜索选择,文本文件读内容插入,二进制提示附件上传。

**Tech Stack:** React 19, react-pdf(新), yet-another-react-lightbox(新), papaparse(新), @tanstack/react-table(新), docx-preview(新), SheetJS(CDN 新), cmdk(已装), vitest。

## Global Constraints

- 重组件(PDF/docx/xlsx)必须 `React.lazy` 懒加载 + ErrorBoundary(spec §5.1、§10)。
- react-pdf worker 用 Vite `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`(避免 CDN 依赖)。
- SheetJS 从 CDN(`https://cdn.sheetjs.com`)装最新社区版(npm 0.18.5 有 CVE)。
- HTML 沙箱 `<iframe sandbox="allow-same-origin" srcdoc>` 不加 allow-scripts(Plan 1 已实现,本 plan 不动)。
- chat @文件:文本插 `[引用文件: path]\n{content}`(>10KB 确认);二进制提示"用附件按钮上传"。
- 设计语言:克制(Signal Orange ≤10%、扁平、reduced-motion)、WCAG AA。
- 每 task 结束 commit;分支 `feat/file-manager-previews`。
- 测试:vi.mock 重组件库(jsdom 渲染受限),重点测路由 + 数据流 + 降级。

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `package.json` | 修改 | 加 react-pdf、yet-another-react-lightbox、papaparse、@tanstack/react-table、docx-preview;SheetJS CDN |
| `vite.config.ts` | 修改 | pdfjs worker 配置(optimizeDeps/worker) |
| `src/components/Files/preview/PDFPreview.tsx` | 新建(懒加载) | react-pdf 渲染 |
| `src/components/Files/preview/CSVPreview.tsx` | 新建 | papaparse + react-table |
| `src/components/Files/preview/DocxPreview.tsx` | 新建(懒加载) | docx-preview 渲染到 div |
| `src/components/Files/preview/XlsxPreview.tsx` | 新建(懒加载) | SheetJS + react-table |
| `src/components/Files/preview/ImageLightbox.tsx` | 新建 | yet-another-react-lightbox |
| `src/components/Files/preview/ErrorBoundary.tsx` | 新建 | 预览组件崩溃兜底 |
| `src/components/Files/FileViewer.tsx` | 修改 | 集成真实预览(替换占位)+ 图片用 lightbox |
| `src/components/Chat/FileMentionPicker.tsx` | 新建 | @文件选择器(cmdk) |
| `src/components/Chat/ChatInput.tsx` | 修改 | @触发 + 选中插入 |
| `src/lib/workspaceApi.ts` | 修改 | 加 loadCodeFile 已有(FileMentionPicker 复用) |
| 测试 | 新建 | 各预览路由 + FileMentionPicker |

---

## Task 1: 安装预览依赖 + Vite worker 配置

**Files:**
- Modify: `package.json`、`vite.config.ts`

- [ ] **Step 1: 安装 npm 依赖**

Run:
```bash
cd /Users/zhangsan/workpaw/workpaw-desktop
npm install react-pdf yet-another-react-lightbox papaparse @tanstack/react-table docx-preview
npm install -D @types/papaparse
```

- [ ] **Step 2: 安装 SheetJS(CDN 版,避开 npm CVE)**

Run:
```bash
npm install --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```
(若 URL 失败,按 SheetJS 官方文档配 registry:在 `.npmrc` 加 `xlsx=https://cdn.sheetjs.com/xlsx-0.20.3` 后 `npm install xlsx`。)

- [ ] **Step 3: Vite pdfjs worker 配置**

读 `vite.config.ts`,在 `defineConfig(async () => ({ ... }))` 内加 `optimizeDeps`(预构建 pdfjs-dist)和 `worker`(worker format):

```ts
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: { /* 现有 alias */ },
  // pdfjs-dist worker 预构建
  optimizeDeps: {
    include: ["pdfjs-dist/build/pdf.worker.min.mjs"],
  },
  worker: {
    format: "es",
  },
  clearScreen: false,
  server: { /* 现有 */ },
}));
```

- [ ] **Step 4: 确认 build 不破**

Run: `npm run build`
Expected: build 成功。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts .npmrc 2>/dev/null
git commit -m "chore(desktop): add preview deps (react-pdf/lightbox/papaparse/react-table/docx-preview/xlsx) + pdfjs worker"
```

---

## Task 2: ErrorBoundary + 图片 lightbox

**Files:**
- Create: `src/components/Files/preview/ErrorBoundary.tsx`、`src/components/Files/preview/ImageLightbox.tsx`

**Interfaces:**
- Produces: `PreviewErrorBoundary`(props `{ children; fallback?: ReactNode; onDownload?: () => void }`);`ImageLightbox`(props `{ src: string; alt: string }`)

- [ ] **Step 1: 写失败测试**

Create `src/components/Files/preview/PreviewErrorBoundary.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreviewErrorBoundary } from "./ErrorBoundary";

const Boom = () => { throw new Error("boom"); };

describe("PreviewErrorBoundary", () => {
  it("renders fallback on crash", () => {
    render(<PreviewErrorBoundary><Boom /></PreviewErrorBoundary>);
    expect(screen.getByText(/加载失败/)).toBeInTheDocument();
  });

  it("renders children when no crash", () => {
    render(<PreviewErrorBoundary><div>ok</div></PreviewErrorBoundary>);
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm test -- PreviewErrorBoundary`
Expected: FAIL — undefined。

- [ ] **Step 3: 实现 ErrorBoundary**

Create `src/components/Files/preview/ErrorBoundary.tsx`:

```tsx
import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface Props { children: ReactNode; onDownload?: () => void; }
interface State { hasError: boolean; }

export class PreviewErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(): State { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <div className="space-y-2 text-center">
            <p>预览组件加载失败</p>
            {this.props.onDownload && (
              <Button variant="outline" size="sm" onClick={this.props.onDownload}><Download className="size-3.5" /> 下载查看</Button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: 实现 ImageLightbox**

Create `src/components/Files/preview/ImageLightbox.tsx`:

```tsx
import { useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

export function ImageLightbox({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex items-center justify-center">
      <img src={src} alt={alt} onClick={() => setOpen(true)} className="max-h-[70vh] cursor-zoom-in rounded-md" />
      <Lightbox
        open={open}
        close={() => setOpen(false)}
        slides={[{ src }]}
        plugins={[Zoom]}
      />
    </div>
  );
}
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `npm test -- PreviewErrorBoundary`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/components/Files/preview/ErrorBoundary.tsx src/components/Files/preview/ImageLightbox.tsx src/components/Files/preview/PreviewErrorBoundary.test.tsx
git commit -m "feat(desktop): PreviewErrorBoundary + ImageLightbox (yet-another-react-lightbox)"
```

---

## Task 3: PDFPreview(react-pdf 懒加载)

**Files:**
- Create: `src/components/Files/preview/PDFPreview.tsx`

**Interfaces:**
- Consumes: react-pdf(`Document`/`Page`/`pdfjs`)、`codeFilePreviewUrl`
- Produces: `PDFPreview` props `{ path: string }`,默认导出(供 React.lazy)

- [ ] **Step 1: 写失败测试(路由级,渲染 mock)**

Create `src/components/Files/preview/PDFPreview.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-pdf", () => ({
  Document: ({ onLoadSuccess, children }: any) => {
    setTimeout(() => onLoadSuccess({ numPages: 2 }), 0);
    return <div data-testid="doc">{children}</div>;
  },
  Page: ({ pageNumber }: any) => <div data-testid={`page-${pageNumber}`} />,
  pdfjs: { GlobalWorkerOptions: {} },
}));

import PDFPreview from "./PDFPreview";

describe("PDFPreview", () => {
  it("renders document + pages", async () => {
    render(<PDFPreview path="a.pdf" />);
    expect(await screen.findByTestId("doc")).toBeInTheDocument();
    expect(await screen.findByTestId("page-1")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm test -- PDFPreview`
Expected: FAIL — undefined。

- [ ] **Step 3: 实现 PDFPreview**

Create `src/components/Files/preview/PDFPreview.tsx`:

```tsx
import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { codeFilePreviewUrl } from "@/lib/workspaceApi";

// Vite worker 配置(Plan 2 Task 1 已配 optimizeDeps)
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export default function PDFPreview({ path }: { path: string }) {
  const [numPages, setNumPages] = useState<number>(0);
  const url = codeFilePreviewUrl(path);
  return (
    <div className="flex justify-center overflow-auto">
      <Document file={url} onLoadSuccess={({ numPages }) => setNumPages(numPages)} loading={<p className="text-sm text-muted-foreground">PDF 加载中…</p>} error={<p className="text-sm text-destructive">PDF 加载失败</p>}>
        {Array.from({ length: numPages }, (_, i) => (
          <Page key={i} pageNumber={i + 1} className="mb-2 shadow-sm" width={800} />
        ))}
      </Document>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npm test -- PDFPreview`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/Files/preview/PDFPreview.tsx src/components/Files/preview/PDFPreview.test.tsx
git commit -m "feat(desktop): PDFPreview (react-pdf + pdfjs worker)"
```

---

## Task 4: CSVPreview(papaparse + react-table)

**Files:**
- Create: `src/components/Files/preview/CSVPreview.tsx`

**Interfaces:**
- Consumes: papaparse、`@tanstack/react-table`、`content`(文本)
- Produces: `CSVPreview` props `{ content: string }`

- [ ] **Step 1: 写失败测试**

Create `src/components/Files/preview/CSVPreview.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CSVPreview } from "./CSVPreview";

describe("CSVPreview", () => {
  it("renders csv as table", () => {
    render(<CSVPreview content={"name,age\nAlice,30\nBob,25"} />);
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("shows empty state for invalid csv", () => {
    render(<CSVPreview content="" />);
    expect(screen.getByText(/无数据/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm test -- CSVPreview`
Expected: FAIL — undefined。

- [ ] **Step 3: 实现 CSVPreview**

Create `src/components/Files/preview/CSVPreview.tsx`:

```tsx
import { useMemo } from "react";
import Papa from "papaparse";
import { useTable, type ColumnDef } from "@tanstack/react-table";

export function CSVPreview({ content }: { content: string }) {
  const { data, columns } = useMemo(() => {
    const parsed = Papa.parse<string[]>(content.trim(), { skipEmptyLines: true });
    const rows = parsed.data as string[][];
    if (rows.length === 0) return { data: [], columns: [] };
    const headers = rows[0];
    const cols: ColumnDef<string[]>[] = headers.map((h, i) => ({
      accessorFn: (row) => row[i], header: h, id: `col-${i}`,
    }));
    const body = rows.slice(1).map((r) => [...r]);
    return { data: body, columns: cols };
  }, [content]);

  if (data.length === 0 && columns.length === 0) {
    return <p className="text-sm text-muted-foreground">无数据</p>;
  }

  const table = useTable({ data, columns });
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead className="border-b bg-muted/50">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>{hg.headers.map((h) => <th key={h.id} className="px-2 py-1 text-left">{h.isPlaceholder ? null : h.column.columnDef.header}</th>)}</tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b">{row.getVisibleCells().map((cell) => <td key={cell.id} className="px-2 py-1">{String(cell.getValue() ?? "")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npm test -- CSVPreview`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/Files/preview/CSVPreview.tsx src/components/Files/preview/CSVPreview.test.tsx
git commit -m "feat(desktop): CSVPreview (papaparse + tanstack/react-table)"
```

---

## Task 5: DocxPreview + XlsxPreview(懒加载)

**Files:**
- Create: `src/components/Files/preview/DocxPreview.tsx`、`src/components/Files/preview/XlsxPreview.tsx`

**Interfaces:**
- Consumes: docx-preview(`renderAsync`)、xlsx(SheetJS)、`codeFilePreviewUrl`(fetch blob)
- Produces: 两个默认导出组件(props `{ path: string }`)

- [ ] **Step 1: 写失败测试(DocxPreview mock)**

Create `src/components/Files/preview/DocxPreview.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const renderAsyncMock = vi.fn().mockResolvedValue(undefined);
vi.mock("docx-preview", () => ({ renderAsync: (...a: unknown[]) => renderAsyncMock(...a) }));
vi.mock("@/lib/workspaceApi", () => ({ codeFilePreviewUrl: () => "url" }));
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()) }));

import DocxPreview from "./DocxPreview";

describe("DocxPreview", () => {
  it("renders container and calls renderAsync", async () => {
    render(<DocxPreview path="a.docx" />);
    expect(await screen.findByTestId("docx-container")).toBeInTheDocument();
    expect(renderAsyncMock).toHaveBeenCalled();
  });
});
```

Create `src/components/Files/preview/XlsxPreview.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const readMock = vi.fn().mockReturnValue({ SheetNames: ["S1"], Sheets: { S1: { A1: { t: "s", v: "hi" }, "!ref": "A1" } } });
vi.mock("xlsx", () => ({ read: (...a: unknown[]) => readMock(...a), utils: { sheet_to_json: () => [["hi"]] } }));
vi.mock("@/lib/workspaceApi", () => ({ codeFilePreviewUrl: () => "url" }));
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()) }));

import XlsxPreview from "./XlsxPreview";

describe("XlsxPreview", () => {
  it("renders sheet data", async () => {
    render(<XlsxPreview path="a.xlsx" />);
    expect(await screen.findByText("hi")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm test -- DocxPreview XlsxPreview`
Expected: FAIL — undefined。

- [ ] **Step 3: 实现 DocxPreview**

Create `src/components/Files/preview/DocxPreview.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { codeFilePreviewUrl } from "@/lib/workspaceApi";

export default function DocxPreview({ path }: { path: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(codeFilePreviewUrl(path));
        if (!res.ok) throw new Error("fetch");
        const blob = await res.blob();
        if (!cancelled && ref.current) {
          ref.current.innerHTML = "";
          await renderAsync(blob, ref.current);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);
  if (error) return <p className="text-sm text-destructive">docx 加载失败</p>;
  return <div ref={ref} data-testid="docx-container" className="overflow-auto bg-white p-4" />;
}
```

- [ ] **Step 4: 实现 XlsxPreview**

Create `src/components/Files/preview/XlsxPreview.tsx`:

```tsx
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { codeFilePreviewUrl } from "@/lib/workspaceApi";

export default function XlsxPreview({ path }: { path: string }) {
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(codeFilePreviewUrl(path));
        if (!res.ok) throw new Error("fetch");
        const blob = await res.blob();
        const buf = await blob.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
        if (!cancelled) setRows(json);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);
  if (error) return <p className="text-sm text-destructive">xlsx 加载失败</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">加载中…</p>;
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b">{row.map((cell, j) => <td key={j} className="px-2 py-1">{String(cell ?? "")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `npm test -- DocxPreview XlsxPreview`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/components/Files/preview/DocxPreview.tsx src/components/Files/preview/XlsxPreview.tsx src/components/Files/preview/DocxPreview.test.tsx src/components/Files/preview/XlsxPreview.test.tsx
git commit -m "feat(desktop): DocxPreview (docx-preview) + XlsxPreview (SheetJS)"
```

---

## Task 6: FileViewer 集成真实预览(替换占位)

**Files:**
- Modify: `src/components/Files/FileViewer.tsx`

**Interfaces:**
- Consumes: 各预览组件(React.lazy)+ PreviewErrorBoundary + ImageLightbox
- Produces: FileViewer 对 pdf/csv/docx/xlsx 用真实组件(懒加载 + ErrorBoundary),图片用 ImageLightbox。

- [ ] **Step 1: 写失败测试 — PDF 路由到 PDFPreview**

在 `src/components/Files/FileViewer.test.tsx` 加(替换原"pdf 占位"测试):

```tsx
it("renders PDFPreview for .pdf", async () => {
  vi.mock("@/components/Files/preview/PDFPreview", () => ({ default: () => <div data-testid="pdf-preview" /> }));
  render(<FileViewer file={mk("a.pdf")} {...baseProps} />);
  expect(await screen.findByTestId("pdf-preview")).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm test -- FileViewer`
Expected: FAIL(旧占位"加载中")。

- [ ] **Step 3: 改 FileViewer 集成**

在 `FileViewer.tsx` 顶部加懒加载 import:
```tsx
import { Suspense, lazy } from "react";
import { PreviewErrorBoundary } from "./preview/ErrorBoundary";
import { ImageLightbox } from "./preview/ImageLightbox";
const PDFPreview = lazy(() => import("./preview/PDFPreview"));
const CSVPreview = lazy(() => import("./preview/CSVPreview").then((m) => ({ default: m.CSVPreview })));
const DocxPreview = lazy(() => import("./preview/DocxPreview"));
const XlsxPreview = lazy(() => import("./preview/XlsxPreview"));
```

替换预览区渲染(图片改 ImageLightbox;pdf/csv/docx/xlsx 用懒加载 + ErrorBoundary + Suspense):

```tsx
{isText ? (
  /* 现有 textarea/streamdown 编辑 */
) : isImage ? (
  <ImageLightbox src={previewUrl} alt={file.filename} />
) : isVideo ? (
  <video controls src={previewUrl} className="max-h-[70vh] rounded-md" />
) : isHtml ? (
  <iframe sandbox="allow-same-origin" srcDoc={content} className="h-[70vh] w-full rounded-md border" title={file.filename} />
) : ext === "pdf" ? (
  <PreviewErrorBoundary onDownload={() => onDownload(file.path)}>
    <Suspense fallback={<p className="text-sm text-muted-foreground">PDF 加载中…</p>}>
      <PDFPreview path={file.path} />
    </Suspense>
  </PreviewErrorBoundary>
) : ext === "csv" ? (
  <CSVPreview content={content} />
) : ext === "docx" ? (
  <PreviewErrorBoundary onDownload={() => onDownload(file.path)}>
    <Suspense fallback={<p className="text-sm text-muted-foreground">docx 加载中…</p>}>
      <DocxPreview path={file.path} />
    </Suspense>
  </PreviewErrorBoundary>
) : ext === "xlsx" || ext === "xls" ? (
  <PreviewErrorBoundary onDownload={() => onDownload(file.path)}>
    <Suspense fallback={<p className="text-sm text-muted-foreground">xlsx 加载中…</p>}>
      <XlsxPreview path={file.path} />
    </Suspense>
  </PreviewErrorBoundary>
) : (
  /* 现有"不支持预览,下载" */
)}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npm test -- FileViewer`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/Files/FileViewer.tsx src/components/Files/FileViewer.test.tsx
git commit -m "feat(desktop): FileViewer integrates lazy previews (pdf/csv/docx/xlsx) + lightbox"
```

---

## Task 7: FileMentionPicker(chat @文件选择器)

**Files:**
- Create: `src/components/Chat/FileMentionPicker.tsx`

**Interfaces:**
- Consumes: `listCodeFiles`(workspaceApi)、`loadCodeFile`、cmdk(Command)
- Produces: `FileMentionPicker` props `{ query: string; onSelect: (path: string, content: string | null) => void; onDismiss: () => void }`。文本文件读 content 返回;二进制返回 null(调用方提示)。

- [ ] **Step 1: 写失败测试**

Create `src/components/Chat/FileMentionPicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileMentionPicker } from "./FileMentionPicker";

const listCodeFilesMock = vi.fn();
const loadCodeFileMock = vi.fn();
vi.mock("@/lib/workspaceApi", () => ({
  listCodeFiles: (...a: unknown[]) => listCodeFilesMock(...a),
  loadCodeFile: (...a: unknown[]) => loadCodeFileMock(...a),
}));

describe("FileMentionPicker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders matching files", async () => {
    listCodeFilesMock.mockResolvedValue([
      { path: "docs/notes.md", filename: "notes.md", size: 10, modified_time: "" },
      { path: "README.md", filename: "README.md", size: 20, modified_time: "" },
      { path: "logo.png", filename: "logo.png", size: 30, modified_time: "" },
    ]);
    render(<FileMentionPicker query="" onSelect={() => {}} onDismiss={() => {}} />);
    await waitFor(() => expect(screen.getByText("docs/notes.md")).toBeInTheDocument());
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("inserts text file content on select", async () => {
    listCodeFilesMock.mockResolvedValue([{ path: "a.md", filename: "a.md", size: 5, modified_time: "" }]);
    loadCodeFileMock.mockResolvedValue({ content: "# hi" });
    const onSelect = vi.fn();
    render(<FileMentionPicker query="" onSelect={onSelect} onDismiss={() => {}} />);
    await waitFor(() => expect(screen.getByText("a.md")).toBeInTheDocument());
    await userEvent.setup().click(screen.getByText("a.md"));
    expect(onSelect).toHaveBeenCalledWith("a.md", "# hi");
  });

  it("returns null content for binary file", async () => {
    listCodeFilesMock.mockResolvedValue([{ path: "logo.png", filename: "logo.png", size: 30, modified_time: "" }]);
    const onSelect = vi.fn();
    render(<FileMentionPicker query="" onSelect={onSelect} onDismiss={() => {}} />);
    await waitFor(() => expect(screen.getByText("logo.png")).toBeInTheDocument());
    await userEvent.setup().click(screen.getByText("logo.png"));
    expect(onSelect).toHaveBeenCalledWith("logo.png", null);
  });

  it("filters by query", async () => {
    listCodeFilesMock.mockResolvedValue([
      { path: "a.md", filename: "a.md", size: 1, modified_time: "" },
      { path: "b.md", filename: "b.md", size: 1, modified_time: "" },
    ]);
    render(<FileMentionPicker query="b" onSelect={() => {}} onDismiss={() => {}} />);
    await waitFor(() => expect(screen.getByText("b.md")).toBeInTheDocument());
    expect(screen.queryByText("a.md")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm test -- FileMentionPicker`
Expected: FAIL — undefined。

- [ ] **Step 3: 实现 FileMentionPicker**

Create `src/components/Chat/FileMentionPicker.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { listCodeFiles, loadCodeFile, type CodeFileEntry } from "@/lib/workspaceApi";
import { fileIcon } from "@/lib/fileIcon";

const BINARY_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "pdf", "mp4", "webm", "ogg", "mov", "docx", "xlsx", "xls", "pptx", "zip"];

function extOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}
function isBinary(path: string): boolean {
  return BINARY_EXTS.includes(extOf(path));
}

interface FileMentionPickerProps {
  query: string;
  onSelect: (path: string, content: string | null) => void;
  onDismiss: () => void;
}

export function FileMentionPicker({ query, onSelect, onDismiss }: FileMentionPickerProps) {
  const [files, setFiles] = useState<CodeFileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listCodeFiles().then(setFiles).catch(() => setFiles([])).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return files;
    const q = query.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, query]);

  const handleSelect = async (file: CodeFileEntry) => {
    if (isBinary(file.path)) {
      onSelect(file.path, null);  // 调用方提示附件上传
      return;
    }
    try {
      const { content } = await loadCodeFile(file.path);
      onSelect(file.path, content);
    } catch {
      onSelect(file.path, null);
    }
  };

  return (
    <Command className="rounded-lg border shadow-md" onKeyDown={(e) => e.key === "Escape" && onDismiss()}>
      <CommandInput placeholder="搜索工作区文件…" value={query} onValueChange={() => {}} />
      <CommandList className="max-h-64">
        <CommandEmpty>{loading ? "加载中…" : "无匹配文件"}</CommandEmpty>
        <CommandGroup>
          {filtered.map((f) => {
            const Icon = fileIcon(f.filename);
            return (
              <CommandItem key={f.path} value={f.path} onSelect={() => handleSelect(f)}>
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.path}</span>
                {isBinary(f.path) && <span className="ml-auto text-[10px] text-muted-foreground">二进制</span>}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
```

注:确认 `@/components/ui/command` 存在(cmdk,desktop 应已有;若无 `npx shadcn@latest add command`)。

- [ ] **Step 4: 运行测试,确认通过**

Run: `npm test -- FileMentionPicker`
Expected: PASS(4 tests)。

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/FileMentionPicker.tsx src/components/Chat/FileMentionPicker.test.tsx
git commit -m "feat(desktop): FileMentionPicker (cmdk-based @file selector)"
```

---

## Task 8: ChatInput @触发集成

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx`

**Interfaces:**
- Consumes: `FileMentionPicker`、`usePromptInputController`
- Produces: chat 输入 `@` 触发 FileMentionPicker;选中文本文件插入 `[引用文件: path]\n{content}`;二进制 toast"请用附件按钮上传"。

- [ ] **Step 1: 写失败测试 — @触发 + 文本插入**

Create `src/components/Chat/ChatInput.mention.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatInput from "./ChatInput";

vi.mock("@/stores/useChatStore", () => ({
  useChatStore: (sel: any) => sel({ sendMessage: vi.fn(), streaming: false, podUrl: "http://x", selectedAgentId: "a1" }),
}));
vi.mock("@/lib/podApi", () => ({ uploadFile: vi.fn() }));
vi.mock("@/lib/workspaceApi", () => ({
  listCodeFiles: vi.fn().mockResolvedValue([{ path: "notes.md", filename: "notes.md", size: 5, modified_time: "" }]),
  loadCodeFile: vi.fn().mockResolvedValue({ content: "# hi" }),
  listFiles: vi.fn().mockResolvedValue([]), getSystemPromptFiles: vi.fn().mockResolvedValue([]), listDailyMemory: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/stores/useScenarioStore", () => ({ useScenarioStore: () => ({ scenarios: [], fetchScenarios: vi.fn() }) }));

describe("ChatInput @file", () => {
  beforeEach(() => localStorage.clear());

  it("typing @ shows file picker, selecting inserts content", async () => {
    const user = userEvent.setup();
    render(<ChatInput />);
    const ta = screen.getByPlaceholderText(/输入你的问题/) as HTMLTextAreaElement;
    await user.type(ta, "@");
    await waitFor(() => expect(screen.getByText("notes.md")).toBeInTheDocument());
    await user.click(screen.getByText("notes.md"));
    await waitFor(() => expect(ta.value).toContain("[引用文件: notes.md]"));
    expect(ta.value).toContain("# hi");
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm test -- ChatInput.mention`
Expected: FAIL — @不触发 picker。

- [ ] **Step 3: 改 ChatInput 加 @触发**

在 `ChatInput.tsx`:
(a) import 加:
```tsx
import { useState } from "react";
import { FileMentionPicker } from "./FileMentionPicker";
import { toast } from "sonner";
```
(b) 在组件内(SlashSuggestionBar 旁)加 @状态:
```tsx
const controller = usePromptInputController();
const text = controller.textInput.value;
const isMentionMode = text.startsWith("@") && !text.includes(" ");
const [mentionQuery, setMentionQuery] = useState("");
```
注:mentionQuery 从 `text.slice(1)` 派生(输入 `@notes` → query "notes")。

(c) 在 PromptInput 上方(SlashSuggestionBar 同位置)条件渲染 FileMentionPicker:
```tsx
{isMentionMode && (
  <FileMentionPicker
    query={text.slice(1)}
    onSelect={(path, content) => {
      if (content === null) {
        toast.info("二进制文件请用附件按钮上传", { description: path });
      } else if (content.length > 10 * 1024) {
        if (!confirm(`文件 ${path} 内容较长(${content.length} 字符),确认插入?`)) {
          controller.textInput.setInput("");
          return;
        }
        controller.textInput.setInput(`[引用文件: ${path}]\n${content}`);
      } else {
        controller.textInput.setInput(`[引用文件: ${path}]\n${content}`);
      }
    }}
    onDismiss={() => controller.textInput.setInput("")}
  />
)}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npm test -- ChatInput.mention`
Expected: PASS。

- [ ] **Step 5: 全量测试 + build**

Run: `npm test && npm run build`
Expected: 全 PASS,build 通过。

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ChatInput.tsx src/components/Chat/ChatInput.mention.test.tsx
git commit -m "feat(desktop): ChatInput @file trigger (text insert / binary hint)"
```

---

## Self-Review (Plan 2)

**Spec coverage:**
- §5 PDF 预览 → Task 3 ✓
- §5 图片 lightbox → Task 2(ImageLightbox)+ Task 6(集成)✓
- §5 CSV → Task 4 ✓
- §5 docx → Task 5 ✓
- §5 xlsx → Task 5 ✓
- §5 pptx 下载 → Plan 1 Task 8 已实现(未知格式下载)✓
- §5.1 懒加载 + ErrorBoundary → Task 2(ErrorBoundary)+ Task 6(Suspense/lazy)✓
- §5.1 react-pdf worker → Task 1(vite worker)+ Task 3 ✓
- §5.1 SheetJS CDN → Task 1 ✓
- §8 chat @文件选择器 → Task 7 ✓
- §8.3 文本插内容/二进制提示 → Task 7 + Task 8 ✓
- §8.3 大文件 >10KB 确认 → Task 8 ✓
- §10 懒加载组件失败 ErrorBoundary → Task 2/6 ✓

**Placeholder scan:** 无 TBD;所有 step 含完整代码。

**Type consistency:** `CodeFileEntry` 从 workspaceApi(Plan 1)复用;预览组件 props `{path}`/`{content}` 一致;`FileMentionPicker.onSelect(path, content|null)` 与 Task 8 消费一致。

**依赖:** Plan 1 的 FileViewer(占位)+ useWorkspace(code-files)+ fileIcon 在本 plan 被替换/复用。Plan 2 Task 6 替换 FileViewer 占位为真实预览。

**风险点:**
- Task 1 SheetJS CDN 安装:若 tgz URL 失败,用 .npmrc registry 方式(已备选)。
- Task 3 react-pdf worker:Vite 配置 + worker URL,jsdom 测试 mock pdfjs;真机需验证 worker 加载。
- Task 7 cmdk 组件:确认 desktop 有 `@/components/ui/command`(若无 shadcn add)。
- Task 8 ChatInput 改动较大,需确认不破坏现有斜杠命令 + 附件上传(全量测试把关)。
