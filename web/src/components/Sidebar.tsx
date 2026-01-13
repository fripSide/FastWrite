import React, { useState, useEffect } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, FileText, Plus, Trash2, ChevronLeft, Settings } from 'lucide-react';
import type { Project, FileNode, SelectedProject, SectionNode } from '../types';
import { api } from '../api';

interface SidebarProps {
  projects: Project[];
  selectedProject: SelectedProject | null;
  onProjectSelect: (project: SelectedProject | null) => void;
  onImportClick: () => void;
  onFileSelect?: (file: FileNode) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  projects,
  selectedProject,
  onProjectSelect,
  onImportClick,
  onFileSelect,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [sections, setSections] = useState<SectionNode[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<FileNode[]>([]);
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [editingSystemPrompt, setEditingSystemPrompt] = useState(false);

  const loadSystemPrompt = async () => {
    if (!selectedProject) return;
    try {
      const content = await api.getSystemPrompt(selectedProject.project.id);
      setSystemPrompt(content);
    } catch (error) {
      console.error('Failed to load system prompt:', error);
    }
  };

  const saveSystemPrompt = async () => {
    if (!selectedProject) return;
    try {
      const success = await api.saveSystemPrompt(selectedProject.project.id, systemPrompt);
      if (success) {
        setEditingSystemPrompt(false);
      }
    } catch (error) {
      console.error('Failed to save system prompt:', error);
    }
  };

  useEffect(() => {
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
      
      loadSystemPrompt();
    } else {
      setFiles([]);
      setSections([]);
      setSystemPrompt('');
    }
  }, [selectedProject?.project?.id]);

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

  const toggleSection = (sectionId: string): void => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

  const handleFileClick = async (file: FileNode, projectId: string): Promise<void> => {
    if (selectedProject?.project.id === projectId) {
      try {
        const response = await fetch(`/api/files/${encodeURIComponent(file.path)}?projectId=${projectId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.sections) {
            setSections(data.sections);
          }
        }
      } catch (error) {
        console.error('Failed to load file:', error);
      }
    }
  };

  const handleDeleteProject = async (projectId: string): Promise<void> => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      if (response.ok) {
        onProjectSelect(null);
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
          className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-100 rounded-md ${
            selectedProject?.activeFileId === node.id ? 'bg-blue-100' : ''
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
              {expandedFolders.has(node.id) ? (
                <ChevronDown size={14} className="text-slate-500" />
              ) : (
                <ChevronRight size={14} className="text-slate-500" />
              )}
              <Folder size={16} className="text-blue-500" />
            </>
          ) : (
            <>
              <span className="w-4" />
              <FileText size={16} className={node.isLaTeX ? 'text-blue-500' : 'text-slate-500'} />
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
    <div className="w-full h-full flex flex-col bg-slate-50">
      <div className="border-b border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <FolderOpen size={18} className="text-blue-500" />
            Papers
          </h2>
          <button
            onClick={onImportClick}
            className="flex items-center gap-2 px-3 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors"
          >
            <Plus size={16} />
            <span>Import Paper</span>
          </button>
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
                    className="rounded-lg border-2 border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50 transition-all cursor-pointer"
                  >
                    <div className="flex items-start p-3">
                      <div className="flex items-center gap-3">
                        <FolderOpen size={20} className="text-slate-500" />
                        <div>
                          <p className="font-semibold text-slate-800">{project.name}</p>
                          <p className="text-xs text-slate-600 mt-1">
                            {project.localPath}
                          </p>
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
            <button
              onClick={() => onProjectSelect(null)}
              className="flex items-center gap-2 text-sm text-slate-600 hover:text-blue-500 mb-2 px-2"
            >
              <ChevronLeft size={16} />
              Back to Projects
            </button>
            
            <div className="space-y-2 mb-4">
              <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-3">
                <div className="flex items-center gap-3">
                  <FolderOpen size={20} className="text-blue-500" />
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800">{selectedProject.project.name}</p>
                    <p className="text-xs text-slate-600 mt-1">{selectedProject.project.localPath}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(selectedProject.project.id);
                    }}
                    className="p-1 hover:bg-red-100 rounded transition-colors text-red-500"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <button
                onClick={() => setEditingSystemPrompt(!editingSystemPrompt)}
                className="flex items-center gap-2 text-sm text-slate-600 hover:text-blue-500 px-2 py-1 w-full"
              >
                <Settings size={16} />
                <span>System Prompt Configuration</span>
                {editingSystemPrompt ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              
              {editingSystemPrompt && (
                <div className="mt-2 p-3 bg-slate-100 rounded-lg">
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Configure AI behavior for this project..."
                    className="w-full p-2 text-sm border border-slate-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    rows={4}
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={saveSystemPrompt}
                      className="flex-1 px-3 py-1.5 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        loadSystemPrompt();
                        setEditingSystemPrompt(false);
                      }}
                      className="px-3 py-1.5 bg-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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

      {sections.length > 0 && selectedProject && (
        <div className="border-t border-slate-200 pt-2">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider px-4 py-2 bg-slate-100">
            Document Outline
          </h3>
          <div className="space-y-1">
            {sections.map(section => (
              <div
                key={section.id}
                className={`p-3 border-l-4 ${
                  expandedSections.has(section.id) ? 'border-blue-200' : 'border-transparent'
                }`}
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
      )}
    </div>
  );
};

export default Sidebar;
