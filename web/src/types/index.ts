// Project Types
export interface Project {
  id: string;
  name: string;
  type: 'local';
  localPath: string;
  createdAt: string;
  status: 'active' | 'archived';
}

export interface ProjectConfig {
  projectId: string;
  sectionsDir: string;
  backupsDir: string;
  mainFile?: string;
  bibFiles: string[];
}

export interface SelectedProject {
  project: Project;
  activeFileId?: string;
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

// AI Types
export interface AIModeConfig {
  systemPrompt: string;
  model?: string;
  temperature?: number;
}

export interface AIResponse {
  requestId: string;
  mode: AIMode;
  itemId: string;
  originalContent: string;
  modifiedContent: string;
  explanation?: string;
  suggestions?: string[];
  timestamp: string;
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

// Legacy (for API compatibility)
export interface Backup {
  id: string;
  filename: string;
  timestamp: string;
  content: string;
}

export interface DiffItem {
  type: 'unchanged' | 'added' | 'removed';
  text: string;
}
