import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { execSync } from "node:child_process";
import type { FileNode } from "../web/src/types";
import { 
  loadProjects, 
  createProject, 
  deleteProject, 
  setActiveProject,
  getProjectConfig,
  getActiveProject
} from "./projectConfig";
import { processWithAI } from "./llmService";

const PORT = 3002;
const STATIC_DIR = join(import.meta.dir, "../web/dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Shared directory scanning utility
function scanDirectoryForTexFiles(dir: string, base: string = dir): FileNode[] {
  const nodes: FileNode[] = [];
  
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = fullPath.replace(base + '/', '');
      
      if (entry.isDirectory()) {
        const children = scanDirectoryForTexFiles(fullPath, base);
        if (children.length > 0) {
          nodes.push({
            id: relativePath,
            name: entry.name,
            type: 'folder',
            path: fullPath,
            children
          });
        }
      } else if (entry.name.endsWith('.tex')) {
        nodes.push({
          id: relativePath,
          name: entry.name,
          type: 'file',
          path: fullPath,
          isLaTeX: true
        });
      }
    }
  } catch (error) {
    console.error(`Failed to scan directory ${dir}:`, error);
  }
  
  return nodes;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function serveStatic(pathname: string): Response | null {
  let filePath = join(STATIC_DIR, pathname);
  
  // Default to index.html for root or missing files (SPA)
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(STATIC_DIR, "index.html");
  }
  
  if (!existsSync(filePath)) {
    return null;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = readFileSync(filePath);
  
  return new Response(content, {
    headers: { "Content-Type": contentType },
  });
}

// API Handlers
const handlers: Record<string, (req: Request, params: string[]) => Promise<Response>> = {
  "GET:/api/projects": async () => json(await loadProjects()),

  "POST:/api/projects/import-local": async (req) => {
    try {
      const { path, name } = await req.json() as { path: string; name: string };
      if (!path || !name) return json({ error: "path and name are required" }, 400);
      return json(await createProject(name, path));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  "DELETE:/api/projects/:id": async (_req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: "Project ID required" }, 400);
    const success = await deleteProject(projectId);
    return success ? json({ success: true }) : json({ error: "Project not found" }, 404);
  },

  "POST:/api/projects/:id/activate": async (_req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: "Project ID required" }, 400);
    const success = await setActiveProject(projectId);
    return success ? json({ success: true }) : json({ error: "Project not found" }, 404);
  },

  "GET:/api/projects/:id/config": async (_req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: "Project ID required" }, 400);
    const config = await getProjectConfig(projectId);
    return config ? json(config) : json({ error: "Project config not found" }, 404);
  },

  "GET:/api/projects/:id/files": async (_req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: "Project ID required" }, 400);
    
    const config = await getProjectConfig(projectId);
    if (!config) return json({ error: "Project config not found" }, 404);
    
    const files = scanDirectoryForTexFiles(config.sectionsDir);
    return json({ files });
  },

  "GET:/api/project": async () => {
    const project = await getActiveProject();
    if (!project) return json({ error: "No active project" }, 404);
    const config = await getProjectConfig(project.id);
    return json({ ...project, config });
  },

  "POST:/api/utils/browse-directory": async () => {
    try {
      let command = "";
      if (process.platform === "darwin") {
        // macOS: Use osascript with Finder for better compatibility
        command = `osascript -e 'tell application "Finder"' -e 'activate' -e 'set selectedFolder to choose folder with prompt "Select LaTeX Project Directory"' -e 'return POSIX path of selectedFolder' -e 'end tell'`;
      } else if (process.platform === "win32") {
        command = `powershell -command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select LaTeX Project Directory'; if($f.ShowDialog() -eq 'OK') { $f.SelectedPath }"`;
      } else {
        command = `zenity --file-selection --directory --title="Select LaTeX Project Directory" 2>/dev/null || kdialog --getexistingdirectory ~ 2>/dev/null`;
      }
      const path = execSync(command, { encoding: 'utf-8', timeout: 60000 }).trim();
      return json({ path: path || null });
    } catch (err) {
      // User cancelled or error
      console.log('Directory picker:', err instanceof Error ? err.message : 'cancelled');
      return json({ path: null });
    }
  },

  "POST:/api/projects/analyze": async (req) => {
    try {
      const { path } = await req.json() as { path: string };
      if (!path || !existsSync(path)) return json({ error: "Invalid path" }, 400);
      
      const stats = statSync(path);
      if (!stats.isDirectory()) return json({ error: "Path is not a directory" }, 400);

      const files = scanDirectoryForTexFiles(path);
      return json({ files });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  "GET:/api/backups/:projectId": async (_req, params) => {
    const config = await getProjectConfig(params[0]!);
    if (!config) return json([]);
    
    const backupsDir = config.backupsDir;
    if (!existsSync(backupsDir)) return json([]);
    
    return json(readdirSync(backupsDir)
      .filter(f => f.endsWith(".bak"))
      .sort().reverse()
      .map(f => ({
        id: f,
        filename: f.replace(/\.\d{8}_\d{6}\.bak$/, ".tex"),
        timestamp: f.match(/\.(\d{8}_\d{6})\.bak$/)?.[1] || "",
        content: readFileSync(join(backupsDir, f), "utf-8")
      })));
  },

  "POST:/api/ai/process": async (req) => {
    try {
      const request = await req.json() as {
        mode: 'diagnose' | 'refine' | 'quickfix';
        content: string;
        systemPrompt?: string;
        userPrompt?: string;
      };
      return json({ content: await processWithAI(request) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  "GET:/api/system-prompt/:projectId": async (_req, params) => {
    const projDir = join(process.cwd(), "projs", params[0]!);
    const path = join(projDir, "system.md");
    return json({ content: existsSync(path) ? readFileSync(path, "utf-8") : "" });
  },

  "POST:/api/system-prompt/:projectId": async (req, params) => {
    const { content } = await req.json() as { content: string };
    const projDir = join(process.cwd(), "projs", params[0]!);
    
    if (!existsSync(projDir)) mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "system.md"), content, "utf-8");
    return json({ success: true });
  },

  "POST:/api/projects/import-github": async (req) => {
    try {
      const { url, branch } = await req.json() as { url: string; branch?: string };

      if (!url) return json({ error: "GitHub URL is required" }, 400);

      const match = url.match(/github\.com[:/]([^/]+)\/([^/]+)/);
      if (!match || match.length < 3) return json({ error: "Invalid GitHub URL" }, 400);

      const [, owner, repo] = match;
      const repoName = repo?.replace(/\.git$/, '') || '';
      const projectBranch = branch || 'main';

      const tempDir = join(process.cwd(), "projs", `temp_${Date.now()}`);
      const targetDir = join(tempDir, repoName);

      mkdirSync(tempDir, { recursive: true });

      try {
        execSync(`git clone --depth 1 --branch ${projectBranch} https://github.com/${owner}/${repo}.git ${targetDir}`, {
          stdio: 'inherit',
          timeout: 60000
        });

        return json({
          success: true,
          path: targetDir,
          name: repoName
        });
      } catch (error) {
        return json({ error: `Git clone failed: ${error instanceof Error ? error.message : String(error)}` }, 500);
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  "GET:/api/parse-sections": async (req) => {
    const url = new URL(req.url);
    const path = url.searchParams.get('path');

    if (!path) return json({ error: "path parameter is required" }, 400);
    if (!existsSync(path)) return json({ error: "File not found" }, 404);

    try {
      const content = readFileSync(path, 'utf-8');
      const lines = content.split('\n');
      const sections: { id: string; level: number; title: string; lineStart: number }[] = [];

      const sectionRegex = /\\section\*?\s*\{([^}]*)\}/;
      const subsectionRegex = /\\subsection\*?\s*\{([^}]*)\}/;
      const subsubsectionRegex = /\\subsubsection\*?\s*\{([^}]*)\}/;

      lines.forEach((line, index) => {
        let match: RegExpExecArray | null = null;
        let level = 0;

        if ((match = sectionRegex.exec(line)) !== null) {
          level = 1;
        } else if ((match = subsectionRegex.exec(line)) !== null) {
          level = 2;
        } else if ((match = subsubsectionRegex.exec(line)) !== null) {
          level = 3;
        }

        if (match && level > 0) {
          const title = match[1] || '';
          const id = `section_${sections.length}`;
          sections.push({
            id,
            level,
            title: title.trim(),
            lineStart: index + 1
          });
        }
      });

      return json({ sections });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }
};

// Route matcher
function matchRoute(method: string, path: string): { handler: (req: Request, params: string[]) => Promise<Response>; params: string[] } | null {
  for (const [pattern, handler] of Object.entries(handlers)) {
    const [m, ...pathParts] = pattern.split(":");
    const routePath = pathParts.join(":");
    if (m !== method) continue;
    
    const routeSegments = routePath.split("/");
    const pathSegments = path.split("/");
    if (routeSegments.length !== pathSegments.length) continue;
    
    const params: string[] = [];
    let match = true;
    
    for (let i = 0; i < routeSegments.length; i++) {
      if (routeSegments[i]!.startsWith(":")) {
        params.push(pathSegments[i]!);
      } else if (routeSegments[i] !== pathSegments[i]) {
        match = false;
        break;
      }
    }
    
    if (match) return { handler, params };
  }
  return null;
}

// Server
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    
    // API routes
    if (url.pathname.startsWith("/api/")) {
      const matched = matchRoute(req.method, url.pathname);
      if (matched) {
        return matched.handler(req, matched.params);
      }
      return json({ error: "Not found" }, 404);
    }

    // Static files
    const staticResponse = serveStatic(url.pathname);
    if (staticResponse) {
      return staticResponse;
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`FastWrite running at http://localhost:${PORT}`);
