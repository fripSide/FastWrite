import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight, FileText, Clock, FolderOpen, Check, Loader2 } from 'lucide-react';
import type { SelectedFile, SelectedProject, ViewMode, TextItem, DiffResult, AIMode } from '../types';
import { parseContent } from '../utils/parser';
import AIEditorPanel from './AIEditorPanel';
import BackupTimeline from './BackupTimeline';
import { api } from '../api';

interface MainEditorProps {
  selectedFile: SelectedFile | null;
  selectedProject: SelectedProject | null;
}

const MainEditor: React.FC<MainEditorProps> = ({ selectedFile, selectedProject }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('section');
  const [items, setItems] = useState<TextItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<TextItem | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [showBackupTimeline, setShowBackupTimeline] = useState(false);
  const [currentContent, setCurrentContent] = useState<string>('');
  const [isAIPanelFullscreen, setIsAIPanelFullscreen] = useState(false);

  // Auto-save state
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingContentRef = useRef<string>('');

  // Debounced save function
  const debouncedSave = useCallback(async () => {
    if (!selectedFile || !selectedProject) return;

    setSaveStatus('saving');
    try {
      await api.writeFile(
        selectedFile.path,
        pendingContentRef.current,
        selectedProject.project.id,
        true
      );
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Auto-save failed:', error);
      setSaveStatus('idle');
    }
  }, [selectedFile, selectedProject]);

  // Schedule save after content change
  const scheduleSave = useCallback((newContent: string) => {
    pendingContentRef.current = newContent;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(debouncedSave, 3000);
  }, [debouncedSave]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Auto-scroll selected item to bottom of view
  useEffect(() => {
    if (selectedItem) {
      // Small timeout to allow layout to adjust
      setTimeout(() => {
        const el = document.getElementById(`item-${selectedItem.id}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [selectedItem?.id]);

  useEffect(() => {
    if (selectedFile?.content) {
      const parsed = parseContent(selectedFile.content, viewMode);
      setItems(parsed);
      setSelectedItem(null);
      setCurrentContent(selectedFile.content);
      pendingContentRef.current = selectedFile.content;
    }
  }, [selectedFile, viewMode]);

  const toggleSection = (itemId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleItemClick = (item: TextItem) => {
    setSelectedItem(item);
  };

  const handleContentUpdate = (itemId: string, newContent: string) => {
    const updateContent = (items: TextItem[]): TextItem[] => {
      return items.map(i => {
        if (i.id === itemId) {
          return { ...i, content: newContent };
        }
        if (i.children) {
          return { ...i, children: updateContent(i.children) };
        }
        return i;
      });
    };
    const updatedItems = updateContent(items);
    setItems(updatedItems);
    setSelectedItem(prev => prev?.id === itemId ? { ...prev, content: newContent } : prev);

    // Compute full file content and schedule auto-save
    const fullContent = updatedItems.map(i => i.content).join('\n');
    scheduleSave(fullContent);
  };

  const handleAIResult = (result: DiffResult, modifiedContent: string, mode: AIMode) => {
    if (!modifiedContent) return;

    const updateItemContent = (items: TextItem[], itemId: string, newContent: string): TextItem[] => {
      return items.map(i => {
        if (i.id === itemId) {
          return { ...i, modifiedContent: newContent, status: 'modified', aiMode: mode, aiTimestamp: new Date().toISOString() };
        }
        if (i.children) {
          return { ...i, children: updateItemContent(i.children, itemId, newContent) };
        }
        return i;
      });
    };

    const updatedItems = updateItemContent(items, result.itemId, modifiedContent);
    setItems(updatedItems);

    const newFileContent = updatedItems.map(i => {
      if (i.id === result.itemId && i.modifiedContent) {
        return i.modifiedContent;
      }
      return i.content;
    }).join('\n');

    handleSaveChanges(newFileContent);
  };

  const renderItem = (item: TextItem, level = 0): React.ReactNode => {
    const isSelected = selectedItem?.id === item.id;
    const isExpanded = expandedSections.has(item.id);
    const hasChildren = item.children && item.children.length > 0;

    // Hide paragraph spacers in sentence/paragraph mode
    if ((viewMode === 'sentence' || viewMode === 'paragraph') && item.content === '') {
      return null;
    }

    if (viewMode === 'section' && hasChildren) {
      return (
        <div key={item.id} id={`item-${item.id}`} className="mb-2">
          <div
            className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors ${isSelected
              ? 'bg-blue-100 border-2 border-blue-500'
              : 'bg-slate-50 border border-slate-200 hover:border-slate-300'
              }`}
            onClick={() => handleItemClick(item)}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSection(item.id);
              }}
              className="p-1 hover:bg-slate-200 rounded"
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  Section {item.level === 1 ? '1' : '2'}
                </span>
                <span className="text-sm font-medium text-slate-700">
                  {item.content.substring(0, 100)}...
                </span>
              </div>
            </div>
          </div>
          {isExpanded && item.children && (
            <div className="ml-8 mt-2">
              {item.children.map(child => renderItem(child, level + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div key={item.id} id={`item-${item.id}`} className="mb-2">
        <div
          onClick={() => handleItemClick(item)}
          className={`p-4 rounded-lg cursor-pointer transition-colors border-2 ${isSelected
            ? 'bg-blue-50 border-blue-500 shadow-md'
            : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
            }`}
        >
          <div className="flex items-start gap-2">
            <div className="flex-1">
              {isSelected ? (
                <textarea
                  id={`edit-textarea-${item.id}`}
                  className="w-full text-sm text-slate-700 whitespace-pre-wrap font-mono bg-transparent border-0 focus:outline-none focus:ring-0 resize-none overflow-y-auto"
                  value={item.content}
                  onChange={(e) => {
                    handleContentUpdate(item.id, e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, window.innerHeight * 0.5) + 'px';
                  }}
                  onClick={(e) => e.stopPropagation()}
                  ref={(el) => {
                    if (el) {
                      el.style.height = 'auto';
                      el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.5) + 'px';
                    }
                  }}
                  style={{ maxHeight: '50vh' }}
                  autoFocus
                />
              ) : (
                <div className="text-sm text-slate-700 whitespace-pre-wrap font-mono">
                  {item.content}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Inline AI Panel */}
        {isSelected && (
          <AIEditorPanel
            isOpen={true}
            selectedItemId={item.id}
            item={item}
            fileContent=""
            projectId={selectedProject?.project.id || ''}
            onClose={() => setSelectedItem(null)}
            onResult={handleAIResult}
            onContentChange={(newContent) => handleContentUpdate(item.id, newContent)}
            onFullscreenChange={setIsAIPanelFullscreen}
          />
        )}
      </div>
    );
  };

  const flattenItems = (items: TextItem[]): TextItem[] => {
    const result: TextItem[] = [];
    for (const item of items) {
      result.push(item);
      if (item.children) {
        result.push(...flattenItems(item.children));
      }
    }
    return result;
  };

  const handleRestoreBackup = (backupContent: string): void => {
    setCurrentContent(backupContent);
    const parsed = parseContent(backupContent, viewMode);
    setItems(parsed);
    setShowBackupTimeline(false);
  };

  const handleSaveChanges = async (newContent: string): Promise<void> => {
    if (!selectedFile || !selectedProject) return;

    try {
      const projectId = selectedProject.project.id;
      const response = await fetch(`/api/files/${encodeURIComponent(selectedFile.path)}?projectId=${encodeURIComponent(projectId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent, createBackup: true }),
      });

      if (response.ok) {
        setCurrentContent(newContent);
        const parsed = parseContent(newContent, viewMode);
        setItems(parsed);
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
      {/* Top Bar */}
      {selectedFile && (
        <div className="px-6 py-4 border-b border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText size={20} className="text-orange-500" />
              <h2 className="text-lg font-semibold text-slate-800">{selectedFile.name}</h2>
              {/* Save Status Indicator */}
              {saveStatus === 'saving' && (
                <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                  <Loader2 size={12} className="animate-spin" />
                  Saving...
                </span>
              )}
              {saveStatus === 'saved' && (
                <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                  <Check size={12} />
                  Saved
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowBackupTimeline(true)}
                className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors"
                title="View backup history"
              >
                <Clock size={16} />
                Backups
              </button>
              <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('section')}
                  className={`px-4 py-2 text-sm font-medium rounded transition-colors ${viewMode === 'section'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                    }`}
                >
                  Section
                </button>
                <button
                  onClick={() => setViewMode('paragraph')}
                  className={`px-4 py-2 text-sm font-medium rounded transition-colors ${viewMode === 'paragraph'
                    ? 'bg-white text-green-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                    }`}
                >
                  Paragraph
                </button>
                <button
                  onClick={() => setViewMode('sentence')}
                  className={`px-4 py-2 text-sm font-medium rounded transition-colors ${viewMode === 'sentence'
                    ? 'bg-white text-purple-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                    }`}
                >
                  Sentence
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content Area - dynamic height when AI panel is open */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedFile ? (
          items.length > 0 ? (
            <div className="max-w-4xl mx-auto pb-4">
              {items.map(item => renderItem(item))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              <div className="text-center">
                <FileText size={48} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm">No content found</p>
              </div>
            </div>
          )
        ) : selectedProject ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            <div className="text-center">
              <FolderOpen size={48} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm mb-2">Select a .tex file from the left panel</p>
              <p className="text-xs text-slate-500">{selectedProject.project.name}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400">
            <div className="text-center">
              <FolderOpen size={48} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm mb-2">Welcome to FastWrite</p>
              <p className="text-xs text-slate-500">Import or select a project to get started</p>
            </div>
          </div>
        )}
      </div>

      {showBackupTimeline && selectedFile && (
        <BackupTimeline
          projectId={selectedProject?.project.id || ''}
          filePath={selectedFile.path}
          fileName={selectedFile.name}
          onClose={() => setShowBackupTimeline(false)}
          onRestore={handleRestoreBackup}
        />
      )}
    </div>
  );
};

export default MainEditor;
