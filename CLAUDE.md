
### Project Context

LLM-Powered Granular LaTeX Assistant (Local-First)

This is a local-first LaTeX editing tool designed to revolutionize academic writing through deep Large Language Model (LLM) integration. Unlike traditional editors, it intelligently parses LaTeX source code, allowing users to view and manipulate documents at three distinct granularities: Section, Paragraph, and Sentence. The interface features a dual-pane layout with a file explorer on the left (supporting direct local directory mounting) and a dynamic editor on the right, ensuring all LaTeX syntax and symbols are preserved during editing.

The core workflow revolves around iterative, LLM-driven refinement. Users can select specific text blocks to trigger three distinct AI operations:

- Diagnose: Leverages the LLM to deeply analyze the paper's logical flow, argumentation structure, and overall layout. Give high level suggestion about the paper.
- Refine: Enhances writing quality by adjusting structure, removing redundancy, and enriching content.
- QuickFix: Instantly corrects grammar, syntax, and spelling errors without altering the original meaning.

All modifications are presented with a clear word-level diff view, allowing users to iterate, compare versions, and selectively accept changes, ensuring total control over the polishing process.

Text Edit 区域实现逻辑：
Section/Paragraph/Sectence Mode，编辑了都应该先更新底层文件。
如果不切换模式，就不用刷新视图。如果切换了模式，就重新加载文件，这样更容易刷新。

### Code Style

- ALL with use Bun and Typescript. Never use Javascript and Nodejs


### Features have done

- [y] leftbar and project tree
- [y] rightbar and PDF view
- [y] editor area at the middle
- [y] LLM setting window
- [y] prompt setting window
- [y] AI editing pannel


### Gotchas


## Project Memory System

This project maintains institutional knowledge in `docs/project_notes/` for consistency across sessions.

### Memory Files

- **bugs.md** - Bug log with dates, solutions, and prevention notes
- **decisions.md** - Architectural Decision Records (ADRs) with context and trade-offs
- **key_facts.md** - Project configuration, credentials, ports, important URLs
- **issues.md** - Work log with ticket IDs, descriptions, and URLs

### Memory-Aware Protocols

**Before proposing architectural changes:**
- Check `docs/project_notes/decisions.md` for existing decisions
- Verify the proposed approach doesn't conflict with past choices
- If it does conflict, acknowledge the existing decision and explain why a change is warranted

**When encountering errors or bugs:**
- Search `docs/project_notes/bugs.md` for similar issues
- Apply known solutions if found
- Document new bugs and solutions when resolved

**When looking up project configuration:**
- Check `docs/project_notes/key_facts.md` for credentials, ports, URLs, service accounts
- Prefer documented facts over assumptions

**When completing work on tickets:**
- Log completed work in `docs/project_notes/issues.md`
- Include ticket ID, date, brief description, and URL

**When user requests memory updates:**
- Update the appropriate memory file (bugs, decisions, key_facts, or issues)
- Follow the established format and style (bullet lists, dates, concise entries)

### Style Guidelines for Memory Files

- **Prefer bullet lists over tables** for simplicity and ease of editing
- **Keep entries concise** (1-3 lines for descriptions)
- **Always include dates** for temporal context
- **Include URLs** for tickets, documentation, monitoring dashboards
- **Manual cleanup** of old entries is expected (not automated)
