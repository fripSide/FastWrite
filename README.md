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

## Commands

### Prepare a project
```bash
bun src/cli.ts p [project-name] <sections-dir>
```
Scans `.tex` files and generates prompt templates.

### Write a section
```bash
bun src/cli.ts w <section-id>
bun src/cli.ts w <section-id> -v  # verbose: show prompts
```
Rewrites the section using AI based on your prompt requirements.

Note: LaTeX files should be named as `{id}-{name}.tex` (e.g., `0-abstract.tex`, `1-intro.tex`)

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
2. Edit `projs/myproject/prompts/0-abstract.md` - Add requirements
3. `bun src/cli.ts w 0` - AI rewrites section, opens diff in browser
4. Review changes in `path/to/paper/sections/0-abstract.tex`

## Project Structure

```
your-workspace/
├── projs/                          # All projects (at cwd root)
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
