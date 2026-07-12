# Desktop 文件管理系统(Linux 风格)— 设计文档

- **日期**:2026-06-27
- **状态**:已确认设计,待用户复核 spec → 转 writing-plans
- **关联**:增强 workpaw-desktop Files 页面;不改 QwenPaw Pod(v1.1.12 锁定)

---

## 0. 背景与目标

### 0.1 问题

WorkPaw Desktop 的 Files 页面当前只支持 `.md` 文件,卡片列表(非树),操作有限(查看/编辑/上传ZIP/下载ZIP/启停/排序)。用户(尤其非技术人员)无法管理 Agent 生成的多种格式文件(HTML/Markdown/Office/PDF/图片/视频),也无法像文件管理器一样浏览目录树。

### 0.2 目标

把 Files 页面重构为**类 Linux 文件管理系统**:双栏(目录树 + 文件列表/预览),支持常见文件格式预览(文本/图片/PDF/视频/CSV/Office),完整生命周期管理(新建/编辑/复制/下载),并支持 chat 里 @文件 引用 workspace 文件给 Agent。面向非技术人员(预览为主,轻量编辑)。

### 0.3 已确认的关键决策

1. **不改 Pod(v1.1.12 锁定)**:用 Pod 已有的 `/workspace/code-files`(递归列表+读写)、`/binary-files`(图片/PDF 二进制)、`/files/preview`(任意文件 FileResponse)、`/download`、`/upload` API。删除/重命名/移动无端点,UI 灰掉。
2. **双栏布局**:左目录树 + 右列表/预览(经典文件管理器)。
3. **格式范围**:Pod 原生(文本/图片/PDF/视频/CSV)+ Office 前端库(docx/xlsx;pptx 下载)。
4. **chat @文件选择器**:chat 输入 @ 触发,文本文件插内容,二进制引导附件。
5. **预览为主 + 轻量编辑**:非技术人员,文本/MD 用 react-textarea-autosize 编辑,其他只读预览。不用 CodeMirror。
6. **尽量用成熟 React 组件**,不重复造轮子(研究结论见 §2)。

### 0.4 约束

- QwenPaw Pod 锁定 v1.1.12,不改 Pod 代码(memory: qwenpaw-version)。
- 删除/重命名/移动/建目录(MKDIR)端点缺失,v1 不支持(灰掉 + 提示)。
- 文件操作经 Pod API(desktop 直连 Pod,`X-Agent-Id` header,agent-scoped)。
- 设计语言遵循 WorkPaw "精密控制台"(Signal Orange ≤10%、扁平无阴影、Shadcn/base-ui、Geist、WCAG AA)。

---

## 1. 架构与数据流

### 1.1 纯前端增强,不改 Pod

desktop Files 页面重构为双栏文件管理器,复用 Pod 已有但前端未用的 workspace API:

```
┌─ desktop Files 页面 ─────────────────────────────────────────┐
│  [搜索] [↑上级] [+新建文件] [+新建文件夹] [刷新] [下载ZIP]    │
├──────────────┬──────────────────────────────────────────────┤
│ 目录树        │  文件列表(当前目录) / 文件预览(选中时)      │
│ react-complex │  ┌─ 面包屑:工作区/docs ──────────────────┐  │
│ -tree         │  │ 📄 notes.md   2KB  2026-06-26          │  │
│ (递归,折叠)  │  │ 🖼️ logo.png   15KB                     │  │
│ 📂工作区      │  │ 📑 report.pdf 1MB                      │  │
│  📂docs       │  │ 🎬 demo.mp4   5MB                      │  │
│  📂images     │  └────────────────────────────────────────┘  │
│  📄a.md       │  选中 → 右栏切换预览(按格式路由)           │
└──────────────┴──────────────────────────────────────────────┘
        ↓ Pod API(直连,X-Agent-Id header)
┌─ QwenPaw Pod /api/workspace(已有,不改)──────────────────────┐
│ GET  /code-files              递归列表(path 字段含目录层级)  │
│ GET  /code-files/{path}       读任意文本(<=5MB, UTF-8)      │
│ PUT  /code-files/{path}       写文本(auto mkdir parent)     │
│ GET  /binary-files/{path}     图片/PDF/CSV 二进制(<=50MB)   │
│ GET  /files/preview/{path}    任意文件 FileResponse(视频等) │
│ GET  /watch                   SSE 文件变更(v2 接)           │
│ GET  /download                全工作区 ZIP                    │
│ POST /upload                  ZIP merge                       │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 关键边界判断

- **文件操作走 Pod 但不改 Pod**:Pod v1.1.12 锁定,文件读写/列表用 Pod 已有 code-files/binary-files/files-preview,不新增 Pod 端点;删除/重命名/移动缺端点,v1 灰掉(见 §7)。
- **文件树构建**:`GET /code-files` 返回扁平列表(每项 `path` 如 `docs/sub/notes.md`),前端按 path 分隔符构建递归树喂 react-complex-tree。
- **预览路由**:按扩展名/MIME 路由到对应预览组件,重组件 `React.lazy` 懒加载(只在打开该类型文件时加载)。
- **生命周期边界**:见 §7(不改 Pod 的硬限制)。

---

## 2. 组件选型(研究结论,均活跃维护 + React 19 兼容)

| 功能 | 选型 | 理由 |
|---|---|---|
| 文件树 | **react-complex-tree** | 0 依赖(17KB gzip)、活跃(2026-06 更新)、Tailwind 可定制、多选+DnD+无障碍 |
| Markdown 预览 | **streamdown**(已装) | Vercel 官方,已在用,LLM 流式 Markdown |
| HTML 预览 | **原生 `<iframe sandbox srcdoc>`** | 无 XSS(不加 allow-scripts) |
| PDF 预览 | **react-pdf**(懒加载) | pdf.js 薄封装,活跃;需配 worker |
| 图片 lightbox | **yet-another-react-lightbox** | 0 依赖、缩放/旋转、活跃 |
| 视频 | **原生 `<video controls>`** | 浏览器原生(mp4/webm) |
| CSV | **papaparse + @tanstack/react-table** | 顶流,headless 表格配 Shadcn 样式 |
| docx | **docx-preview**(懒加载) | 保排版(优于 mammoth 丢样式) |
| xlsx | **SheetJS(CDN 版)+ react-table**(懒加载) | npm 版老旧 CVE,用 CDN 新版 |
| pptx | **不支持预览,下载** | 无成熟前端方案;Pod 锁定不能服务端转 PDF |
| 文本编辑 | **react-textarea-autosize** | 1.6KB 轻量,非技术人员够用 |
| 右键菜单 | **shadcn context-menu**(已装) | radix 2.3.1,已有 |
| 文件图标 | **lucide + 扩展名映射**(已装) | 0 新依赖,SVG 可着色 |

**懒加载分组**(避免首屏重):`react-pdf` + `docx-preview` + `SheetJS` 各自 `React.lazy`,打开对应文件才加载。其他轻量组件直接 import。

**排除**(研究验证不推荐):Chonky(2022 停摆 + 锁 MUI4)、@react-pdf-viewer(仓库 archived)、react-iframe/react-csv-viewer/@uiw-react-textarea(停摆)、pptx 前端库(无成熟方案)、xlsx npm 版(2022 老版 CVE)。

**关键注意**:
- react-pdf worker:Vite 下 `pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`(避免 CDN 依赖)。
- SheetJS:按官方从 `https://cdn.sheetjs.com` 配 registry 安装最新社区版(npm 0.18.5 有 CVE)。
- react-complex-tree:用 `renderNode`/`renderItem` 自定义渲染套 Tailwind className。
- HTML 沙箱:`<iframe sandbox="allow-same-origin" srcdoc={html} />`,**不加 allow-scripts**(防 XSS)。

---

## 3. 文件树(react-complex-tree)

### 3.1 数据源与树构建

`GET /api/workspace/code-files` 返回扁平列表 `[{path:"docs/notes.md", filename, size, modified_time}, ...]`(path 含目录层级)。前端 `buildFileTree(flatList)` 按 path 分隔符拆分,构建 `{name, path, isDir, children, file?}` 递归结构。

### 3.2 样式适配 Shadcn

react-complex-tree 自带默认 CSS,用其 `renderNode`/`renderItem` 自定义渲染,套 Tailwind className:折叠箭头 `ChevronRight`/`ChevronDown`、目录 `Folder`/`FolderOpen`、文件按扩展名映射 lucide 图标。选中态 `bg-accent`,hover `bg-accent/50`。Signal Orange 仅用于当前选中文件的左侧条/勾选。

### 3.3 交互

- 点击目录 → 右栏显示该目录文件列表(面包屑同步)
- 点击文件 → 右栏切换预览
- 树可折叠/展开,记住展开状态(localStorage `workpaw.files.expandedPaths`)
- 右键目录 → 新建文件/文件夹/下载ZIP(在该目录下)

---

## 4. 文件列表(右栏,当前目录)

```
┌─ 面包屑:工作区 / docs / sub  [↑上级] [🔍搜索] [排序▾]─────┐
│ 📂 child-dir        —    2026-06-26                       │
│ 📄 notes.md        2KB   2026-06-26  [✏️编辑][📋复制][⬇️] │
│ 🖼️ logo.png        15KB  2026-06-25  [📋复制][⬇️]        │
│ 📑 report.pdf      1MB   2026-06-24  [📋复制][⬇️]        │
└──────────────────────────────────────────────────────────┘
```

- **列**:图标+名称 / 大小 / 修改时间 / 操作(行内按钮)
- **排序**:名称/大小/时间(点击表头切换);目录优先,再按名称
- **搜索**:前端过滤当前目录(名称模糊)
- **双击目录**→下钻;**双击文件**→预览(右栏切换)
- **右键**(用已有 shadcn context-menu):新建文件/文件夹、复制、下载、编辑(文本类);**删除/重命名/移动灰掉 + tooltip "v1.1.12 不支持"**

---

## 5. 多格式预览(FileViewer,按扩展名路由)

选中文件 → 右栏切换为 FileViewer,按扩展名路由到对应预览组件:

| 扩展名 | 预览组件 | 内容获取 | 可编辑? |
|---|---|---|---|
| `.md` | streamdown 预览 + react-textarea-autosize 编辑(切换) | `GET /code-files/{path}`(text) | ✅ 编辑/保存(PUT) |
| `.html/.htm` | `<iframe sandbox srcdoc>` | `GET /code-files/{path}`(text) | ✅ 编辑源码 |
| `.txt/.json/.yaml/.py/.js/...` 文本 | react-textarea-autosize | `GET /code-files/{path}`(text) | ✅ 编辑/保存 |
| `.png/.jpg/.gif/.webp/.svg/.bmp` | yet-another-react-lightbox(缩放/旋转) | `/files/preview/{path}`(img src) | ❌ 只读 |
| `.pdf` | react-pdf(`React.lazy` + pdfjs worker) | `/files/preview/{path}`(blob) | ❌ 只读 |
| `.mp4/.webm/.ogg` | `<video controls>` | `/files/preview/{path}`(video src) | ❌ 只读 |
| `.csv` | papaparse 解析 + @tanstack/react-table 渲染 | `GET /code-files/{path}`(text) → parse | ❌ 只读 |
| `.docx` | docx-preview(`React.lazy`,渲染到容器 div) | `/files/preview/{path}`(blob) | ❌ 只读 |
| `.xlsx/.xls` | SheetJS 解析 + react-table(`React.lazy`) | `/files/preview/{path}`(blob) | ❌ 只读 |
| `.pptx` | 不支持预览,提示"下载查看" | — | ❌ 下载 |
| 其他未知 | 提示"不支持预览,下载" | — | ❌ 下载 |

### 5.1 关键实现

- **二进制文件 URL**:`/api/files/preview/{path}?token={podToken}`(Pod files.py FileResponse,直接 img/video/iframe src 或 fetch blob)。
- **react-pdf worker**:Vite 下 `pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`。
- **HTML 沙箱**:`<iframe sandbox="allow-same-origin" srcdoc={html} />`,**不加 allow-scripts**。
- **懒加载**:`const PDFPreview = React.lazy(() => import('./preview/PDFPreview'))`,Suspense fallback Spinner;react-pdf/docx-preview/SheetJS 三个重组件分组懒加载。
- **编辑保存**:文本/MD 编辑后 `PUT /code-files/{path}` body `{content}`;保存按钮 + 未保存指示(复用原 FileEditor 的 handleSave 逻辑)。

### 5.2 预览布局

右栏顶部:面包屑 + 文件名 + [预览/编辑切换](文本类)+ [复制][下载];下方:预览区(自适应高度)。

---

## 6. 文件图标映射(lucide)

自建 `{ext: Icon}` 映射表(几十行):
```
md/txt → FileText | json/yaml → FileJson | py/js/ts → FileCode
png/jpg/svg/... → FileImage | pdf → FileText | mp4/webm → FileVideo
csv → FileSpreadsheet | docx → FileType | xlsx → FileSpreadsheet
默认 → File
```
目录 → Folder/FolderOpen。SVG 可着色(选中 signal orange 勾选)。

---

## 7. 文件生命周期操作(不改 Pod)

| 操作 | 实现 | UI 入口 |
|---|---|---|
| **新建文件** | `PUT /code-files/{path}` body `{content:""}`(auto mkdir parent) | 工具栏/右键目录 [+新建文件] → 输入路径名 → PUT → 刷新 |
| **新建文件夹** | `PUT /code-files/{folder}/.keep` `{content:""}`(占位文件,auto mkdir 目录) | [+新建文件夹] → 输入名 → PUT → 刷新 |
| **编辑** | 文本/MD 编辑 → `PUT /code-files/{path}` `{content}` | FileViewer 编辑模式 + 保存按钮 |
| **复制** | `GET /code-files/{src}` 读 → `PUT /code-files/{dst}` `{content}` 写 | 右键文件 [复制为...] → 输入新路径 → GET+PUT |
| **下载单文件** | `GET /files/preview/{path}` → blob → 浏览器下载 | 右键/行内 [⬇️下载] |
| **下载全部 ZIP** | `GET /workspace/download`(streaming,现有) | 工具栏 [下载ZIP] |
| **上传** | `POST /workspace/upload`(ZIP merge,现有) | 工具栏 [上传ZIP] |
| **删除** | ❌ 无 DELETE 端点 | 灰掉 + tooltip "v1.1.12 不支持" |
| **重命名/移动** | ❌ 无(读+PUT 新路径会留旧文件) | 灰掉 + tooltip "v1.1.12 不支持" |

### 7.1 约束说明(UI 显式提示)

- 新建文件夹用 `.keep` 占位文件(Pod 无 MKDIR,PUT auto mkdir parent 目录)。
- 复制是"读+写新",旧文件保留(无法删旧)。
- 删除/重命名/移动在 v1.1.12 锁定下不可用,UI 灰掉 + tooltip;后续 Pod 升级补端点后激活。
- **首次进入 Files 页面顶部一次性提示条**(localStorage `workpaw.files.limitNoticeSeen`):"当前 Pod v1.1.12 不支持删除/重命名/移动文件,这些操作置灰。新建/编辑/复制/下载可用。"

---

## 8. chat @文件选择器(方便 Agent 引用)

### 8.1 触发

chat 输入框打 `@` → 弹出文件选择器(复用现有斜杠命令机制,`/` 是场景命令,`@` 是文件引用)。

### 8.2 文件选择器

```
┌─ 选择工作区文件 ───────────────┐
│ [🔍 搜索文件...]               │
│ 📂 docs                         │
│ 📄 notes.md      docs/notes.md │
│ 📄 README.md     README.md     │
│ 🖼️ logo.png      images/logo   │
└────────────────────────────────┘
```
- 列出 workspace 文件(扁平 + 搜索,或迷你树)
- 选中 → 插入 chat 输入框

### 8.3 插入内容(按文件类型)

- **文本文件**(.md/.txt/.json/.yaml/.py 等):读文件内容(`GET /code-files/{path}`)→ 插入输入框,格式:
  ```
  [引用文件: docs/notes.md]
  {文件内容}
  ```
  Agent 收到 path + 完整内容作为上下文。大文件(>10KB)提示"内容较长,确认插入?"。
- **二进制文件**(图片/PDF/视频/Office):@引用不支持插入内容 → 提示"二进制文件请用附件按钮上传"(引导到现有 ChatInput 附件上传 `console/upload`)。

### 8.4 与斜杠命令共存

`/` 触发场景命令(已有),`@` 触发文件选择器(新)。两者独立,不冲突。

### 8.5 实现位置

`ChatInput.tsx` 新增 `@` 触发逻辑(类似现有 `SlashSuggestionBar`),文件选择器组件 `FileMentionPicker` 复用 workspace 文件列表(扁平搜索列表)。

---

## 9. 组件清单(复用与新增)

| 组件 | 复用/新增 | 职责 |
|---|---|---|
| `FileTree` | 新(react-complex-tree) | 左栏目录树 |
| `FileList` | 新 | 右栏当前目录文件列表 |
| `FileViewer` | 改造现有 FileEditor | 预览路由 + 编辑 |
| `MarkdownPreview` | 复用 streamdown | MD 预览 |
| `PDFPreview`/`DocxPreview`/`XlsxPreview` | 新(懒加载) | Office/PDF 预览 |
| `ImageLightbox`/`VideoPreview`/`CSVPreview`/`HtmlPreview` | 新 | 各格式预览 |
| `FileContextMenu` | 新(用已有 shadcn context-menu) | 右键操作 |
| `NewFileDialog`/`CopyDialog` | 新(Shadcn Dialog) | 新建/复制输入路径 |
| `FileMentionPicker` | 新 | chat @文件选择器 |
| `useWorkspace` | 改造 | 加 code-files 树构建 + 生命周期操作 |
| `buildFileTree`/`fileIcon` | 新(纯函数) | 树构建 + 图标映射 |

---

## 10. 错误处理与降级

核心原则:**不阻断文件管理主流程,失败优雅降级**。

| 场景 | 降级 |
|---|---|
| **文件树加载失败**(Pod `/code-files` 不可达) | 树空态"无法加载文件,请检查实例状态"+ 重试按钮;不阻断 chat 等其他页面 |
| **实例未就绪**(Pod 未 running) | Files 页面显示"实例未就绪,请先在对话页启动" |
| **预览失败**(格式不支持/读文件失败) | FileViewer 显示"无法预览此格式,请下载查看"+ 下载按钮 |
| **大文件**(文本 >5MB Pod 限制 / 二进制 >50MB) | 提示"文件过大(>{limit}),请下载查看",不加载预览 |
| **保存失败**(PUT 失败) | toast"保存失败: {error}";**保留编辑内容**(不丢失输入);可重试 |
| **新建/复制失败**(PUT 失败) | toast 错误;路径冲突(已存在)提示"文件已存在" |
| **二进制文件 @引用** | chat @选择器选中二进制 → 提示"二进制文件请用附件按钮上传" |
| **非 UTF-8 文本**(Pod code-files 强制 UTF-8) | 乱码时提示"文件编码可能非 UTF-8,预览异常,建议下载" |
| **懒加载组件失败**(react-pdf/docx-preview 加载失败) | ErrorBoundary 兜底"预览组件加载失败,请下载"+ 下载按钮 |
| **文件内容读取超时** | 10s 超时 toast"读取超时,请重试" |
| **路径非法**(`..` 遍历) | Pod 已拦(desktop 前端也校验),toast"非法路径" |

**ErrorBoundary**:每个懒加载预览组件(PDF/Docx/Xlsx)包 ErrorBoundary,单组件崩溃不影响整体 Files 页面。

---

## 11. 测试策略

### 11.1 单元测试(vitest,沿用 desktop 现有模式)
- `buildFileTree.test.ts`:扁平 path 列表 → 递归树(嵌套目录、空目录、深层路径、同名不同目录)
- `fileIcon.test.ts`:扩展名 → 图标映射(覆盖常见格式 + 默认)
- `FileViewer.test.tsx`:按扩展名路由到对应预览组件(.md→streamdown、.pdf→PDFPreview lazy、.pptx→下载提示、未知→下载提示)
- `useWorkspace.test.ts`:生命周期操作(新建 PUT、复制 GET+PUT、编辑保存)mock podApi;失败降级
- `FileMentionPicker.test.tsx`:@文件选择器(文本插入内容、二进制提示、搜索过滤)

### 11.2 组件测试
- `FileTree.test.tsx`:react-complex-tree 渲染、折叠/展开、选中目录→右栏列表、右键菜单
- `FileList.test.tsx`:列表渲染、排序(名称/大小/时间)、搜索过滤、双击下钻/预览、删除/重命名灰掉
- 预览组件:`MarkdownPreview`/`CSVPreview`/`ImageLightbox` 各自渲染(mock 数据);PDF/Docx/Xlsx 懒加载 + ErrorBoundary

### 11.3 手测清单(交付前)
- 端到端:进 Files → 树展开 → 进目录 → 选 PDF → 预览 → 编辑 .md → 保存 → 新建文件 → 复制 → 下载
- chat @文件:输入 @ → 选 .md → 内容插入 → 发送 → Agent 收到
- 降级:断 Pod → 树空态重试;大文件 → 下载提示;pptx → 下载提示
- 懒加载:首次打开 PDF → 加载指示 → 渲染;打开 docx → 独立加载
- 视觉:文件树/列表克制(Signal Orange 仅选中/主操作)、暗色模式、reduced-motion

---

## 12. 分期

### 12.1 v1(本次,不改 Pod)
- 文件树(react-complex-tree)+ 文件列表(排序/搜索/面包屑)
- 多格式预览(MD/HTML/文本/图片/PDF/视频/CSV/docx/xlsx;pptx 下载)
- 生命周期:新建/建目录(.keep)/编辑/复制/下载(ZIP+单文件);删除/重命名/移动灰掉
- chat @文件选择器(文本插内容,二进制引导附件)
- 首次顶部提示条(v1.1.12 限制说明)
- 手动刷新

### 12.2 v2(后续)
- **SSE 实时变更**(`/workspace/watch`):文件树自动更新(Agent 新建/改文件实时反映)
- **单文件上传**(二进制,扩展 upload 或变通)
- **Tiptap 富文本编辑**(非技术人员所见即所得,替代 Textarea)
- **文件搜索全局**(跨目录搜索,不只当前目录)

### 12.3 v3(Pod 升级后)
- **删除/重命名/移动**(Pod 补 DELETE/RENAME/MOVE 端点后激活)
- **git 版本管理**(复用 Pod `/workspace/git/`):文件历史/回滚
- **权限管理**(Linux 风格 chmod,若 Pod 支持)
- **缩略图视图**(图片/视频网格预览)

### 12.4 明确不做(v1)
- 改 Pod 代码(v1.1.12 锁定)
- 一体化文件管理器(Chonky 等已死,分组件组合更可控)
- pptx 前端预览(无成熟库)
- 实时推送(v2 SSE)

---

## 13. 范围与依赖

### 13.1 v1 范围
- desktop:Files 页面重构(FileTree/FileList/FileViewer/各预览组件/FileContextMenu/NewFile/CopyDialog)+ useWorkspace 改造 + chat @文件(FileMentionPicker + ChatInput @触发)
- 新增依赖:react-complex-tree、react-pdf、yet-another-react-lightbox、papaparse、@tanstack/react-table、docx-preview、SheetJS(CDN)、react-textarea-autosize
- 复用:streamdown、shadcn context-menu、lucide

### 13.2 依赖与前提
- workpaw-desktop 已有 chat + Pod 连接 + workspaceApi 基建。
- QwenPaw Pod v1.1.12 已有 code-files/binary-files/files-preview/download/upload API(前端未用)。
- 文件操作 agent-scoped(X-Agent-Id header),与 chat 共享 selectedAgentId。

### 13.3 不在范围
- 改 Pod 代码(v1.1.12 锁定)。
- 删除/重命名/移动(v1.1.12 无端点,v3)。
- SSE 实时变更(v2)。
- pptx 预览(无成熟库)。
