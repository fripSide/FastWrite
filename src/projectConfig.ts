import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Project, ProjectConfig, SectionNode } from '../web/src/types';

const PROJS_DIR = join(process.cwd(), 'projs');
const PROJECTS_FILE = join(PROJS_DIR, 'projects.json');

export interface ProjectMetadata {
  id: string;
  name: string;
  type: 'local';
  localPath: string;
  createdAt: string;
  status: 'active' | 'archived';
}

function generateId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

export async function loadProjects(): Promise<ProjectMetadata[]> {
  if (!existsSync(PROJS_DIR)) {
    mkdirSync(PROJS_DIR, { recursive: true });
  }
  
  if (!existsSync(PROJECTS_FILE)) {
    writeFileSync(PROJECTS_FILE, '[]', 'utf-8');
    return [];
  }

  try {
    return JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

async function saveProjects(projects: ProjectMetadata[]): Promise<void> {
  writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8');
}

export async function createProject(name: string, localPath: string): Promise<ProjectMetadata> {
  const projects = await loadProjects();
  
  const normalizedPath = localPath.replace(/\/+$/, '');
  const projectName = name || basename(normalizedPath);
  
  const existing = projects.find(p => p.localPath.replace(/\/+$/, '') === normalizedPath);
  if (existing) {
    if (existing.name !== projectName) {
      existing.name = projectName;
      await saveProjects(projects);
    }
    await setActiveProject(existing.id);
    return existing;
  }
  
  if (!existsSync(localPath)) {
    throw new Error(`Directory does not exist: ${localPath}`);
  }
  
  const stats = statSync(localPath);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${localPath}`);
  }

  const projectId = generateId();
  const projectDir = join(PROJS_DIR, projectId);
  const backupsDir = join(projectDir, 'backups');
  const aiCacheDir = join(projectDir, 'ai-cache');
  
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(backupsDir, { recursive: true });
  mkdirSync(aiCacheDir, { recursive: true });

  const files = readdirSync(localPath);
  const texFiles = files.filter(f => f.endsWith('.tex'));

  const config: ProjectConfig = {
    projectId,
    sectionsDir: normalizedPath,
    backupsDir,
    bibFiles: [],
    mainFile: texFiles.find(f => ['main.tex', 'paper.tex', 'document.tex'].includes(basename(f)))
  };

  writeFileSync(join(projectDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');

  const metadata: ProjectMetadata = {
    id: projectId,
    name: projectName,
    type: 'local',
    localPath: normalizedPath,
    createdAt: new Date().toISOString(),
    status: 'active'
  };

  // Deactivate other projects
  const updated: ProjectMetadata[] = projects.map(p => ({ ...p, status: 'archived' as const }));
  updated.push(metadata);
  await saveProjects(updated);

  return metadata;
}

export async function getProjectConfig(projectId: string): Promise<ProjectConfig | null> {
  const configPath = join(PROJS_DIR, projectId, 'config.json');
  
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const projects = await loadProjects();
  const filtered = projects.filter(p => p.id !== projectId);
  
  if (filtered.length === projects.length) {
    return false;
  }

  await saveProjects(filtered);
  
  try {
    const projectDir = join(PROJS_DIR, projectId);
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
    return true;
  } catch {
    return false;
  }
}

export async function setActiveProject(projectId: string): Promise<boolean> {
  const projects = await loadProjects();
  const project = projects.find(p => p.id === projectId);
  
  if (!project) return false;
  
  const updated = projects.map(p => ({
    ...p,
    status: (p.id === projectId ? 'active' : 'archived') as 'active' | 'archived'
  }));
  
  await saveProjects(updated);
  return true;
}

export async function getActiveProject(): Promise<ProjectMetadata | null> {
  const projects = await loadProjects();
  return projects.find(p => p.status === 'active') || null;
}
