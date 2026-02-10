import React, { useState, useEffect } from 'react';
import { FolderOpen, X, FileText, Loader2, Github, AlertCircle } from 'lucide-react';
import type { Project, FileNode } from '../types';
import { api } from '../api';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (project: Project) => void;
  existingProjects?: Project[];
}

interface DirectoryPreview {
  name: string;
  files: FileNode[];
}

interface DuplicateInfo {
  project: Project;
  message: string;
}

const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, onImportComplete, existingProjects = [] }) => {
  const [directoryPath, setDirectoryPath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [preview, setPreview] = useState<DirectoryPreview | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'input' | 'preview' | 'importing'>('input');
  const [importType, setImportType] = useState<'local' | 'github'>('local');
  const [githubUrl, setGithubUrl] = useState('');
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const [githubBranch, setGithubBranch] = useState('main');

  // Helper to extract name from path
  const extractNameFromPath = (path: string): string => {
    const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
    return parts[parts.length - 1] || 'New Project';
  };

  // Check for duplicate project by path
  const checkForDuplicate = (path: string): DuplicateInfo | null => {
    const normalizedPath = path.replace(/\/+$/, '');
    const existing = existingProjects.find(
      p => p.localPath.replace(/\/+$/, '') === normalizedPath
    );
    if (existing) {
      return {
        project: existing,
        message: `Project "${existing.name}" already exists at this path. Importing will activate the existing project.`
      };
    }
    return null;
  };

  // Auto-set project name when directory path changes
  useEffect(() => {
    if (directoryPath) {
      const name = extractNameFromPath(directoryPath);
      setProjectName(name);
      setDuplicateInfo(checkForDuplicate(directoryPath));
    } else {
      setProjectName('');
      setDuplicateInfo(null);
    }
  }, [directoryPath, existingProjects]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isImporting && !isAnalyzing) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isImporting, isAnalyzing]);

  const handleBrowse = async () => {
    try {
      const response = await fetch('/api/utils/browse-directory', {
        method: 'POST'
      });
      const data = await response.json();
      if (data.path) {
        setDirectoryPath(data.path);
        setError(null);
      }
    } catch (err) {
      console.error('Failed to open directory picker:', err);
    }
  };

  const handleAnalyze = async () => {
    if (!directoryPath.trim()) {
      setError('Please enter a directory path');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch('/api/projects/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: directoryPath })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to analyze directory');
      }

      const data = await response.json();
      setPreview({
        name: directoryPath,
        files: data.files || []
      });
      setStage('preview');
      if (!projectName) {
        const pathParts = directoryPath.split('/').filter(Boolean);
        setProjectName(pathParts[pathParts.length - 1] || 'New Project');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleImport = async () => {
    if (!projectName.trim()) {
      setError('Please enter a project name');
      return;
    }

    setIsImporting(true);
    setError(null);
    setStage('importing');

    try {
      let result: Project | null = null;

      if (importType === 'local') {
        result = await api.importLocalProject(directoryPath, projectName);
      } else if (importType === 'github') {
        if (!githubUrl.trim()) {
          setError('Please enter a GitHub URL');
          return;
        }

        const githubResult = await api.importGitHubProject(githubUrl, githubBranch);
        if (githubResult?.success) {
          result = await api.importLocalProject(githubResult.path, githubResult.name);
          setProjectName(githubResult.name);
        }
      }

      if (result) {
        onImportComplete(result);
        onClose();
        setDirectoryPath('');
        setProjectName('');
        setGithubUrl('');
        setGithubBranch('main');
        setPreview(null);
        setStage('input');
        setDuplicateInfo(null);
      } else {
        setError('Failed to import project');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import project');
    } finally {
      setIsImporting(false);
    }
  };

  const renderFileTree = (files: FileNode[], level = 0): React.ReactNode => {
    return files.map(file => (
      <div key={file.id} className={`ml-${level * 4} py-1 flex items-center gap-2 text-sm`}>
        {file.type === 'folder' ? (
          <FolderOpen size={16} className="text-amber-500" />
        ) : (
          <FileText size={16} className={file.isLaTeX ? "text-orange-500" : "text-gray-400"} />
        )}
        <span className={file.isLaTeX ? "font-medium" : ""}>{file.name}</span>
      </div>
    ));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800">Open Local LaTeX Project</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded transition-colors"
            disabled={isImporting}
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {stage === 'input' && (
            <div className="space-y-4">
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setImportType('local')}
                  className={`flex-1 px-4 py-2 border-2 rounded-lg font-medium transition-colors ${importType === 'local'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
                    }`}
                >
                  <FolderOpen size={18} className="mr-2" />
                  Local Directory
                </button>
                <button
                  onClick={() => setImportType('github')}
                  className={`flex-1 px-4 py-2 border-2 rounded-lg font-medium transition-colors ${importType === 'github'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
                    }`}
                >
                  <Github size={18} className="mr-2" />
                  GitHub Repository
                </button>
              </div>

              {importType === 'github' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      GitHub Repository URL
                    </label>
                    <input
                      type="text"
                      value={githubUrl}
                      onChange={(e) => {
                        setGithubUrl(e.target.value);
                        setError(null);
                      }}
                      placeholder="https://github.com/owner/repo"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={isAnalyzing}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Example: https://github.com/username/repository
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Branch (optional)
                    </label>
                    <input
                      type="text"
                      value={githubBranch}
                      onChange={(e) => setGithubBranch(e.target.value)}
                      placeholder="main"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={isAnalyzing}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Local Directory Path
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={directoryPath}
                    onChange={(e) => {
                      setDirectoryPath(e.target.value);
                      setError(null);
                    }}
                    placeholder="/Users/username/documents/my-latex-paper"
                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={isAnalyzing}
                  />
                  <button
                    onClick={handleBrowse}
                    disabled={isAnalyzing}
                    className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2 text-slate-700"
                  >
                    <FolderOpen size={18} />
                    Browse...
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Select the LaTeX project directory using the system file browser. Project will be opened in-place.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Project Name
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="My Academic Paper"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isAnalyzing}
                />
              </div>

              {duplicateInfo && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm flex items-start gap-2">
                  <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Existing Project Detected</p>
                    <p className="mt-1">{duplicateInfo.message}</p>
                  </div>
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                  disabled={isAnalyzing}
                >
                  Cancel
                </button>
                {duplicateInfo ? (
                  <button
                    onClick={() => {
                      // Directly import the existing project (activates it)
                      handleImport();
                    }}
                    disabled={isImporting}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isImporting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Activating...
                      </>
                    ) : (
                      'Use Existing Project'
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing || !directoryPath.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      'Analyze'
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {stage === 'preview' && preview && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Detected Project Structure</h3>
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 max-h-64 overflow-y-auto">
                  {preview.files.length > 0 ? (
                    renderFileTree(preview.files)
                  ) : (
                    <p className="text-sm text-slate-500">No LaTeX files detected</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Project Name
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isImporting}
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setStage('input');
                    setPreview(null);
                    setError(null);
                  }}
                  className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                  disabled={isImporting}
                >
                  Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={isImporting || !projectName.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isImporting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Opening...
                    </>
                  ) : (
                    'Open Project'
                  )}
                </button>
              </div>
            </div>
          )}

          {stage === 'importing' && (
            <div className="text-center py-8">
              <Loader2 size={48} className="animate-spin text-blue-600 mx-auto mb-4" />
              <p className="text-lg font-medium text-slate-700">Opening project...</p>
              <p className="text-sm text-slate-500 mt-2">Please wait while we set up your project</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImportModal;
