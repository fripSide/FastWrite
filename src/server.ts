import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, unlinkSync, renameSync } from "node:fs";
import { join, extname, basename, dirname } from "node:path";
import { execSync } from "node:child_process";
import type { FileNode } from "../web/src/types";
import {
  loadProjects,
  createProject,
  deleteProject,
  setActiveProject,
  getProjectConfig,
  updateProjectConfig,
  getActiveProject
} from "./projectConfig";
import { processWithAI, getLLMConfig, saveLLMConfig, getLLMProviders, saveLLMProvider, deleteLLMProvider, setActiveProvider, fetchModelsFromAPI, getProjectPrompts, saveProjectPrompts, loadAICache, saveAICache, DEFAULT_PROMPTS, type LLMProvider, type ProjectPrompts } from "./llmService";


import { isEmbeddedAsset, getEmbeddedAsset } from "./embeddedAssets";

const PORT = parseInt(process.env.PORT || "3002", 10);
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
// Sort: folders first, then files; within each group, natural sort (0-abstract before 1-introduction)
function naturalSort(a: FileNode, b: FileNode): number {
  // Folders come before files
  if (a.type === 'folder' && b.type !== 'folder') return -1;
  if (a.type !== 'folder' && b.type === 'folder') return 1;
  // Within same type, use natural sort
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function scanDirectoryForTexFiles(dir: string, base: string = dir): FileNode[] {
  const nodes: FileNode[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = fullPath.replace(base + '/', '');

      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === 'output') continue;
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
      } else {
        // Include other project assets (images, bib, sty, cls, etc.)
        const assetExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.pdf', '.eps',
          '.bib', '.bbl', '.sty', '.cls', '.bst'];
        if (assetExts.some(ext => entry.name.toLowerCase().endsWith(ext))) {
          nodes.push({
            id: relativePath,
            name: entry.name,
            type: 'file',
            path: fullPath,
          });
        }
      }
    }
  } catch (error) {
    console.error(`Failed to scan directory ${dir}:`, error);
  }

  return nodes.sort(naturalSort);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function serveStatic(pathname: string): Response | null {
  // Try to serve from embedded assets first (for single binary mode)
  const embeddedPath = pathname === "/" ? "/index.html" : pathname;
  if (isEmbeddedAsset(embeddedPath)) {
    const assetPath = getEmbeddedAsset(embeddedPath);
    if (assetPath) {
      const ext = extname(embeddedPath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      const content = Bun.file(assetPath);
      return new Response(content, {
        headers: { "Content-Type": contentType },
      });
    }
  }

  // SPA fallback - serve index.html for unknown paths
  if (!embeddedPath.startsWith("/assets/") && !embeddedPath.includes(".") && isEmbeddedAsset("/index.html")) {
    const indexPath = getEmbeddedAsset("/index.html");
    if (indexPath) {
      return new Response(Bun.file(indexPath), {
        headers: { "Content-Type": "text/html" },
      });
    }
  }

  // Fallback to filesystem for development mode
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
      const { path, name, mainFile } = await req.json() as { path: string; name: string; mainFile?: string };
      if (!path || !name) return json({ error: "path and name are required" }, 400);
      return json(await createProject(name, path, mainFile));
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

  "GET:/api/projects/:id/ai-cache": async (_req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: "Project ID required" }, 400);
    const config = await getProjectConfig(projectId);
    if (!config) return json({ error: "Project not found" }, 404);
    const cache = await loadAICache(config.sectionsDir);
    return json(cache);
  },

  "POST:/api/projects/:id/ai-cache": async (req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: "Project ID required" }, 400);
    const config = await getProjectConfig(projectId);
    if (!config) return json({ error: "Project not found" }, 404);
    const body = await req.json() as Record<string, any[]>;
    await saveAICache(config.sectionsDir, body);
    return json({ success: true });
  },

  "GET:/api/projects/:id/config": async (_req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: "Project ID required" }, 400);
    const config = await getProjectConfig(projectId);
    return config ? json(config) : json({ error: "Project config not found" }, 404);
  },

  "POST:/api/projects/:id/config": async (req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: "Project ID required" }, 400);
    try {
      const updates = await req.json() as Partial<import("../web/src/types").ProjectConfig>;
      const config = await updateProjectConfig(projectId, updates);
      return config ? json(config) : json({ error: "Project config not found" }, 404);
    } catch (error) {
      return json({ error: String(error) }, 500);
    }
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
        command = `osascript -e 'POSIX path of (choose folder with prompt "Select LaTeX Project Directory")'`;
      } else if (process.platform === "win32") {
        command = `powershell -command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select LaTeX Project Directory'; if($f.ShowDialog() -eq 'OK') { $f.SelectedPath }"`;
      } else {
        command = `zenity --file-selection --directory --title="Select LaTeX Project Directory" 2>/dev/null || kdialog --getexistingdirectory ~ 2>/dev/null`;
      }
      const path = execSync(command, { encoding: 'utf-8', timeout: 60000 }).trim();
      return json({ path: path || null });
    } catch (err) {
      console.log('Directory picker:', err instanceof Error ? err.message : 'cancelled');
      return json({ path: null });
    }
  },

  "POST:/api/utils/list-directory": async (req) => {
    try {
      const { path: dirPath } = await req.json() as { path?: string };
      const targetPath = dirPath || (process.platform === "win32" ? "C:\\" : "/");

      if (!existsSync(targetPath)) return json({ error: "Path not found" }, 404);
      if (!statSync(targetPath).isDirectory()) return json({ error: "Not a directory" }, 400);

      const entries = readdirSync(targetPath, { withFileTypes: true });
      const dirs: { name: string; path: string }[] = [];
      const texFiles: { name: string; path: string; hasDocumentclass: boolean }[] = [];

      for (const entry of entries) {
        // Skip hidden entries
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
          dirs.push({ name: entry.name, path: join(targetPath, entry.name) });
        } else if (entry.isFile() && entry.name.endsWith('.tex')) {
          // Check if this tex file contains \documentclass (likely main file)
          let hasDocumentclass = false;
          try {
            const content = readFileSync(join(targetPath, entry.name), 'utf-8');
            hasDocumentclass = content.includes('\\documentclass');
          } catch { /* ignore read errors */ }
          texFiles.push({
            name: entry.name,
            path: join(targetPath, entry.name),
            hasDocumentclass
          });
        }
      }

      // Sort alphabetically
      dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      texFiles.sort((a, b) => {
        // Put documentclass files first
        if (a.hasDocumentclass && !b.hasDocumentclass) return -1;
        if (!a.hasDocumentclass && b.hasDocumentclass) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      return json({ path: targetPath, dirs, texFiles, hasTexFiles: texFiles.length > 0 });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },

  "POST:/api/utils/open-in-finder": async (req) => {
    try {
      const { path: targetPath } = await req.json() as { path: string };
      if (!targetPath || !existsSync(targetPath)) return json({ error: "Path not found" }, 404);
      const isDir = statSync(targetPath).isDirectory();
      if (process.platform === "darwin") {
        execSync(isDir ? `open "${targetPath}"` : `open -R "${targetPath}"`, { timeout: 5000 });
      } else if (process.platform === "win32") {
        execSync(isDir ? `explorer "${targetPath}"` : `explorer /select,"${targetPath}"`, { timeout: 5000 });
      } else {
        execSync(`xdg-open "${dirname(targetPath)}"`, { timeout: 5000 });
      }
      return json({ success: true });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  "POST:/api/utils/create-file": async (req) => {
    try {
      const { parentDir, name } = await req.json() as { parentDir: string; name: string };
      if (!parentDir || !name) return json({ error: "parentDir and name are required" }, 400);
      const targetPath = join(parentDir, name);
      if (existsSync(targetPath)) return json({ error: "File already exists" }, 409);
      // Create parent dirs if needed (for new folders with a file)
      const dir = dirname(targetPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(targetPath, '', 'utf-8');
      return json({ success: true, path: targetPath });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
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
    if (!config) {
      console.log('GET /api/backups: Project config not found for', params[0]);
      return json([]);
    }

    const backupsDir = config.backupsDir;
    console.log('GET /api/backups: Checking dir', backupsDir);

    if (!existsSync(backupsDir)) {
      console.log('GET /api/backups: Dir does not exist');
      return json([]);
    }

    const files = readdirSync(backupsDir);
    console.log(`GET /api/backups: Found ${files.length} files. Filtering for .bak...`);

    const results = files
      .filter(f => f.endsWith(".bak"))
      .sort().reverse()
      .map(f => {
        // Format: filename.ext.YYYYMMDDHHMMSS.bak (might have extra dots if timestamp included one)
        // Regex allows dots in timestamp part, and multiple dots before bak
        const match = f.match(/^(.*)\.(\d+[\d.]*)\.+bak$/);
        return {
          id: f,
          filename: match ? match[1] : f,
          timestamp: (match && match[2]) ? match[2].replace(/\./g, '') : "",
          content: readFileSync(join(backupsDir, f), "utf-8")
        };
      });

    console.log(`GET /api/backups: Returning ${results.length} backups.`);
    return json(results);
  },

  "DELETE:/api/backups/:projectId": async (req, params) => {
    try {
      const projectId = params[0]!;
      const config = await getProjectConfig(projectId);
      if (!config) return json({ error: "Project not found" }, 404);

      const backupsDir = config.backupsDir;
      if (!existsSync(backupsDir)) return json({ success: true });

      const url = new URL(req.url);
      const filename = url.searchParams.get("filename");
      const { unlinkSync } = await import("node:fs");

      const files = readdirSync(backupsDir).filter(f => f.endsWith(".bak"));
      let deletedCount = 0;

      for (const f of files) {
        // If filename is specified, only delete matching backups
        if (filename) {
          // Check if backup file starts with the target filename
          // Backup format: target_filename.timestamp.bak
          // We need to be careful not to match substrings incorrectly
          if (!f.startsWith(filename + ".")) continue;
        }

        try {
          unlinkSync(join(backupsDir, f));
          deletedCount++;
        } catch (e) {
          console.error(`Failed to delete backup ${f}`, e);
        }
      }

      return json({ success: true, count: deletedCount });
    } catch (error) {
      return json({ error: String(error) }, 500);
    }
  },

  "POST:/api/ai/process": async (req) => {
    try {
      const request = await req.json() as {
        mode: 'diagnose' | 'refine' | 'quickfix';
        content: string;
        systemPrompt?: string;
        userPrompt?: string;
      };
      return json(await processWithAI(request));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  "GET:/api/llm-config": async () => {
    const config = getLLMConfig();
    // Mask API key for security
    return json({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey ? `${config.apiKey.substring(0, 8)}...${config.apiKey.substring(config.apiKey.length - 4)}` : '',
      model: config.model,
      hasApiKey: !!config.apiKey
    });
  },

  "POST:/api/llm-config": async (req) => {
    try {
      const config = await req.json() as { baseUrl?: string; apiKey?: string; model?: string };
      const success = saveLLMConfig(config);
      return success ? json({ success: true }) : json({ error: "Failed to save config" }, 500);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  "POST:/api/llm-config/test": async (req) => {
    try {
      const config = await req.json() as { baseUrl: string; apiKey: string; model: string; providerId?: string };

      if (!config.apiKey) {
        return json({ success: false, error: "API key is required" }, 400);
      }

      let effectiveApiKey = config.apiKey;

      // Check if key is masked and we have a provider ID to look up the real key
      if (config.apiKey.includes('...') && config.providerId) {
        const providers = getLLMProviders();
        const storedProvider = providers.find(p => p.id === config.providerId);

        if (storedProvider && storedProvider.apiKey) {
          const prefix = storedProvider.apiKey.substring(0, 8);
          const suffix = storedProvider.apiKey.substring(storedProvider.apiKey.length - 4);
          const masked = `${prefix}...${suffix}`;

          if (config.apiKey === masked) {
            console.log(`Using stored API key for testing provider ${storedProvider.name}`);
            effectiveApiKey = storedProvider.apiKey;
          }
        }
      }

      // Use OpenAI SDK to test connection
      const OpenAI = (await import('openai')).default;
      const baseURL = config.baseUrl.replace(/\/chat\/completions\/?$/, '');
      const client = new OpenAI({
        apiKey: effectiveApiKey,
        baseURL,
        timeout: 10000 // 10s timeout
      });

      console.log(`Testing connection to ${baseURL}...`);

      const response = await client.chat.completions.create({
        model: config.model,
        messages: [{ role: 'user', content: 'Hi, please respond with just "OK" to confirm the connection works.' }],
        max_tokens: 10,
        temperature: 0
      });

      console.log("Connection test success");

      const content = response.choices[0]?.message?.content;
      return json({
        success: true,
        message: content || 'Connection successful',
        model: response.model
      });
    } catch (error) {
      console.error("Connection test failed:", error);
      const message = error instanceof Error ? error.message : String(error);
      return json({ success: false, error: message }, 200); // Return 200 so frontend can show error
    }
  },

  // ============ LLM Providers (Multi-API Management) ============

  "GET:/api/llm-providers": async () => {
    const providers = getLLMProviders();
    // Mask API keys for security
    const masked = providers.map(p => ({
      ...p,
      apiKey: p.apiKey ? `${p.apiKey.substring(0, 8)}...${p.apiKey.substring(p.apiKey.length - 4)}` : ''
    }));
    return json(masked);
  },

  "POST:/api/llm-providers": async (req) => {
    try {
      const provider = await req.json() as LLMProvider;
      if (!provider.id || !provider.name || !provider.baseUrl) {
        return json({ error: "id, name, and baseUrl are required" }, 400);
      }
      const success = saveLLMProvider(provider);
      return success ? json({ success: true }) : json({ error: "Failed to save provider" }, 500);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  "DELETE:/api/llm-providers/:id": async (_req, params) => {
    const id = params[0];
    if (!id) return json({ error: "Provider ID required" }, 400);
    const success = deleteLLMProvider(id);
    return success ? json({ success: true }) : json({ error: "Failed to delete provider" }, 500);
  },

  "POST:/api/llm-providers/:id/activate": async (_req, params) => {
    const id = params[0];
    if (!id) return json({ error: "Provider ID required" }, 400);
    const success = setActiveProvider(id);
    return success ? json({ success: true }) : json({ error: "Provider not found" }, 404);
  },

  "POST:/api/llm-providers/fetch-models": async (req) => {
    try {
      const { baseUrl, apiKey } = await req.json() as { baseUrl: string; apiKey: string };
      if (!baseUrl || !apiKey) {
        return json({ error: "baseUrl and apiKey are required" }, 400);
      }
      const models = await fetchModelsFromAPI(baseUrl, apiKey);
      return json({ models });
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

  // ============ Project Prompts (AI Mode Prompts) ============

  "GET:/api/prompts/:projectId": async (_req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: "Project ID required" }, 400);

    const prompts = getProjectPrompts(projectId);
    return json(prompts);
  },

  "POST:/api/prompts/:projectId": async (req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: "Project ID required" }, 400);

    try {
      const prompts = await req.json() as Partial<ProjectPrompts>;
      const success = saveProjectPrompts(projectId, prompts);
      return success ? json({ success: true }) : json({ error: "Failed to save prompts" }, 500);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  "POST:/api/prompts/:projectId/reset": async (_req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: "Project ID required" }, 400);

    // Delete prompts.json to reset to defaults
    const promptsFile = join(process.cwd(), "projs", projectId, "prompts.json");
    try {
      if (existsSync(promptsFile)) {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(promptsFile);
      }

      // Return full default project prompts including keys that might be missing in DEFAULT_PROMPTS
      const defaults = getProjectPrompts(projectId);
      return json({ success: true, prompts: defaults });
    } catch (error) {
      return json({ error: "Failed to reset prompts" }, 500);
    }
  },

  "GET:/api/prompts/defaults": async () => {
    return json(DEFAULT_PROMPTS);
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
      const visited = new Set<string>();
      const sections: { id: string; level: number; title: string; lineStart: number; filePath: string }[] = [];
      const sectionRegex = /\\(section|subsection|subsubsection)\*?\s*\{([^}]*)\}/;
      const inputRegex = /\\(?:input|include)\s*\{([^}]*)\}/;

      // Recursive function to parse files
      function parseFile(filePath: string) {
        // Resolve path: if no extension, try .tex
        let resolvedPath = filePath;
        if (!existsSync(resolvedPath) && existsSync(resolvedPath + '.tex')) {
          resolvedPath += '.tex';
        }

        console.log(`[ParseSections] Parsing: ${resolvedPath} (Original: ${filePath})`);

        if (!existsSync(resolvedPath)) {
          console.warn(`[ParseSections] File not found: ${filePath} -> ${resolvedPath}`);
          return;
        }

        // Avoid circular dependencies
        if (visited.has(resolvedPath)) {
          console.log(`[ParseSections] Skipping visited: ${resolvedPath}`);
          return;
        }
        visited.add(resolvedPath);

        const content = readFileSync(resolvedPath, 'utf-8');
        const lines = content.split('\n');
        // Use dirname from imported node:path
        const currentDir = dirname(resolvedPath);

        lines.forEach((line, index) => {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('%')) return; // Skip comments

          // Check for sections
          const sectionMatch = sectionRegex.exec(line);
          if (sectionMatch) {
            const type = sectionMatch[1];
            let level = 0;
            if (type === 'section') level = 1;
            else if (type === 'subsection') level = 2;
            else if (type === 'subsubsection') level = 3;

            if (level > 0) {
              const title = (sectionMatch[2] || '').trim();
              console.log(`[ParseSections] Found section: ${title} in ${resolvedPath} line ${index + 1}`);
              sections.push({
                id: `section_${sections.length}`,
                level,
                title,
                lineStart: index + 1,
                filePath: resolvedPath
              });
            }
          }

          // Check for inputs
          const inputMatch = inputRegex.exec(line);
          if (inputMatch) {
            const includePath = (inputMatch[1] || '').trim();
            if (!includePath) return;

            // Resolve relative to current file's directory
            const fullIncludePath = join(currentDir, includePath);
            console.log(`[ParseSections] Found input: ${includePath} -> ${fullIncludePath}`);
            parseFile(fullIncludePath);
          }
        });
      }

      parseFile(path);

      return json({ sections });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  // LaTeX compilation and PDF preview APIs
  "GET:/api/latex/status": async () => {
    try {
      // Check for pdflatex or xelatex
      let installed = false;
      let version = '';
      let engine = '';

      // macOS standard TeX Live path
      const texBinPath = '/Library/TeX/texbin';

      if (existsSync(`${texBinPath}/pdflatex`)) {
        try {
          const result = execSync(`"${texBinPath}/pdflatex" --version 2>&1`, {
            encoding: 'utf-8',
            timeout: 5000
          });
          installed = true;
          engine = 'pdflatex';
          const versionMatch = result.match(/pdfTeX[^\n]*/i);
          version = versionMatch ? versionMatch[0].trim() : 'pdflatex';
        } catch {
          installed = true;
          engine = 'pdflatex';
          version = 'pdflatex';
        }
      } else if (existsSync(`${texBinPath}/xelatex`)) {
        try {
          const result = execSync(`"${texBinPath}/xelatex" --version 2>&1`, {
            encoding: 'utf-8',
            timeout: 5000
          });
          installed = true;
          engine = 'xelatex';
          const versionMatch = result.match(/XeTeX[^\n]*/i);
          version = versionMatch ? versionMatch[0].trim() : 'xelatex';
        } catch {
          installed = true;
          engine = 'xelatex';
          version = 'xelatex';
        }
      }

      return json({ installed, version, engine });
    } catch (error) {
      return json({ installed: false, error: String(error) });
    }
  },

  "POST:/api/latex/compile": async (req) => {
    try {
      const { projectId, texPath } = await req.json() as { projectId: string; texPath: string };

      if (!projectId || !texPath) {
        return json({ success: false, error: 'projectId and texPath are required' }, 400);
      }

      const config = await getProjectConfig(projectId);
      if (!config) {
        return json({ success: false, error: 'Project not found' }, 404);
      }

      if (!existsSync(texPath)) {
        return json({ success: false, error: 'TeX file not found' }, 404);
      }

      // Determine which LaTeX engine to use (macOS path: /Library/TeX/texbin/)
      // Determine which LaTeX engine to use (macOS path: /Library/TeX/texbin/)
      let engine = '';
      const texBinPath = '/Library/TeX/texbin';
      const preferredCompiler = config.compiler || 'pdflatex';

      if (existsSync(`${texBinPath}/${preferredCompiler}`)) {
        engine = `${texBinPath}/${preferredCompiler}`;
      } else if (existsSync(`${texBinPath}/pdflatex`)) {
        engine = `${texBinPath}/pdflatex`;
      } else if (existsSync(`${texBinPath}/xelatex`)) {
        engine = `${texBinPath}/xelatex`;
      } else if (preferredCompiler === 'browser-wasm') {
        return json({ success: false, error: 'Client-side WASM compilation requested but reached server. Check frontend configuration.' }, 400);
      } else {
        // Try system PATH as fallback
        try {
          const which = execSync(`which ${preferredCompiler}`, { encoding: 'utf-8' }).trim();
          if (which) engine = which;
        } catch {
          try {
            const which = execSync('which pdflatex', { encoding: 'utf-8' }).trim();
            if (which) engine = which;
          } catch {
            try {
              const which = execSync('which xelatex', { encoding: 'utf-8' }).trim();
              if (which) engine = which;
            } catch {
              return json({ success: false, error: 'No LaTeX engine found. Please install TeX Live or MiKTeX.' }, 500);
            }
          }
        }
      }

      // Get directory and filename
      const texDir = require('path').dirname(texPath);
      const texFilename = require('path').basename(texPath);
      const outputName = texFilename.replace(/\.tex$/, '');
      const outputDir = join(texDir, 'output');

      // Ensure output dir exists
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Run compilation with synctex enabled, output to outputDir
      const command = `cd "${texDir}" && "${engine}" -output-directory=output -synctex=1 -interaction=nonstopmode -file-line-error "${texFilename}" 2>&1`;

      try {
        execSync(command, { encoding: 'utf-8', timeout: 60000, maxBuffer: 1024 * 1024 * 10 });
      } catch (compileError: unknown) {
        // LaTeX often returns non-zero even on success, check if PDF was created
        const pdfPath = join(outputDir, `${outputName}.pdf`);
        if (!existsSync(pdfPath)) {
          const errorMessage = compileError instanceof Error ? compileError.message : String(compileError);
          // Extract useful error lines
          const lines = errorMessage.split('\n');
          const errorLines = lines.filter(l => l.includes('!') || l.includes('Error') || l.includes('error:'));
          return json({
            success: false,
            error: errorLines.length > 0 ? errorLines.slice(0, 10).join('\n') : 'Compilation failed'
          }, 200);
        }
      }

      const pdfPath = join(outputDir, `${outputName}.pdf`);
      const synctexPath = join(outputDir, `${outputName}.synctex.gz`);

      if (!existsSync(pdfPath)) {
        return json({ success: false, error: 'PDF was not generated' }, 200);
      }

      return json({
        success: true,
        pdfPath,
        synctexPath: existsSync(synctexPath) ? synctexPath : null
      });
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  "POST:/api/latex/save-pdf/:projectId": async (req, params) => {
    try {
      const projectId = params[0];
      if (!projectId) return json({ error: 'Project ID required' }, 400);

      const config = await getProjectConfig(projectId);
      if (!config) return json({ error: 'Project not found' }, 404);

      const outputDir = join(config.sectionsDir, 'output');
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      const pdfPath = join(outputDir, 'document.pdf');

      // Read binary body
      const arrayBuffer = await req.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      writeFileSync(pdfPath, buffer);

      return json({ success: true, pdfPath });
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  "GET:/api/latex/pdf/:projectId": async (_req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: 'Project ID required' }, 400);

    const config = await getProjectConfig(projectId);
    if (!config) return json({ error: 'Project not found' }, 404);

    // Find PDF in sections directory (look for any .pdf file)
    const sectionsDir = config.sectionsDir;

    const findPdf = (dir: string): string | null => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isFile() && entry.name.endsWith('.pdf')) {
            return full;
          }
          if (entry.isDirectory()) {
            const found = findPdf(full);
            if (found) return found;
          }
        }
      } catch { /* ignore */ }
      return null;
    };

    const pdfPath = findPdf(sectionsDir);
    if (!pdfPath || !existsSync(pdfPath)) {
      return json({ error: 'PDF not found' }, 404);
    }

    const pdfContent = readFileSync(pdfPath);
    return new Response(pdfContent, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${basename(pdfPath)}"`,
        'Cache-Control': 'no-cache'
      }
    });
  },

  // Reveal PDF in Finder (macOS)
  "POST:/api/latex/reveal/:projectId": async (_req, params) => {
    const projectId = params[0];
    if (!projectId) return json({ error: 'Project ID required' }, 400);

    const config = await getProjectConfig(projectId);
    if (!config) return json({ error: 'Project not found' }, 404);

    // Find PDF in sections directory
    const sectionsDir = config.sectionsDir;
    const findPdf = (dir: string): string | null => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isFile() && entry.name.endsWith('.pdf')) {
            return full;
          }
          if (entry.isDirectory()) {
            const found = findPdf(full);
            if (found) return found;
          }
        }
      } catch { /* ignore */ }
      return null;
    };

    const pdfPath = findPdf(sectionsDir);
    if (!pdfPath || !existsSync(pdfPath)) {
      return json({ error: 'PDF not found' }, 404);
    }

    try {
      // macOS: open -R reveals file in Finder
      execSync(`open -R "${pdfPath}"`);
      return json({ success: true, path: pdfPath });
    } catch (error) {
      return json({ success: false, error: String(error) }, 500);
    }
  },

  "POST:/api/latex/synctex": async (req) => {
    try {
      const { parseSynctex, pdfToSource, getSynctexPath } = await import('./synctex');
      const { projectId, page, x, y } = await req.json() as { projectId: string; page: number; x: number; y: number };

      if (!projectId) return json({ error: 'projectId required' }, 400);

      const config = await getProjectConfig(projectId);
      if (!config) return json({ error: 'Project not found' }, 404);

      // Find synctex.gz file
      const sectionsDir = config.sectionsDir;

      const findSynctex = (dir: string): string | null => {
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isFile() && (entry.name.endsWith('.synctex.gz') || entry.name.endsWith('.synctex'))) {
              return full;
            }
            if (entry.isDirectory()) {
              const found = findSynctex(full);
              if (found) return found;
            }
          }
        } catch { /* ignore */ }
        return null;
      };

      const synctexPath = findSynctex(sectionsDir);
      if (!synctexPath) {
        return json({ error: 'SyncTeX file not found. Please compile with synctex enabled.' }, 404);
      }

      const synctexData = parseSynctex(synctexPath);
      if (!synctexData) {
        return json({ error: 'Failed to parse SyncTeX file' }, 500);
      }

      const result = pdfToSource(synctexData, page, x, y);
      if (!result) {
        return json({ error: 'Could not find source location' }, 404);
      }

      return json(result);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },

  "POST:/api/latex/forward-synctex": async (req) => {
    try {
      const { parseSynctex, sourceToPdf, getSynctexPath } = await import('./synctex');
      const { projectId, file, line } = await req.json() as { projectId: string; file: string; line: number };

      if (!projectId) return json({ error: 'projectId required' }, 400);

      const config = await getProjectConfig(projectId);
      if (!config) return json({ error: 'Project not found' }, 404);

      const sectionsDir = config.sectionsDir;

      // Helper to find synctex file recursively
      const findSynctex = (dir: string): string | null => {
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isFile() && (entry.name.endsWith('.synctex.gz') || entry.name.endsWith('.synctex'))) {
              return full;
            }
            if (entry.isDirectory()) {
              const found = findSynctex(full);
              if (found) return found;
            }
          }
        } catch { /* ignore */ }
        return null;
      };

      const synctexPath = findSynctex(sectionsDir);
      if (!synctexPath) {
        return json({ error: 'SyncTeX file not found' }, 404);
      }

      const synctexData = parseSynctex(synctexPath);
      if (!synctexData) {
        return json({ error: 'Failed to parse SyncTeX file' }, 500);
      }

      // Forward search: Source -> PDF
      const result = sourceToPdf(synctexData, file, line);

      if (!result) {
        return json({ error: 'Could not find PDF location' }, 404);
      }

      return json(result);
    } catch (error) {
      console.error("Forward SyncTeX error:", error);
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
const appFetch = async (req: Request) => {
  const url = new URL(req.url);

  // API routes
  if (url.pathname.startsWith("/api/")) {
    // Special handling for /api/files/ since the path can contain slashes
    if (url.pathname.startsWith("/api/files/")) {
      const encodedPath = url.pathname.substring("/api/files/".length);
      const filePath = decodeURIComponent(encodedPath);
      const projectId = url.searchParams.get("projectId");

      if (!filePath) {
        return json({ error: "File path required" }, 400);
      }

      if (req.method === "GET") {
        // Read file content
        if (!existsSync(filePath)) {
          return json({ error: "File not found" }, 404);
        }

        // Raw binary mode: serve file as-is (for images, PDFs, etc.)
        if (url.searchParams.get("raw") === "true") {
          const data = readFileSync(filePath);
          const ext = filePath.split('.').pop()?.toLowerCase() || '';
          const mimeTypes: Record<string, string> = {
            'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'gif': 'image/gif', 'svg': 'image/svg+xml', 'pdf': 'application/pdf',
            'eps': 'application/postscript', 'bmp': 'image/bmp',
          };
          return new Response(data, {
            headers: {
              'Content-Type': mimeTypes[ext] || 'application/octet-stream',
              'Content-Length': String(data.length),
            }
          });
        }

        try {
          const content = readFileSync(filePath, "utf-8");

          // Also parse sections for the file
          const lines = content.split('\n');
          const sections: { id: string; level: number; title: string; lineStart: number }[] = [];
          const sectionRegex = /\\section\*?\s*\{([^}]*)\}/;
          const subsectionRegex = /\\subsection\*?\s*\{([^}]*)\}/;

          lines.forEach((line, index) => {
            let match: RegExpExecArray | null = null;
            let level = 0;

            if ((match = sectionRegex.exec(line)) !== null) {
              level = 1;
            } else if ((match = subsectionRegex.exec(line)) !== null) {
              level = 2;
            }

            if (match && level > 0) {
              sections.push({
                id: `section_${sections.length}`,
                level,
                title: (match[1] || '').trim(),
                lineStart: index + 1
              });
            }
          });

          return json({ content, sections });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 500);
        }
      } else if (req.method === "POST") {
        // Write file content with optional backup
        try {
          const body = await req.json() as { content: string; createBackup?: boolean };

          if (!body.content && body.content !== "") {
            return json({ error: "Content is required" }, 400);
          }

          // Create backup if requested and file exists
          if (body.createBackup && existsSync(filePath) && projectId) {
            const config = await getProjectConfig(projectId);
            if (config) {
              const backupsDir = config.backupsDir;
              if (!existsSync(backupsDir)) {
                mkdirSync(backupsDir, { recursive: true });
              }

              const filename = basename(filePath);
              // Fix: Remove dots from timestamp to avoid double dots in filename
              const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").substring(0, 15);
              const backupPath = join(backupsDir, `${filename}.${timestamp}.bak`);

              const originalContent = readFileSync(filePath, "utf-8");
              writeFileSync(backupPath, originalContent, "utf-8");
            }
          }

          // Write new content
          writeFileSync(filePath, body.content, "utf-8");

          return json({ success: true });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 500);
        }
      } else if (req.method === "DELETE") {
        // Delete file from project
        if (!existsSync(filePath)) {
          return json({ error: "File not found" }, 404);
        }

        // Safety: ensure the file is within a project directory
        if (projectId) {
          const config = await getProjectConfig(projectId);
          if (config && !filePath.startsWith(config.sectionsDir)) {
            return json({ error: "Cannot delete files outside project directory" }, 403);
          }
        }

        try {
          unlinkSync(filePath);
          return json({ success: true });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 500);
        }
      } else if (req.method === "PATCH") {
        // Rename file
        try {
          const body = await req.json() as { newName: string };
          if (!body.newName) return json({ error: "newName is required" }, 400);
          if (!existsSync(filePath)) return json({ error: "File not found" }, 404);

          const dir = dirname(filePath);
          const newPath = join(dir, body.newName);
          if (existsSync(newPath)) return json({ error: "A file with that name already exists" }, 409);

          renameSync(filePath, newPath);
          return json({ success: true, newPath });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 500);
        }
      }

      return json({ error: "Method not allowed" }, 405);
    }

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
};

// COOP/COEP headers required for SharedArrayBuffer (Siglum WASM LaTeX compiler)
const CROSS_ORIGIN_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Wrap appFetch to inject cross-origin isolation headers into every response
const appFetchWithHeaders = async (req: Request) => {
  const response = await appFetch(req);
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CROSS_ORIGIN_HEADERS)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
};

// Start server with automatic port selection
async function startServer(startPort: number) {
  let port = startPort;
  const maxRetries = 10;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const server = Bun.serve({
        port,
        fetch: appFetchWithHeaders,
      });

      console.log(`FastWrite running at http://localhost:${server.port}`);
      return server;
    } catch (err: any) {
      if (err.name === 'EADDRINUSE' || err.code === 'EADDRINUSE') {
        console.log(`Port ${port} is occupied, trying ${port + 1}...`);
        port++;
      } else {
        throw err;
      }
    }
  }

  console.error(`Could not find an available port after ${maxRetries} attempts.`);
  process.exit(1);
}

startServer(PORT);
