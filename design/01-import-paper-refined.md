# Import Paper Module - Detailed Design Specification

## Overview
Enables users to import LaTeX papers from Git repositories or local directories with automatic structure detection, backup management, and project configuration.

---

## Data Models

### Project Metadata
```typescript
interface Project {
  id: string;                    // Unique project identifier (UUID)
  name: string;                  // User-friendly name
  type: 'git' | 'local';        // Import source
  sourceUrl: string;              // Git URL (for git projects)
  localPath: string;              // Local directory path
  gitBranch?: string;             // Selected branch (git projects only)
  createdAt: Date;                 // Import timestamp
  lastModified: Date;             // Last sync time
  status: 'active' | 'archived';
}

interface ProjectConfig {
  projectId: string;               // Reference to Project.id
  sectionsDir: string;            // Where .tex files live (original source)
  backupsDir: string;             // Where versions are saved
  aiCacheDir: string;            // AI response cache
  mainFile?: string;              // e.g., 'main.tex', 'paper.tex'
  bibFiles: string[];             // .bib bibliography files
}

interface ProjectFiles {
  projectId: string;
  files: FileNode[];             // LaTeX file tree
  sections: SectionNode[];        // Document outline from LaTeX
}

interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  isLaTeX?: boolean;             // true for .tex files
}

interface SectionNode {
  id: string;                    // Section ID (e.g., '1-introduction')
  level: number;                  // 1=section, 2=subsection, 3=subsubsection
  title: string;                  // Section title
  lineStart?: number;             // Line number in source file
}
```

### Storage Structure
```
projs/
├── projects.json                  // Array<Project> - All imported projects metadata
│
├── {project-id}/
│   ├── project.json               // ProjectConfig - Project settings
│   │
│   ├── files/                   // Symlinked or copied LaTeX files
│   │   ├── main.tex
│   │   ├── 0-abstract.tex
│   │   ├── 1-introduction.tex
│   │   └── ...
│   │
│   ├── backups/                  // Version history per file
│   │   ├── main.tex.20250113_143022.bak
│   │   ├── main.tex.20250113_143045.bak
│   │   └── 0-abstract.tex.20250113_144100.bak
│   │
│   ├── diffs/                    // Diff files (human-readable)
│   │   ├── main.tex.20250113_143045.diff
│   │   └── ...
│   │
│   └── ai-cache/                 // Cached AI responses
│       ├── section-1.diagnose.json
│       ├── section-1.refine.json
│       ├── sentence-123.quickfix.json
│       └── ...
```

---

## UI Components

### 1. Import Dialog (Modal)
#### Purpose
Entry point for importing new LaTeX projects into the application.

#### Layout
```
┌─────────────────────────────────────────────────────────────┐
│  Import LaTeX Paper Project                             │
├─────────────────────────────────────────────────────────────┤
│                                                          │
│  ◉ Import from Git Repository                            │
│  ○ Import from Local Directory                          │
│                                                          │
│  ══════════════════════════════════════════════     │
│                                                          │
│  [Git Repository URL]                               │
│  https://github.com/username/latex-paper.git            │
│                                                          │
│  Branch (optional): [main                  ▼]          │
│                                                          │
│  OR                                                       │
│                                                          │
│  [Local Directory Path]                             │
│  /Users/user/documents/my-paper                           │
│                                                          │
│  ══════════════════════════════════════════════     │
│                                                          │
│  Project Name: [My Academic Paper              ]        │
│                                                          │
│  [Cancel]                                        [Analyze]    │
└─────────────────────────────────────────────────────────────┘
```

#### States
1. **Initial**: Show source type selection (Git/Local)
2. **Input**: Show URL input for Git OR directory picker for Local
3. **Analyzing**: Show spinner with progress
4. **Preview**: Show detected files before confirming
5. **Importing**: Progress bar during clone/copy
6. **Success/Result**: Show imported project count and next steps

### 2. File Tree Preview (Before Import)
#### Purpose
Preview detected LaTeX structure before committing to import.

#### Layout
```
┌─────────────────────────────────────────────────────┐
│  Detected Project Structure                        │
├─────────────────────────────────────────────────────┤
│                                                   │
│  📂 my-paper/                              │
│    📁 chapters/                             │
│       📄 1-introduction.tex                │
│       📄 2-methodology.tex                  │
│       📄 3-results.tex                     │
│    📄 main.tex                              │
│    📁 figures/                              │
│    📄 references.bib                        │
│                                                   │
│  Found: 4 LaTeX files, 1 bibliography file          │
│                                                   │
│  [Back]                                   [Import All]  │
└─────────────────────────────────────────────────────┘
```

### 3. Progress Indication
#### Purpose
Show real-time progress during long-running operations (clone, copy, index).

#### States
```
State: CLONING
═══════════════════════════════════ 35%
Cloning repository from GitHub...

State: ANALYZING  
═══════════════════════════════════ 50%
Scanning for LaTeX files...

State: CREATING STRUCTURE
═════════════════════════════════════ 70%
Setting up backup directories...

State: INDEXING
═════════════════════════════════════ 90%
Building file index...

State: COMPLETE
═════════════════════════════════════ 100%
✓ Import complete!
```

---

## Core Features

### Git Import Flow
1. **Input Validation**
   - Validate URL format (GitHub, GitLab, Bitbucket patterns)
   - Check for .git extension (optional)
   - Validate HTTPS/SSH format

2. **Clone Strategy**
   - Use `git clone --depth 1 --single-branch --branch <branch>` for speed
   - Clone to temp directory first
   - Verify clone success before moving to projs/

3. **Branch Detection**
   - Auto-detect available branches
   - Show dropdown for branch selection
   - Default to 'main' or 'master'

4. **Credentials Handling**
   - HTTPS: Prompt for username/password if private repo
   - SSH: Use configured SSH keys (no prompt needed)
   - Store credentials securely (future: keychain integration)

### Local Import Flow
1. **Directory Selection**
   - Use `<input type="file" webkitdirectory directory>` for native picker
   - Fallback to text input with path validation
   - Check read permissions

2. **Symlink vs Copy Strategy**
   - Try creating symlinks first (faster, saves disk space)
   - Fallback to file copy if symlinks not supported
   - Preserve file timestamps

3. **Pattern Detection**
   - Auto-detect common patterns:
     - `{id}-{name}.tex` (FastWrite format)
     - `chapter{id}.tex` (book structure)
     - `section{id}.tex` (article structure)
     - `main.tex` with `\input{...}`

### Auto-Discovery Features
1. **Section Detection**
   - Scan for files matching patterns
   - Extract file ID from filename (e.g., "1-introduction.tex" → id=1)
   - Build file tree hierarchy

2. **Main File Detection**
   - Look for: `main.tex`, `paper.tex`, `document.tex`
   - Check for `\documentclass` in file content

3. **Bib File Detection**
   - Find all `.bib` files
   - Index for citation suggestions (future feature)

4. **Include/Content Parsing**
   - Detect `\input{...}` and `\include{...}` statements
   - Build dependency graph for the file tree

---

## Error Handling

| Error Scenario | Detection | User Message | Recovery Action |
|----------------|----------|---------------|-----------------|
| Invalid Git URL | URL regex mismatch | "Please enter a valid Git URL (GitHub, GitLab, etc.)" | Show input hint |
| Clone failed | `git clone` exit code | "Clone failed. Check network connection and repository access." | Retry button |
| Directory not readable | `readdir` throws | "Cannot read directory. Check permissions." | Re-pick directory |
| No .tex files found | File scan returns 0 matches | "No LaTeX files found. Select a different directory?" | Show directory picker again |
| Disk full | Copy operation fails | "Disk is full. Free up space and retry." | Stop import, show disk usage |
| Project exists | Duplicate ID in projects.json | "Project already exists. Import as new?" | Suggest different name |
| SSH key missing | Git clone asks for auth | "SSH key not found. Use HTTPS or add key." | Show SSH instructions |

---

## API Design

### File Service Interface
```typescript
interface FileService {
  // Project Management
  importGitProject(url: string, branch?: string, name: string): Promise<Project>;
  importLocalDirectory(path: string, name: string): Promise<Project>;
  
  // File Operations
  readFile(projectId: string, filePath: string): Promise<string>;
  writeFile(projectId: string, filePath: string, content: string): Promise<void>;
  
  // Backup Management
  createBackup(projectId: string, filePath: string): Promise<Backup>;
  restoreBackup(projectId: string, backupId: string): Promise<void>;
  
  // Structure Parsing
  parseProject(projectId: string): Promise<ProjectFiles>;
  parseOutline(latexContent: string): SectionNode[];
}

interface Backup {
  id: string;           // backup filename with timestamp
  originalPath: string;
  timestamp: string;
  content: string;
}
```

### React Components
```typescript
// ImportModal.tsx
interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (project: Project) => void;
  currentProjects: Project[];
}

// ImportProgress.tsx
interface ImportProgressProps {
  stage: 'analyzing' | 'cloning' | 'copying' | 'indexing' | 'complete';
  progress: number;      // 0-100
  currentFile?: string;  // For file-by-file progress
  message: string;
}

// FileTreePreview.tsx
interface FileTreePreviewProps {
  rootPath: string;
  files: FileNode[];
  onConfirm: () => void;
  onCancel: () => void;
}
```

---

## Implementation Notes

### Phase 1: UI Shell
- Create modal component with tabs for Git/Local
- Add validation for URLs and paths
- Integrate with existing Layout (overlay on top)

### Phase 2: Git Integration
- Use simple-git or isomorphic-git for Git operations
- Implement progress callbacks during clone
- Add branch listing functionality

### Phase 3: Local Import
- Implement directory picker with webkitdirectory attribute
- Add symlink creation logic
- Fallback to copy with progress tracking

### Phase 4: Structure Detection
- Write regex patterns for common LaTeX structures
- Parse `\input{...}` statements recursively
- Build file tree with depth

### Phase 5: Storage
- Create projects.json management (CRUD operations)
- Implement backup directory structure
- Add project initialization logic

### Tauri Migration Notes
- Replace `FileService` Web API calls with `invoke('read_file', ...)`
- Use Tauri's native file dialogs instead of HTML inputs
- Store projects.json in app data directory
- Native file watchers for detecting external changes

---

## Performance Considerations

- **Large Repositories**: Use shallow clones (`--depth 1`)
- **Many Files**: Show progress after every 10 files
- **Network Timeouts**: Set 30s timeout for clone operations
- **Memory**: Stream large files instead of loading all into memory
- **Caching**: Cache parsed structures in IndexedDB for faster reloads
