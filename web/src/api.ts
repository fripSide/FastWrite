import type { Backup, Project } from './types';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function postJson<T>(url: string, data: unknown): Promise<T | null> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export const api = {
  // Projects
  getProjects: () => fetchJson<Project[]>('/api/projects'),

  getProjectConfig: (projectId: string) => fetchJson<import('./types').ProjectConfig>(`/api/projects/${projectId}/config?t=${Date.now()}`),

  saveProjectConfig: (projectId: string, config: Partial<import('./types').ProjectConfig>) =>
    postJson<import('./types').ProjectConfig>(`/api/projects/${projectId}/config`, config),

  importLocalProject: (path: string, name: string, mainFile?: string, copyFiles: boolean = true) =>
    postJson<Project>('/api/projects/import-local', { path, name, mainFile, copyFiles }),

  importGitHubProject: (url: string, branch?: string) =>
    postJson<{ success: boolean; project: Project; path: string; name: string }>('/api/projects/import-github', { url, branch }),

  browseDirectory: () => postJson<{ path: string | null }>('/api/utils/browse-directory', {}),

  // GitHub Settings
  getGitHubSettings: () => fetchJson<{ token: string; hasToken: boolean }>('/api/github/settings'),

  saveGitHubSettings: (token: string) =>
    postJson<{ success: boolean }>('/api/github/settings', { token }),

  // Git Operations
  gitStatus: (projectId: string) =>
    fetchJson<{ isGitRepo: boolean; changes: string[]; branch: string; ahead: number }>(`/api/projects/${projectId}/git-status`),

  gitPush: (projectId: string, message: string) =>
    postJson<{ success: boolean; error?: string }>(`/api/projects/${projectId}/git-push`, { message }),

  // System Prompt
  getSystemPrompt: async (projectId: string) => {
    const data = await fetchJson<{ content: string }>(`/api/system-prompt/${projectId}`);
    return data?.content || '';
  },

  saveSystemPrompt: async (projectId: string, content: string) => {
    const res = await postJson<{ success: boolean }>(`/api/system-prompt/${projectId}`, { content });
    return res?.success || false;
  },

  // Backups
  getBackups: async (projectId: string) =>
    (await fetchJson<Backup[]>(`/api/backups/${projectId}`)) || [],

  deleteBackups: async (projectId: string, filename?: string) => {
    let url = `/api/backups/${projectId}`;
    if (filename) url += `?filename=${encodeURIComponent(filename)}`;
    const res = await fetch(url, { method: 'DELETE' });
    return res.ok;
  },

  // AI
  processAI: (mode: string, content: string, userPrompt?: string) =>
    postJson<{ content: string }>('/api/ai/process', { mode, content, userPrompt }),

  // LaTeX Parsing
  parseSections: async (filePath: string) => {
    const data = await fetchJson<{ sections: Array<{ id: string; level: number; title: string; lineStart: number; filePath: string }> }>(
      `/api/parse-sections?path=${encodeURIComponent(filePath)}`
    );
    return data?.sections || [];
  },

  writeFile: async (filePath: string, content: string, projectId: string, createBackup: boolean = true) => {
    const res = await postJson<{ success: boolean }>(
      `/api/files/${encodeURIComponent(filePath)}?projectId=${encodeURIComponent(projectId)}`,
      { content, createBackup }
    );
    return res?.success || false;
  },

  // LLM Config
  getLLMConfig: () => fetchJson<{ model: string; baseUrl: string; apiKey: string }>('/api/llm-config')
};
