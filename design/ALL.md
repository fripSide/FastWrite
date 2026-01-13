
### 原始需求
开发一个类似于overleaf的写作工具，能支持用LLM 来帮助修改latex 论文，需要能针对一整节，单个段落，单句话进行修改。
界面分为两栏，左边栏是文件浏览器（25%），右边栏是论文编辑修改（75%）。

论文修改功能：
- 左边栏：有Import Paper (from git, from local dir)选项，然后是论文文件结构展示。下面像overleaf那样有个论文section展示。
- 右边栏界面：选择一个文件之后，最上面是选取的文件，支持按section查看，按段查看，按照单句查看。根据选择把选取的文件划分成latex section\段、句为最小单位（item），用块依次堆叠显示，选取用框框起来高亮。然后支持三种操作，dignose(诊断写作思路是否正确)\ refine（LLM润色，做结构表达改变，补充知识，纠正说法）\ QuickFix (快速检查基本语法、句法、拼写)
- 右边选中一个item之后，下面出现一个编辑框，可以在里面编辑。然后可启用和设置 system prompt，以及适用于当前文件的user prompt。这些可以作为选择框放在编辑框下面。
- 进行修改之后，下面可以出现版本idff界面解析修改本段，直到改到满意。



latex符号处理比较复杂，应该原原本本显示在html界面中。
编辑的时候应该始终保留这些符号。


注意：
这是一个只需要localhost运行的web项目，后期需要迁移到tarui。
所以web和后端跑在一个端口。并且web后端能直接访问本地文件夹。因此import paper不需要文件上传。

不重要备忘：
- 以单独latex文件为单位，对每次修改进行备份，能看历史版本修改，以及回退版本。
- prompt维护界面。

---

### 第一部分：开发规划 (Development Roadmap)

我们将开发过程分为 5 个阶段。这种分阶段的方法能确保 AI 生成的代码质量更高，且容易调试。

**Phase 1: 基础架构与布局 (Infrastructure & Layout)**
*   **目标**: 搭建 React + TypeScript + Tailwind 项目，实现左右分栏响应式布局。
*   **关键点**: 定义全局类型（File, Section, Item），实现基础的 UI 骨架。

**Phase 2: 左侧栏 - 文件系统与大纲 (Sidebar: File System & Outline)**
*   **目标**: 实现文件树（递归组件）和 LaTeX 结构大纲。
*   **关键点**: Mock 文件数据，实现文件夹展开/折叠，解析 LaTeX 文本提取 `\section` 生成大纲。

**Phase 3: 右侧栏 - 核心解析与视图引擎 (Main Area: Parser & Viewer)**
*   **目标**: 实现核心的“分粒度查看”功能。
*   **关键点**: 编写解析器（Parser），根据 Section/Paragraph/Sentence 模式将文本切分为独立的 `Item` 块，并实现高亮选中逻辑。

**Phase 4: 底部栏 - LLM 交互与编辑器 (Bottom Panel: Editor & LLM)**
*   **目标**: 实现选中 Item 后的编辑面板、Prompt 设置和模拟 LLM 请求。
*   **关键点**: 动画弹出面板，Prompt 输入框，Diagnose/Refine/QuickFix 按钮逻辑。

**Phase 5: 版本对比与数据同步 (Diff View & Sync)**
*   **目标**: 展示 LLM 修改前后的差异，并应用修改。
*   **关键点**: 集成 Diff 算法（如 `diff-match-patch`），实现“接受修改”回写到主文档的逻辑。

---

### 第二部分：AI 编程 Prompts (Copy & Paste)

你可以按顺序将这些 Prompt 发送给你的 AI 编程助手。

#### 0. 项目上下文设置 (Context Setting)
*在开始任何代码之前，先发送这条指令，让 AI 理解项目背景。*

> **Prompt:**
> You are a Senior Frontend Engineer expert in React, TypeScript, Tailwind CSS, and UX design.
> We are building a "Latex AI Copilot" application similar to Overleaf but with granular AI editing capabilities.
>
> **Tech Stack:**
> - React (Vite)
> - TypeScript
> - Tailwind CSS (Styling)
> - Lucide React (Icons)
> - Framer Motion (Animations)
> - Future target: Tauri (so keep code modular and avoid browser-specific hard dependencies where possible).
>
> **Core Layout:**
> - Left Sidebar (25%): File browser and Document Outline.
> - Right Main Area (75%): Document Viewer and AI Editor.
>
> **Key Feature:**
> The user can view the document in 3 modes: "Section", "Paragraph", or "Sentence". The text is split into "Items". Clicking an item opens a bottom panel to edit text and use LLM to Diagnose, Refine, or QuickFix.
>
> Please acknowledge this context. I will guide you through the implementation step-by-step.

---

#### Step 1: 基础布局与类型定义 (Layout & Types)

> **Prompt:**
> Let's start with Phase 1: Basic Layout and Type Definitions.
>
> 1.  Create a `types.ts` file. Define interfaces for:
>     -   `FileNode`: id, name, type ('file'|'folder'), content (optional), children (optional).
>     -   `ViewMode`: 'section' | 'paragraph' | 'sentence'.
>     -   `TextItem`: id, content, type (ViewMode), originalContent (for diffs).
> 2.  Create a `Layout` component that implements a responsive 2-column design.
>     -   Left column: 25% width (min-width 250px), scrollable.
>     -   Right column: 75% width, scrollable.
>     -   Use Tailwind CSS.
> 3.  Create dummy components for `Sidebar` and `MainEditor` and place them in the Layout.
> 4.  Use a mock data constant for the File Tree structure to verify the layout works.

---

#### Step 2: 左侧栏 - 文件树与大纲 (Sidebar Implementation)

> **Prompt:**
> Now implementing Phase 2: The Sidebar.
>
> 1.  **File Tree:** Create a recursive `FileTreeItem` component.
>     -   It should handle folder expand/collapse.
>     -   Highlight the currently active file.
>     -   Add an "Import" section at the top (Mock buttons for "From Git" and "From Local").
> 2.  **Structure Outline:** Create a `DocumentOutline` component.
>     -   It should take the raw LaTeX content of the active file.
>     -   Use a regex to find all `\section{...}`, `\subsection{...}`.
>     -   Render them as a clickable list below the file tree.
> 3.  Update the `Sidebar` component to include these two sections. use `lucide-react` for icons (Folder, File, ChevronRight, ChevronDown, List).

---

#### Step 3: 右侧栏 - 核心解析器 (The Parser Logic)

> **Prompt:**
> Phase 3: The Core Parser and Viewer (Crucial Step).
>
> We need to split the LaTeX content based on the selected `ViewMode`.
>
> 1.  Create a utility function `parseContent(content: string, mode: ViewMode): TextItem[]`.
>     -   **Section Mode:** Split by `\section`.
>     -   **Paragraph Mode:** Split by double newlines `\n\n`.
>     -   **Sentence Mode:** Split by periods `.` that are followed by spaces (keep it simple for now, regex based).
>     -   Each item needs a unique ID.
> 2.  Create the `MainEditor` component.
>     -   Top bar: Show active filename and a Segmented Control to switch `ViewMode`.
>     -   Content Area: Map through the `TextItem[]` returned by the parser.
>     -   Render each item as a `div`.
>     -   **Interaction:** When an item is clicked, set it as `selectedId` state and highlight it visually (blue border/background).

---

#### Step 4: 底部编辑面板与 LLM 交互 (Editor & LLM Panel)

> **Prompt:**
> Phase 4: The Bottom AI Editor Panel.
>
> Create a component `AIEditorPanel` that appears at the bottom of the right column when an item is selected.
>
> **Requirements:**
> 1.  **Animation:** Use `framer-motion` to slide it up from the bottom.
> 2.  **Layout:**
>     -   **Top Bar:** Buttons for "Diagnose", "Refine", "QuickFix".
>     -   **Middle:** Two columns.
>         -   Left: A `textarea` for manual editing of the selected item's content.
>         -   Right: Configuration area.
> 3.  **Configuration Area:**
>     -   Input for "System Prompt" (default: "You are a helpful academic assistant").
>     -   Input for "User Prompt" (Context).
> 4.  **Simulation:**
>     -   When a user clicks "Refine" (or others), set an `isProcessing` state.
>     -   After 1.5s (mock delay), update the content with a mock response (e.g., append "[AI Refined]" to the text).

---

#### Step 5: Diff 视图与合并 (Diff View)

> **Prompt:**
> Phase 5: Diff View and Final Integration.
>
> 1.  **Diff Component:** Create a `DiffViewer` component.
>     -   It takes `originalText` and `modifiedText`.
>     -   Display them side-by-side or inline.
>     -   Use simple color coding (Red background for original, Green for modified) to show they are different.
> 2.  **Integration in Panel:**
>     -   Inside `AIEditorPanel`, when the AI returns a result, show the `DiffViewer` instead of the plain textarea.
>     -   Add "Accept Changes" and "Reject Changes" buttons.
> 3.  **Data Sync:**
>     -   If "Accept" is clicked, update the main `FileNode` content in the parent state.
>     -   Re-run the `parseContent` function to refresh the main view.

---

### 给开发者的额外建议 (Tips for You)

1.  **状态管理**: 在 Prompt 3 和 4 之间，你可能会发现状态变得复杂（比如如何在底部面板修改内容后更新主视图）。如果 AI 使用了过多的 Props drilling，可以要求它：*"Refactor the state management using a simple React Context named `EditorContext` to share state between Sidebar, Viewer, and BottomPanel."*
2.  **Regex 局限性**: 目前的 Prompt 使用 Regex 来分割 LaTeX。这对于原型是够用的，但对于复杂的 LaTeX（嵌套括号等）会失效。在后期转 Tauri 时，你可能需要引入 `latex-utensils` 或编写更健壮的 Parser。
3.  **Tauri 准备**: 在开发 Web 版时，尽量把文件读写逻辑抽离成单独的 Service（如 `FileService`）。这样后期迁移到 Tauri 时，只需要重写这个 Service（从调用 Web API 改为调用 Tauri FS API），而不需要动 UI 代码。


## Features

The detailed design are described as follow: 

@design/01-import-paper.md 
@design/02-refine-paper.md 
@design/03-web-gui.md 