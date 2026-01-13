# FastWrite

AI-powered academic writing assistant for LaTeX papers.

## Setup

```bash
bun install
```

Create `.env` file:
```
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

## 运行应用

### 方式一：同时启动前后端（推荐）

```bash
bun run dev:all
```

这会同时启动：
- **后端 API 服务器**: http://localhost:3002
- **前端开发服务器**: http://localhost:5173（或 Vite 自动分配的端口）

### 方式二：分别启动

**终端 1 - 启动后端 API：**
```bash
bun run dev:server
```

**终端 2 - 启动前端：**
```bash
bun run dev:web
```

然后访问前端地址（通常是 http://localhost:5173）

## 使用流程

1. **导入项目**：点击左侧边栏的 "Import Project" 按钮，选择本地 LaTeX 项目目录
2. **选择文件**：在文件树中点击 `.tex` 文件
3. **选择视图模式**：在顶部切换 Section / Paragraph / Sentence 视图
4. **编辑内容**：点击任意 item，底部会弹出 AI 编辑面板
5. **使用 AI**：选择 Diagnose / Refine / QuickFix 模式，配置 prompts，运行 AI
6. **查看差异**：AI 返回结果后，查看词级别的 diff，选择 Accept 或 Reject

## Commands

### Prepare a project
```bash
bun src/cli.ts p [project-name] <sections-dir>
```
Scans `.tex` files and generates prompt templates.

# Project Structure

```
your-workspace/
├── web/                            # Web GUI application
│   ├── src/
│   │   ├── components/             # React components
│   │   │   ├── FileExplorer.tsx    # File tree navigation
│   │   │   └── MainEditor.tsx      # Main editing interface
│   │   ├── types/                  # TypeScript definitions
│   │   └── App.tsx                 # Main application
│   ├── public/                     # Static assets
│   └── index.html                  # Entry point
├── projs/                          # All papers that need to be revise (at cwd root)
│   ├── fastwrite.config.json       # Global config
│   └── myproject/
│       ├── prompts/                # Edit these to specify requirements
│       ├── backups/                # Auto-saved before each rewrite
│       ├── diffs/                  # HTML diffs for review
│       └── system.md               # Customize AI behavior
└── path/to/paper/
    └── sections/                   # Your LaTeX files
        ├── 0-abstract.tex
        ├── 1-intro.tex
        └── ...
```


### Write a section
```bash
bun src/cli.ts w <section-id>
bun src/cli.ts w <section-id> -v  # verbose: show prompts
```
Rewrites the section using AI based on your prompt requirements.

Note: LaTeX files should be named as `{id}-{name}.tex` (e.g., `0-abstract.tex`, `1-introduction.tex`)

### Switch project
```bash
bun src/cli.ts s <project-name>
```

### Clean backups/diffs
```bash
bun src/cli.ts c
```

## Workflow

1. `bun src/cli.ts p myproject path/to/paper/sections/` - Initialize project
2. Start web GUI: `bun run dev:web`
3. Use the file explorer to select `.tex` files
4. Edit prompts in the web interface
5. Review AI suggestions and apply changes
6. View revision history and restore backups

## Development

```bash
# Run CLI directly
bun run dev -- p myproject ./sections
bun run dev -- w 0

# Run web development server
bun run dev:web

# Type check
bun run typecheck

# Build web app
bun run build:web
```

## Build

```bash
# Build for current platform
bun run build
./fastwrite p myproject ./sections

# Build for specific platforms
bun run build:mac-arm     # macOS ARM64
bun run build:mac         # macOS x64
bun run build:linux       # Linux x64
bun run build:windows     # Windows x64

# Build web app
bun run build:web
```

## Web GUI Features

### File Explorer (Left Sidebar)
- Hierarchical file tree view
- Click `.tex` files to select them
- Auto-linking with corresponding prompt files
- Visual indicators for LaTeX and markdown files

### Main Editor (Right Panel)
- **System Prompt**: Collapsible textarea for global AI instructions
- **File Prompt Editor**: Edit requirements for selected LaTeX file
- **LaTeX Preview**: Read-only view of current file content
- **AI Suggestions**: Editable list of AI-proposed changes
- **Backup Timeline**: Visual history with click-to-restore functionality

### Technology Stack
- **Framework**: React with TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Build Tool**: Vite
- **Package Manager**: Bun
