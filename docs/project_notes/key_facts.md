# Key Facts

## Project Configuration

- **Frontend Port**: 3002
- **Backend Port**: 3003
- **Host frontend and backend at the same port**
- **Primary Language**: TypeScript
- **Runtime**: Bun
- **Main Demo File**: `demo/latex-p2/main.tex`

## Important Commands

- **Start Dev Server**: `bun run dev` (starts both frontend and backend)
- **Compile LaTeX**: Triggered automatically on save via `/api/latex/compile` endpoint
- **Sync Forward**: `POST /api/latex/forward-synctex`
- **Sync Reverse**: Handled by PDF Viewer click

## Directory Structure

- `web/src`: Frontend source (React/Vite)
- `web/src/components`: UI components (`MainEditor`, `PDFViewer`)
- `web/src/utils/parser.ts`: LaTeX parsing logic
- `src/server.ts`: Backend server source
- `demo/latex-p2`: Demo LaTeX project
- `projs/`: User project storage (local)
