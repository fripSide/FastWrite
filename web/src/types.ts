export interface FileNode {
	id: string;
	name: string;
	type: 'file' | 'folder';
	path: string;
	children?: FileNode[];
	isLaTeX?: boolean;
}

export interface Project {
	id: string;
	name: string;
	path: string;
	localPath: string;
	lastModified: string;
}

export interface SelectedProject {
	project: Project;
	files: FileNode[];
	activeFileId?: string;
}

export interface SelectedFile {
	id: string;
	path: string;
	name: string;
	content?: string;
}

export type ViewMode = 'section' | 'paragraph' | 'sentence';

export type AIMode = 'diagnose' | 'refine' | 'quickfix';

export interface TextItem {
	id: string;
	content: string;
	type: 'section' | 'subsection' | 'paragraph' | 'sentence';
	level?: number;
	children?: TextItem[];
	lineStart?: number;
	status: 'unchanged' | 'modified' | 'accepted' | 'rejected';
	parentId?: string;
	modifiedContent?: string;
}

export interface DiffChange {
	type: 'addition' | 'deletion' | 'modification';
	original: string;
	modified: string;
	lineNumber: number;
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

export interface SectionNode {
	id: string;
	title: string;
	level: number;
	line: number;
	lineStart?: number;
	children: SectionNode[];
}

export interface ChatMessage {
	id: string;
	role: 'user' | 'ai';
	content: string;
	suggestion?: string;
	model?: string;
	timestamp: Date | string;
}

export interface ProjectConfig {
	projectId: string;
	sectionsDir: string;
	backupsDir: string;
	bibFiles: string[];
	mainFile?: string;
	compiler?: string;
}

export interface Backup {
	id: string;
	timestamp: string;
	filePath: string;
	filename: string;
	content: string;
}

export interface LLMProvider {
	id: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	models: string[];
	selectedModel?: string;
	isActive: boolean;
	createdAt?: string | number;
}
