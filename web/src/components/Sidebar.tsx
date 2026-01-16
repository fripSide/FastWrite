import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, FileText, Plus, Trash2, Settings, RefreshCw } from 'lucide-react';
import type { Project, FileNode, SelectedProject, SectionNode } from '../types';
import { api } from '../api';
import SystemPromptModal from './SystemPromptModal';

interface SidebarProps {
  projects: Project[];
  selectedProject: SelectedProject | null;
  onProjectSelect: (project: SelectedProject | null) => void;
  onImportClick: () => void;
  onFileSelect?: (file: FileNode) => void;
  onProjectDelete?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  projects,
  selectedProject,
  onProjectSelect,
  onImportClick,
  onFileSelect,
  onProjectDelete,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [sections, setSections] = useState<SectionNode[]>([]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [showSystemPromptModal, setShowSystemPromptModal] = useState(false);

  // Sidebar Resize Logic
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const startResizing = useCallback(() => {
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        // Limit width between 200px and 600px
        const newWidth = Math.max(200, Math.min(mouseMoveEvent.clientX, 600));
        setSidebarWidth(newWidth);
      }
    },
    [isResizing]
  );

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  const refreshProjectFiles = useCallback(() => {
    if (selectedProject?.project) {
      fetch(`/api/projects/${selectedProject.project.id}/config`)
        .then(r => r.ok ? r.json() : null)
        .then(config => {
          if (config?.sectionsDir) {
            parseLaTeXOutline(config.sectionsDir);
          }
        });

      fetch(`/api/projects/${selectedProject.project.id}/files`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.files) {
            setFiles(data.files);
          }
        });
    } else {
      setFiles([]);
      setSections([]);
    }
  }, [selectedProject?.project?.id]);

  useEffect(() => {
    refreshProjectFiles();
  }, [refreshProjectFiles]);

  const parseLaTeXOutline = async (sectionsDir: string): Promise<void> => {
    try {
      const candidates = ['main.tex', 'paper.tex', 'document.tex'];
      for (const f of candidates) {
        const filePath = `${sectionsDir}/${f}`;
        const sections = await api.parseSections(filePath);
        if (sections.length > 0) {
          setSections(sections);
          break;
        }
      }
    } catch (error) {
      console.error('Failed to parse LaTeX outline:', error);
    }
  };

  const toggleFolder = (folderId: string): void => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  const handleDeleteProject = async (projectId: string): Promise<void> => {
    const project = projects.find(p => p.id === projectId);
    const projectName = project?.name || 'this project';

    if (!confirm(`Are you sure you want to delete "${projectName}"? This will remove it from FastWrite (files on disk will not be deleted).`)) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      if (response.ok) {
        onProjectSelect(null);
        onProjectDelete?.();
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const handleFileSelect = (file: FileNode): void => {
    onFileSelect?.(file);
  };

  const renderFileTree = (nodes: FileNode[], level: number = 0): React.ReactNode => {
    return nodes.map(node => (
      <div key={node.id}>
        <div
          className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-100 rounded-md ${selectedProject?.activeFileId === node.id ? 'bg-blue-100' : ''
            }`}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onClick={() => {
            if (node.type === 'folder') {
              toggleFolder(node.id);
            } else {
              handleFileSelect(node);
            }
          }}
        >
          {node.type === 'folder' ? (
            <>
              <span className="w-3.5 flex items-center justify-center shrink-0">
                {expandedFolders.has(node.id) ? (
                  <ChevronDown size={14} className="text-slate-500" />
                ) : (
                  <ChevronRight size={14} className="text-slate-500" />
                )}
              </span>
              <Folder size={16} className="text-blue-500 shrink-0" />
            </>
          ) : (
            <>
              <span className="w-3.5 shrink-0" />
              <FileText size={16} className={`shrink-0 ${node.isLaTeX ? 'text-blue-500' : 'text-slate-500'}`} />
            </>
          )}
          <span className="text-sm text-slate-700 truncate">{node.name}</span>
        </div>
        {node.type === 'folder' && expandedFolders.has(node.id) && node.children && (
          <>{renderFileTree(node.children, level + 1)}</>
        )}
      </div>
    ));
  };

  return (
    <>
      <div
        ref={sidebarRef}
        className="h-full w-full flex flex-col bg-slate-50 border-r border-slate-200 overflow-hidden"
      >
        <div className="border-b border-slate-200 bg-white shadow-sm shrink-0 h-10 flex items-center">
          <div className="flex items-center justify-between px-3 w-full">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <FolderOpen size={16} className="text-blue-500" />
              Papers
            </h2>
            <div className="flex gap-1">
              <button
                onClick={refreshProjectFiles}
                className="p-1.5 text-slate-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                title="Refresh Files"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={onImportClick}
                className="p-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                title="Import Paper"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!selectedProject ? (
            <div className="p-2">
              {projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-500">
                  <div className="text-center">
                    <FileText size={48} className="mx-auto mb-4 text-slate-400" />
                    <p className="text-sm">No papers imported yet</p>
                    <button
                      onClick={onImportClick}
                      className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                    >
                      Import Your First Paper
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {projects.map(project => (
                    <div
                      key={project.id}
                      onClick={() => onProjectSelect({ project, activeFileId: undefined })}
                      className="rounded-lg border-2 border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50 transition-all cursor-pointer group relative"
                      title={project.localPath}
                    >
                      <div className="flex items-start p-3">
                        <div className="flex items-center gap-3">
                          <FolderOpen size={20} className="text-slate-500" />
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-800 truncate">{project.name}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-2">


              <div className="space-y-2 mb-4">
                <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-3 flex items-center justify-between" title={selectedProject.project.localPath}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <FolderOpen size={20} className="text-blue-500 flex-shrink-0" />
                    <p className="font-semibold text-slate-800 truncate">{selectedProject.project.name}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(selectedProject.project.id);
                    }}
                    className="p-1 hover:bg-red-100 rounded transition-colors text-red-500 flex-shrink-0"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="mb-4">
                <button
                  onClick={() => setShowSystemPromptModal(true)}
                  className="flex items-center gap-2 text-sm text-slate-600 hover:text-blue-500 hover:bg-slate-100 px-3 py-2 rounded-lg w-full transition-colors"
                >
                  <Settings size={16} />
                  <span>System Prompt</span>
                  <ChevronRight size={14} className="ml-auto" />
                </button>
              </div>

              {files.length > 0 ? (
                <div className="space-y-1">
                  {renderFileTree(files)}
                </div>
              ) : (
                <div className="text-center text-slate-500 py-8">
                  <FileText size={32} className="mx-auto mb-2 text-slate-400" />
                  <p className="text-sm">No .tex files found</p>
                </div>
              )}
            </div>
          )}
        </div>

        {
          sections.length > 0 && selectedProject && (
            <div className="border-t border-slate-200 pt-2">
              <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider px-4 py-2 bg-slate-100">
                Document Outline
              </h3>
              <div className="space-y-1">
                {sections.map(section => (
                  <div
                    key={section.id}
                    className="p-3 border-l-4 border-transparent"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-sm font-medium text-slate-800">
                        {section.level === 1 && <span className="ml-1">§</span>}
                        {section.title}
                      </span>
                      <span className="text-xs text-slate-500 ml-auto">
                        Line {section.lineStart}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        }
      </div >

      {/* System Prompt Modal */}
      {
        selectedProject && (
          <SystemPromptModal
            isOpen={showSystemPromptModal}
            projectId={selectedProject.project.id}
            onClose={() => setShowSystemPromptModal(false)}
          />
        )
      }
    </>
  );
};

export default Sidebar;
