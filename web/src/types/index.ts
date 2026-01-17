// Project Types
export interface Project {
  id: string;
  name: string;
  type: 'local';
  localPath: string;
  createdAt: string;
  status: 'active' | 'archived';
}

export interface SelectedProject {
  project: Project;
  activeFileId?: string;
  config?: ProjectConfig;
}

export interface ProjectConfig {
  projectId: string;
  sectionsDir: string;
  backupsDir: string;
  bibFiles: string[];
  mainFile?: string;
  compiler?: 'pdflatex' | 'xelatex' | 'lualatex';
}

// File Types
export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  path: string;
  children?: FileNode[];
  content?: string;
  isLaTeX?: boolean;
}

export interface SelectedFile {
  id: string;
  name: string;
  path: string;
  content?: string;
}

export interface SectionNode {
  id: string;
  level: number;
  title: string;
  lineStart?: number;
  parentId?: string;
}

// Editor Types
export type ViewMode = 'section' | 'paragraph' | 'sentence';
export type AIMode = 'diagnose' | 'refine' | 'quickfix';

export interface TextItem {
  id: string;
  content: string;
  type: ViewMode;
  level?: number;
  children?: TextItem[];
  parentId?: string;
  lineStart?: number;
  originalContent?: string;
  modifiedContent?: string;
  status: 'unchanged' | 'modified' | 'applied';
  aiMode?: AIMode;
  aiTimestamp?: string;
}

// Diff Types
export interface DiffChange {
  type: 'addition' | 'deletion' | 'modification';
  original: string;
  modified: string;
  lineNumber?: number;
  explanation?: string;
}

export interface DiffResult {
  itemId: string;
  hasChanges: boolean;
  changes: DiffChange[];
  summary: {
    additions: number;
    deletions: number;
    modifications: number;
  };
}

export interface Backup {
  id: string;
  filename: string;
  timestamp: string;
  content: string;
}

// LLM Provider for multi-API management
export interface LLMProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  selectedModel: string;
  isActive: boolean;
  createdAt: number;
}
