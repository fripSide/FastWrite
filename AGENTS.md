# FastWrite AI Assistant - Agent Guidelines

## Project Overview

FastWrite is a TypeScript + React + Bun web application for LLM-powered LaTeX paper editing. It provides granular AI editing capabilities at section, paragraph, and sentence levels with inline word-level diff visualization.

**Key Features:**
- **Project Import**: Local directory and GitHub repository import with auto-detection of LaTeX structure
- **Three-Level Granularity**: View and edit at Section, Paragraph, or Sentence level
- **AI Editing Panel**: Three modes - Diagnose (analyze), Refine (improve), QuickFix (grammar/spelling)
- **Inline Diff View**: Single-column word-level diff with strikethrough deletions and highlighted additions
- **LLM Settings**: Configurable API endpoint, key, and model with connection testing
- **File Tree & Outline**: Natural-sorted file browser with document section navigation
- **Version Backup**: Automatic backup creation on file save

## Tech Stack

- **Runtime**: Bun (JavaScript runtime, package manager)
- **Language**: TypeScript 5.9+
- **Frontend**: React 19.2+ with JSX
- **Styling**: Tailwind CSS 4.1+ via Vite plugin
- **Icons**: Lucide React
- **Build Tool**: Vite 7.3+
- **API**: OpenAI-compatible (via `openai` npm package)

---

## Development Commands

### Quick Start

```bash
# Start development server (backend + frontend)
npm run dev

# Frontend at http://localhost:3002, Backend at http://localhost:3003
```

### Root Commands (from project root)

```bash
# Development
npm run dev              # Start backend (port 3003) + frontend dev server (port 3002)

# Build
npm run build            # Build frontend to /web/dist

# Type checking
bun run typecheck        # TypeScript type check (no emit)
```

### Web Commands (from /web directory)

```bash
bun run dev              # Start Vite dev server
bun run build            # tsc + vite build
bun run preview          # Preview production build
```

---

## Code Style Guidelines

### Imports and Dependencies

**✅ DO:**
```typescript
// Named imports
import { useState, useEffect } from 'react';
import { ChevronRight, File, ChevronDown } from 'lucide-react';

// Relative imports for project files
import { api } from './api';
import type { FileNode } from './types';

// Third-party packages (installed via bun)
import OpenAI from 'openai';
```

**❌ DON'T:**
```typescript
// Default imports (unspecific)
import React from 'react';
import * as lucide from 'lucide-react';

// Absolute paths (unless necessary)
import { Component } from '/absolute/path/Component';

// Unused imports
import { unusedFunction } from './utils';
```

### File and Component Structure

**Naming Conventions:**
- **Components**: PascalCase (e.g., `FileExplorer.tsx`, `MainEditor.tsx`)
- **Utilities**: camelCase (e.g., `parseContent.ts`, `formatDate.ts`)
- **Types**: PascalCase for interfaces/types (e.g., `types/index.ts`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `API_BASE_URL`)

**File Organization:**
```
web/src/
├── components/          # React components
│   ├── FileExplorer.tsx
│   ├── MainEditor.tsx
│   ├── DiffViewer.tsx
│   └── SentenceSuggestions.tsx
├── types/              # TypeScript type definitions
│   └── index.ts
├── api.ts              # API client
├── main.tsx           # Entry point
└── App.tsx             # Root component
```

### Component Patterns

**Functional Components:**
```typescript
// Prefer functional components with hooks
const MyComponent: React.FC<MyProps> = ({ prop1, prop2 }) => {
  const [state, setState] = useState(null);
  
  return <div>{...}</div>;
};
```

**Props Interface:**
```typescript
interface MyComponentProps {
  requiredProp: string;
  optionalProp?: number;
  onAction: (value: string) => void;
}
```

**Avoid Prop Drilling:**
```typescript
// ✅ Use Context for shared state
const MyContext = createContext<MyContextType>(defaultValue);

// ❌ Don't drill props deeply
<Parent>
  <Child1 value={value} onChange={onChange}>
    <Child2 value={value} onChange={onChange}>
```

### TypeScript Best Practices

**Types:**
```typescript
// Always use explicit interfaces for props
interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

// Use type assertions only when necessary
const data = response.json() as MyDataType;

// Use utility types for common patterns
type Nullable<T> = T | null;
type Optional<T> = T | undefined;
```

**Generic Types:**
```typescript
// Prefer generic types over any
function identity<T>(value: T): T {
  return value;
}

// Use readonly arrays when data shouldn't change
const items: ReadonlyArray<string> = [...data];
```

### Error Handling

**API Errors:**
```typescript
// Always handle errors from API calls
try {
  const result = await api.getData();
  setData(result);
} catch (error) {
  console.error('Failed to fetch data:', error);
  setError(error instanceof Error ? error.message : 'Unknown error');
  // Optionally show user-friendly message
  showToast('Failed to load data');
}
```

**User Feedback:**
```typescript
// Provide actionable error messages
if (error.status === 404) {
  setError('Project not found. Please import it first.');
} else if (error.status === 403) {
  setError('Permission denied. Check your API key.');
}
```

### State Management

**Component State:**
```typescript
// Keep state close to where it's used
const [isOpen, setIsOpen] = useState(false);
const [selectedItem, setSelectedItem] = useState<Item | null>(null);

// Use derived state when possible
const isSelected = selectedItem?.id === item.id;
```

**Effect Hooks:**
```typescript
// Always include dependency arrays
useEffect(() => {
  loadData();
}, [projectId]); // Dependencies listed

// Cleanup functions
useEffect(() => {
  const interval = setInterval(poll, 5000);
  return () => clearInterval(interval);
}, []);
```

---

## Formatting and Style

### Tailwind CSS

**Layout:**
```tsx
// Use flexbox/grid for layouts
<div className="flex flex-col h-full">
  <div className="flex-1 overflow-auto">
  <div className="grid grid-cols-2 gap-4">
```

**Responsive:**
```tsx
// Mobile-first approach
<div className="w-full md:w-3/4 lg:w-1/4">
  <div className="md:grid md:grid-cols-2">
```

**Styling:**
```tsx
// Use utility classes for consistency
<div className="p-4 bg-white border border-gray-200 rounded-lg">
<button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition">
```

### Consistent Patterns

**Icons:**
```tsx
// Always include size prop
<ChevronRight size={16} />
<FileText size={20} className="text-blue-500" />
```

**Spacing:**
```tsx
// Use Tailwind spacing scale (0.5 = 2px, multiples of 4)
<div className="p-4">  {/* 16px padding */}
<div className="gap-2">  {/* 8px gap */}
<div className="mx-2 my-4">  {/* 8px horizontal, 16px vertical */}
```

---

## Testing Guidelines

### Unit Tests

**Setup:**
- Use Vitest (compatible with Vite)
- Place tests in `__tests__` directory next to source
- Name test files: `*.test.ts` or `*.test.tsx`

**Test Structure:**
```typescript
// Describe what you're testing
describe('FileExplorer', () => {
  
  // Arrange: Set up test data
  const mockFiles = [
    { id: '1', name: 'test.tex', type: 'file' as const, path: '/path' }
  ];
  
  // Act: Execute the function
  const { result } = render(<FileExplorer files={mockFiles} />);
  
  // Assert: Verify the result
  expect(result).toContain('test.tex');
});
```

**Async Tests:**
```typescript
// Always await async operations
it('should load file content', async () => {
  const content = await api.readFile('test.tex');
  expect(content).toBeDefined();
});
```

### Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test FileExplorer.test.tsx

# Run tests in watch mode
bun test --watch

# Run tests with coverage
bun test --coverage
```

---

## Backend Development (CLI/Server)

### CLI Commands

**TypeScript Configuration:**
- File extensions: `.ts`
- Compiler: Bun's built-in TypeScript
- Build target: Node environments

### Server API

**Error Responses:**
```typescript
// Always return structured JSON errors
return json({ 
  error: "Descriptive error message",
  code: "ERROR_CODE"  // Optional: machine-readable code
}, 400);
```

**CORS Headers:**
```typescript
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
```

### File System Operations

**Path Handling:**
```typescript
import { join, basename, dirname } from 'node:path';

// Always use join for path construction
const filePath = join(projectDir, 'files', 'main.tex');

// Validate paths before operations
if (!existsSync(filePath)) {
  throw new Error(`File not found: ${filePath}`);
}
```

---

## Common Pitfalls to Avoid

### React

**❌ Avoid:**
```tsx
// Inline styles
<div style={{ color: 'red' }}>

// Anonymous functions in render
{items.map(item => (
  <div onClick={() => handleClick(item.id)}>
    {() => someExpensiveCalculation(item)}
  </div>
))}

// Missing dependencies in useEffect
useEffect(() => {
  loadData(item.id);
}); // Missing item.id dependency
```

**✅ Prefer:**
```tsx
// CSS classes
<div className="text-red-500">

// Memoized expensive operations
const expensiveOp = useMemo(() => calcHeavy(value), [value]);

// Include all dependencies
useEffect(() => {
  loadData(item.id);
}, [item.id]);
```

### TypeScript

**❌ Avoid:**
```typescript
// Type assertions without context
const data = unknownData as any;

// Loose types
function process(data: object) { ... }

// Ignoring null checks
data.property?.subProperty; // TypeScript error
```

**✅ Prefer:**
```typescript
// Type guards
function isSection(value: unknown): value is Section {
  return typeof value === 'object' && 'id' in value;
}

// Optional chaining
data.property?.subProperty?.value;

// Utility types
const data = unknownData as MyExpectedType;
```

### Async/Await

**❌ Avoid:**
```typescript
// Mixing async/await patterns
async function process() {
  const result = await fetch(url);
  return result.json(); // Double await
}
```

**✅ Prefer:**
```typescript
// Single await point
async function process() {
  const response = await fetch(url);
  return await response.json();
}
```

---

## Performance Considerations

### Large Lists

**Virtualization:**
- For lists with 100+ items, use `react-window` or `react-virtualized-list`
- For the file tree, lazy load children when folder expands

### Memoization

**Expensive Operations:**
```typescript
// Memoize parser results
const parsedSections = useMemo(() => 
  parseSections(content), [content]
);
```

### Code Splitting

**Dynamic Imports:**
```typescript
// Lazy load heavy components
const DiffViewer = lazy(() => import('./components/DiffViewer'));

// React.lazy with Suspense
<Suspense fallback={<Loading />}>
  <DiffViewer />
</Suspense>
```

---

## Debugging

### Console Logging

**✅ DO:**
```typescript
// Descriptive logs with context
console.log('[FileExplorer] Loading files for project:', projectId);

// Use console.error for failures
console.error('[API] Failed to fetch sections:', error);

// Use console.warn for recoverable issues
console.warn('[Parser] Could not parse section:', sectionText);
```

**❌ DON'T:**
```typescript
// Silent failures
try {
  await operation();
} catch (e) {
  // Nothing - error swallowed!
}

// Excessive logging
console.log('State changed:', state);
console.log('Render triggered');
console.log('User clicked');
```

---

## Security Considerations

### API Keys

**Environment Variables:**
```bash
# ✅ DO: Use .env file
OPENAI_API_KEY=sk-...

# ❌ DON'T: Hardcode keys
const API_KEY = 'sk-...';
```

**Environment Detection:**
```typescript
const isDevelopment = import.meta.env.DEV;
const API_BASE = isDevelopment 
  ? 'http://localhost:3002'
  : 'https://api.fastwrite.io';
```

### Input Validation

**Sanitize User Input:**
```typescript
// Never execute user input directly
const sanitizedInput = input.replace(/[<>]/g, '');

// Validate file paths
function isValidPath(path: string): boolean {
  return path.match(/^[a-zA-Z0-9_\-\/.]+$/);
}
```

---

## Build and Deployment

### Production Builds

**Type Checking:**
```bash
# Run type check before building
bun run typecheck
```

**Build Commands:**
```bash
# Frontend production build
cd web && bun run build

# Creates /web/dist with optimized assets
```

**Environment Variables:**
```bash
# Set NODE_ENV for production
NODE_ENV=production bun run build:web
```

---

## Design Reference

This codebase follows a modern, responsive two-column layout:
- **Left Sidebar (25%)**: File navigation and project structure
- **Right Panel (75%)**: Document viewing, AI editing, and diff visualization

The architecture supports modular development with clear separation of concerns between:
- UI components (React)
- State management (Context + hooks)
- API layer (fetch)
- Business logic (parsers, formatters)

---

## Project-Specific Guidelines

### FastWrite Architecture

**Monorepo Structure:**
```
/fastwrite-root
├── web/              # Frontend React app
│   ├── src/         # React components and logic
│   ├── dist/        # Production build output
│   └── package.json
├── src/              # Backend CLI and server
│   ├── cli.ts       # Command-line interface
│   ├── server.ts     # Bun.serve API
│   └── *.ts          # Utilities
├── projs/            # Project data (symlinked/copied LaTeX files)
└── latex-paper1/    # Original source files
```

**Key Files:**
- `src/server.ts`: Main API server with endpoints for files, backups, AI operations
- `web/src/App.tsx`: Root component managing global state
- `web/src/components/`: Modular React components
- `projs/fastwrite.config.json`: Project configuration

### Current Implementation Status

The codebase implements:
- ✅ Project import (local directory + GitHub) with file structure detection
- ✅ Natural-sorted file tree and document outline
- ✅ Three-mode viewing (Section/Paragraph/Sentence)
- ✅ AI Editor Panel with Diagnose/Refine/QuickFix modes
- ✅ Inline word-level diff view with Accept button
- ✅ LLM settings UI with API connection testing
- ✅ File-specific backup loading and version history
- ✅ Auto-save with debouncing

---

## Notes for External Agents

When working on this repository:

1. **Always run typecheck** before committing:
   ```bash
   bun run typecheck
   ```

2. **Test the full flow** after making changes:
   - Start with `bun run dev:integrated`
   - Test file loading, AI operations, and diff viewing
   - Verify the backend serves frontend correctly

3. **Respect existing patterns**:
   - Follow the established 25/75 layout split
   - Use Tailwind CSS utility classes consistently
   - Maintain TypeScript strict mode compliance

4. **Design files** in `/design/` contain detailed specifications for upcoming features:
   - Import paper functionality
   - Refine paper with multiple view modes
   - Advanced AI operation modes (Diagnose/Refine/QuickFix)
   These are comprehensive guides for future development

5. **Component organization**:
   - Keep components in `/web/src/components/`
   - Each component should be self-contained with clear props interface
   - Use `types/index.ts` for shared type definitions

6. **API integration**:
   - All API calls go through `web/src/api.ts`
   - Backend endpoints start with `/api/`
   - Handle errors gracefully with user-friendly messages
