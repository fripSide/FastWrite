# Architectural Decision Records (ADR)

## ADR-001: Technology Stack Selection (2025-01-01)

**Context:**
We needed a performant, modern stack for a local-first academic writing tool with LaTeX support.

**Decision:**
- **Runtime**: Bun (for speed and built-in TypeScript support).
- **Frontend**: React + Vite (standard, fast HMR).
- **Language**: TypeScript (type safety).
- **Styling**: Vanilla CSS (requested by requirements for flexibility/simplicity).

**Consequences:**
- Fast startup times.
- Native API for file I/O works well with Bun.

## ADR-002: PDF Synchronization Strategy (2025-01-15)

**Context:**
Users need bidirectional synchronization between the LaTeX source editor and the PDF preview.

**Decision:**
- **Forward Sync (Editor -> PDF)**: Implemented via a backend API `/api/latex/forward-synctex` that invokes the `synctex` CLI tool.
- **Reverse Sync (PDF -> Editor)**: Handled by the PDF Viewer component capturing click coordinates and querying the backend/synctex to find the source line.
- **Navigation**: The editor exposes `getCurrentLine` and `scrollToLine` methods to facilitate jumps.

**Consequences:**
- Requires `synctex` to be installed and `.synctex.gz` to be generated during compilation.
- Precise line mapping relies on the stability of the editor's line numbers.

## ADR-003: Custom Parsing for View Modes (2025-01-16)

**Context:**
The editor supports "Sentence", "Paragraph", and "Section" views, requiring content to be split logically.

**Decision:**
- **Custom Parser**: Implemented `web/src/utils/parser.ts` to parse raw LaTeX.
- **Sentence Mode**: Splits by sentence-ending punctuation but respects LaTeX environments (tables, figures) as atomic blocks.
- **Paragraph Mode**: Splits by double newlines or Section headers.
- **Section Mode**: Hierarchical parsing.

**Consequences:**
- Complex logic needed to handle LaTeX edge cases (comments, nested environments).
- Re-parsing text changes can be expensive, leading to optimizations (incremental updates).

## ADR-004: Incremental Line Updates for Sync Stability (2026-01-18)

**Context:**
In Sentence Mode, editing text (adding lines) caused subsequent items' `lineStart` metadata to become stale, breaking Sync. Full re-parsing on every save caused focus loss.

**Decision:**
- **Incremental Update**: `MainEditor` recalculates `lineStart` for all items purely in-memory during `handleContentUpdate`.
- **Disable Save Re-parse**: Prevented `handleSaveChanges` from replacing the entire items list with a fresh parse.

**Consequences:**
- Sync works accurately during heavy editing.
- Focus is preserved.
- `lineStart` metadata is transient in memory until next load, but accurate.
