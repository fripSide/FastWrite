import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export interface ProjectConfig {
  /** Directory containing section LaTeX files like `{id}-{name}.tex` */
  sections_dir: string;
  /** Workspace directory containing `backups/`, `prompts/`, `diffs/` */
  proj_dir: string;
}

export interface FastWriteConfig {
  /** Name of current project */
  current_project: string | null;
  projects: Record<string, ProjectConfig>;
}

const CONFIG_FILE = "fastwrite.config.json";

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function coerceConfig(raw: unknown): FastWriteConfig {
  const empty: FastWriteConfig = { current_project: null, projects: {} };
  if (!isRecord(raw)) return empty;

  // v2 (design spec)
  if ("current_project" in raw || "projects" in raw) {
    const current_project = toStringOrNull(raw["current_project"]);
    const projectsRaw = raw["projects"];
    const projects: Record<string, ProjectConfig> = {};

    if (isRecord(projectsRaw)) {
      for (const [name, proj] of Object.entries(projectsRaw)) {
        if (!isRecord(proj)) continue;
        const sections_dir = toStringOrNull(proj["sections_dir"]);
        const proj_dir = toStringOrNull(proj["proj_dir"]);
        if (!sections_dir || !proj_dir) continue;
        projects[name] = { sections_dir, proj_dir };
      }
    }

    return { current_project, projects };
  }

  // v1 (older implementation): { activeProject, projects: {name:{sectionsPath, projDir}} }
  if ("activeProject" in raw || "projects" in raw) {
    const activeProject = toStringOrNull(raw["activeProject"]);
    const projectsRaw = raw["projects"];
    const projects: Record<string, ProjectConfig> = {};

    if (isRecord(projectsRaw)) {
      for (const [name, proj] of Object.entries(projectsRaw)) {
        if (!isRecord(proj)) continue;
        const sectionsPath = toStringOrNull(proj["sectionsPath"]);
        const projDir = toStringOrNull(proj["projDir"]);
        if (!sectionsPath || !projDir) continue;
        projects[name] = { sections_dir: sectionsPath, proj_dir: projDir };
      }
    }

    return { current_project: activeProject, projects };
  }

  // v0 (repo currently has): { sectionsPath, projDir }
  const sectionsPath = toStringOrNull(raw["sectionsPath"]);
  const projDir = toStringOrNull(raw["projDir"]);
  if (sectionsPath && projDir) {
    return {
      current_project: "default",
      projects: {
        default: {
          sections_dir: sectionsPath,
          proj_dir: projDir
        }
      }
    };
  }

  return empty;
}

export function loadConfig(): FastWriteConfig {
  if (!existsSync(CONFIG_FILE)) return { current_project: null, projects: {} };
  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    return coerceConfig(JSON.parse(content));
  } catch (error) {
    console.error(`Error loading config: ${error instanceof Error ? error.message : String(error)}`);
    return { current_project: null, projects: {} };
  }
}

export function saveConfig(config: FastWriteConfig): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export function deriveProjectNameFromSectionsDir(sectionsDir: string): string {
  // If sectionsDir = ".../paper/sections", project name = "paper"
  return basename(dirname(resolve(sectionsDir)));
}

export function getProjects(): Record<string, ProjectConfig> {
  return loadConfig().projects;
}

export function loadProjectConfig(): { name: string; project: ProjectConfig } | null {
  const cfg = loadConfig();
  if (!cfg.current_project) return null;
  const project = cfg.projects[cfg.current_project];
  if (!project) return null;
  return { name: cfg.current_project, project };
}

export function registerProject(opts: {
  projectName: string;
  sectionsDir: string;
  projDir: string;
}): void {
  const cfg = loadConfig();
  cfg.projects[opts.projectName] = {
    sections_dir: resolve(opts.sectionsDir),
    proj_dir: resolve(opts.projDir)
  };
  cfg.current_project = opts.projectName;
  saveConfig(cfg);
}

export function switchProject(name: string): ProjectConfig | null {
  const cfg = loadConfig();
  const project = cfg.projects[name];
  if (!project) return null;
  cfg.current_project = name;
  saveConfig(cfg);
  return project;
}
