import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, FileText, Plus, Trash2, Settings, RefreshCw, Check } from 'lucide-react';
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
  onSectionClick?: (lineNumber: number, filePath?: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  projects,
  selectedProject,
  onProjectSelect,
  onImportClick,
  onFileSelect,
  onProjectDelete,
  onSectionClick,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [sections, setSections] = useState<SectionNode[]>([]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [showSystemPromptModal, setShowSystemPromptModal] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);
  const [outlineHeight, setOutlineHeight] = useState(200);
  const [isOutlineResizing, setIsOutlineResizing] = useState(false);

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

  // Outline vertical resize handlers
  const startOutlineResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsOutlineResizing(true);
  }, []);

  useEffect(() => {
    const handleOutlineResize = (e: MouseEvent) => {
      if (isOutlineResizing && sidebarRef.current) {
        const rect = sidebarRef.current.getBoundingClientRect();
        const newHeight = rect.bottom - e.clientY;
        setOutlineHeight(Math.max(100, Math.min(newHeight, rect.height - 150)));
      }
    };
    const stopOutlineResizing = () => setIsOutlineResizing(false);

    window.addEventListener('mousemove', handleOutlineResize);
    window.addEventListener('mouseup', stopOutlineResizing);
    return () => {
      window.removeEventListener('mousemove', handleOutlineResize);
      window.removeEventListener('mouseup', stopOutlineResizing);
    };
  }, [isOutlineResizing]);

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
      let mainFile = 'main.tex';
      // Check if there is a config for the current project
      if (selectedProject?.project.id) {
        const config = await api.getProjectConfig(selectedProject.project.id);
        if (config?.mainFile) {
          mainFile = config.mainFile;
        }
      }

      // Prioritize mainFile, then candidates
      const candidates = Array.from(new Set([mainFile, 'main.tex', 'paper.tex', 'document.tex']));
      let foundSections: any[] = [];

      for (const f of candidates) {
        const filePath = `${sectionsDir}/${f}`;
        const sections = await api.parseSections(filePath);
        if (sections.length > 0) {
          foundSections = sections;
          break;
        }
      }

      if (foundSections.length > 0) {
        setSections(buildSectionTree(foundSections));
      } else {
        setSections([]);
      }
    } catch (error) {
      console.error('Failed to parse LaTeX outline:', error);
      setSections([]);
    }
  };

  const buildSectionTree = (flatSections: any[]): SectionNode[] => {
    const root: SectionNode[] = [];
    const stack: { node: SectionNode; level: number }[] = [];

    flatSections.forEach(section => {
      const newNode: SectionNode = {
        id: section.id,
        title: section.title,
        level: section.level,
        line: section.lineStart || 0,
        lineStart: section.lineStart,
        filePath: section.filePath ? section.filePath.replace(/\/\.\//g, '/') : undefined,
        children: []
      };

      // Find parent
      while (stack.length > 0 && stack[stack.length - 1].level >= newNode.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(newNode);
      } else {
        stack[stack.length - 1].node.children.push(newNode);
      }

      stack.push({ node: newNode, level: newNode.level });
    });

    return root;
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

  const [showProjectsDropdown, setShowProjectsDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowProjectsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      <div
        ref={sidebarRef}
        className="h-full w-full flex flex-col bg-slate-50 border-r border-slate-200 overflow-hidden"
      >
        <div className="border-b border-slate-200 bg-white shadow-sm shrink-0 h-10 flex items-center z-20 relative">
          <div className="flex items-center justify-between px-3 w-full">
            <div className="relative flex-1 min-w-0" ref={dropdownRef}>
              <button
                onClick={() => setShowProjectsDropdown(!showProjectsDropdown)}
                className="text-sm font-bold text-slate-800 flex items-center gap-2 hover:bg-slate-100 px-2 py-1 rounded-md transition-colors"
              >
                <FolderOpen size={16} className="text-blue-500" />
                <span>Papers</span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${showProjectsDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showProjectsDropdown && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-30">
                  <div className="max-h-64 overflow-y-auto">
                    {projects.length > 0 ? (
                      projects.map(p => (
                        <button
                          key={p.id}
                          onClick={() => {
                            onProjectSelect({ project: p, files: selectedProject?.files || [] });
                            setShowProjectsDropdown(false);
                          }}
                          className={`w-full text-left px-4 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 ${selectedProject?.project.id === p.id ? 'text-blue-600 bg-blue-50 font-medium' : 'text-slate-700'
                            }`}
                        >
                          <FileText size={14} className={selectedProject?.project.id === p.id ? 'text-blue-500' : 'text-slate-400'} />
                          <span className="truncate">{p.name}</span>
                          {selectedProject?.project.id === p.id && <Check size={14} className="ml-auto text-blue-500" />}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-xs text-slate-400 text-center">No papers found</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-1 items-center shrink-0">


              <button
                onClick={refreshProjectFiles}
                className="p-1.5 text-slate-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors shrink-0"
                title="Refresh Files"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={onImportClick}
                className="p-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors shrink-0"
                title="Open Local Project"
              >
                <FolderOpen size={14} />
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
                      Open Your First Project
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {projects.map(project => (
                    <div
                      key={project.id}
                      onClick={() => onProjectSelect({ project, files: [] })}
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

        {/* Resizable Outline Panel - Always Visible */}
        {selectedProject && (
          <div style={{ height: isOutlineCollapsed ? 'auto' : outlineHeight }} className="flex flex-col border-t border-slate-200 bg-white">
            {/* Drag Handle */}
            {!isOutlineCollapsed && (
              <div
                className="h-1 bg-slate-100 hover:bg-blue-300 cursor-ns-resize flex items-center justify-center group"
                onMouseDown={startOutlineResizing}
              >
                <div className="w-8 h-0.5 bg-slate-300 group-hover:bg-blue-400 rounded-full" />
              </div>
            )}

            {/* Collapsible Header */}
            <button
              onClick={() => setIsOutlineCollapsed(!isOutlineCollapsed)}
              className="flex items-center gap-2 text-xs font-semibold text-slate-600 uppercase tracking-wider px-4 py-2 bg-slate-100 hover:bg-slate-200 transition-colors w-full text-left"
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${isOutlineCollapsed ? '-rotate-90' : ''}`}
              />
              Document Outline
            </button>

            {/* Outline Content */}
            {!isOutlineCollapsed && (
              <div className="flex-1 overflow-y-auto py-1">
                {sections.length > 0 ? (
                  sections.map(section => {
                    const hasChildren = section.children && section.children.length > 0;
                    const isSectionCollapsed = collapsedSections.has(section.id);
                    const toggleCollapse = () => {
                      setCollapsedSections(prev => {
                        const next = new Set(prev);
                        if (next.has(section.id)) {
                          next.delete(section.id);
                        } else {
                          next.add(section.id);
                        }
                        return next;
                      });
                    };

                    return (
                      <div key={section.id}>
                        <div
                          className={`flex items-center gap-1 px-3 py-1.5 hover:bg-slate-100 cursor-pointer ${hasChildren ? '' : 'pl-6'}`}
                          onClick={() => {
                            if (onSectionClick && section.lineStart) {
                              onSectionClick(section.lineStart, section.filePath);
                            }
                          }}
                        >
                          {hasChildren && (
                            <ChevronRight
                              size={14}
                              className={`text-slate-400 transition-transform flex-shrink-0 ${isSectionCollapsed ? '' : 'rotate-90'}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCollapse();
                              }}
                            />
                          )}
                          <span className="text-sm text-slate-800 text-left flex-1">
                            {section.level === 1 && <span className="font-medium">§</span>}
                            {section.title}
                          </span>
                          <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                            L{section.lineStart}
                          </span>
                        </div>
                        {!isSectionCollapsed && hasChildren && (
                          <div className="ml-4">
                            {section.children!.map(child => (
                              <div
                                key={child.id}
                                className="flex items-center gap-1 px-3 py-1 hover:bg-slate-50 cursor-pointer pl-5"
                                onClick={() => {
                                  if (onSectionClick && child.lineStart) {
                                    onSectionClick(child.lineStart, child.filePath);
                                  }
                                }}
                              >
                                <span className="text-sm text-slate-600 text-left flex-1">
                                  {child.title}
                                </span>
                                <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                                  L{child.lineStart}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="px-4 py-3 text-xs text-slate-400 text-center">
                    No outline available
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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
