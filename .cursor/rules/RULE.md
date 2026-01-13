# FastWrite Project Rules

## Tech Stack
- **Runtime**: Bun (not Node.js) - use `bun run`, `bun install`, `bun build`
- **Language**: TypeScript with ESM modules (`"type": "module"`)
- **Backend**: Bun's native HTTP server (`Bun.serve`)
- **Frontend**: React 19 + Vite + Tailwind CSS v4
- **CLI**: Commander.js
- **AI**: OpenAI SDK

## Code Style

### TypeScript
- Use explicit types, avoid `any`
- Prefer `interface` over `type` for object shapes
- Use `import type` for type-only imports
- No CommonJS (`require`) - use ESM imports only

### Functions
- Keep functions small and focused (<50 lines)
- Use early returns to reduce nesting
- Prefer `async/await` over `.then()` chains

### Naming
- Files: kebab-case (`project-config.ts`) or camelCase (`projectConfig.ts`)
- Components: PascalCase (`FileExplorer.tsx`)
- Functions/variables: camelCase
- Constants: UPPER_SNAKE_CASE for true constants

## Project Structure

```
src/           # Backend CLI and API
  cli.ts       # CLI entry point
  server.ts    # API server
  writer.ts    # Core logic
  
web/           # React frontend
  src/
    components/  # React components
    types/       # TypeScript types
    api.ts       # API client
    App.tsx      # Root component

projs/         # User projects (gitignored except config)
```

## Commands

```bash
bun run dev          # Run CLI
bun run dev:server   # Start API server (port 3002)
bun run dev:web      # Start Vite dev server
bun run typecheck    # Type check
bun run build        # Build CLI binary
```

## API Conventions
- All endpoints under `/api/`
- Return JSON with `{ success: true }` or `{ error: "message" }`
- Use HTTP status codes: 200 OK, 404 Not Found, 500 Error
- CORS headers included for all responses

## Don't
- Don't use `require()` - ESM only
- Don't use `node:` prefix for Bun-native modules when not needed
- Don't create new config files - use existing `projs/fastwrite.config.json`
- Don't add new dependencies without asking
- Don't modify `.gitignore` patterns
