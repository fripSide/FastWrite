import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { ChevronDown, ChevronRight, FileText, Clock, FolderOpen, Check, Loader2 } from 'lucide-react';
import type { SelectedFile, SelectedProject, ViewMode, TextItem, DiffResult, AIMode } from '../types';
import { parseContent } from '../utils/parser';
import AIEditorPanel from './AIEditorPanel';
import BackupTimeline from './BackupTimeline';
import { api } from '../api';

export interface MainEditorRef {
  getCurrentLine: () => number;
  getSelectedLineCount: () => number;
}

interface MainEditorProps {
  selectedFile: SelectedFile | null;
  selectedProject: SelectedProject | null;
  scrollToLine?: number | null;
  onSyncToPDF?: (page: number, x: number, y: number) => void;
}

const MainEditor = forwardRef<MainEditorRef, MainEditorProps>(({ selectedFile, selectedProject, scrollToLine, onSyncToPDF }, ref) => {
  const [viewMode, setViewMode] = useState<ViewMode>('section');
  const [items, setItems] = useState<TextItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<TextItem | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [showBackupTimeline, setShowBackupTimeline] = useState(false);
  const [currentContent, setCurrentContent] = useState<string>('');
  const [isAIPanelFullscreen, setIsAIPanelFullscreen] = useState(false);

  const editorContainerRef = useRef<HTMLDivElement>(null);

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

  // Expose current line and line count for external sync triggering
  useImperativeHandle(ref, () => ({
    getCurrentLine: () => {
      // 1. If an item is selected, use its line
      if (selectedItem?.lineStart) {
        return selectedItem.lineStart;
      }

      // 2. If valid items exist, try to find the first visible one
      // (Simplified: just return the first item's line or 1 for now)
      if (items.length > 0) {
        // Ideally we check which item is in viewport, but for now defaulting to top or first item
        // If user hasn't selected anything, they are likely reading from top or just scrolled.
        // A better heuristic might be needed later (IntersectionObserver on text items).
        return items[0]?.lineStart || 1;
      }

      return 1;
    },
    getSelectedLineCount: () => {
      // Count lines in selected item content
      if (selectedItem?.content) {
        return selectedItem.content.split('\n').length;
      }
      return 1; // Default to 1 line
    }
  }));

  // Handle scroll to line from PDF sync - also select the item
  useEffect(() => {
    if (scrollToLine && items.length > 0) {
      const flatItems = flattenItems(items);
      // Find the item containing this line (reversed to find closest match)
      const targetItem = [...flatItems].reverse().find(item => {
        if (item.lineStart) {
          return item.lineStart <= scrollToLine;
        }
        return false;
      });

      if (targetItem) {
        // Expand parent section if collapsed
        if (targetItem.parentId) {
          setExpandedSections(prev => new Set([...prev, targetItem.parentId!]));
        }

        // Select the item (focus it)
        setSelectedItem(targetItem);

        // Scroll into view (no extra ring highlight needed - selection already highlights)
        setTimeout(() => {
          const el = document.getElementById(`item-${targetItem.id}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);
      }
    }
  }, [scrollToLine, items]);

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

  const handleSyncToPDF = async (item: TextItem) => {
    if (!selectedProject || !selectedFile || !onSyncToPDF) return;

    // Check if lineStart exists on item
    const line = item.lineStart || 1;

    try {
      const response = await fetch('/api/latex/forward-synctex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProject.project.id,
          file: selectedFile.path,
          line: line
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.page) {
          onSyncToPDF(result.page, result.x, result.y);
        }
      }
    } catch (error) {
      console.error('SyncTeX forward search failed:', error);
    }
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

    const fullContent = updatedItems.map(i => i.content).join('\n');
    scheduleSave(fullContent);
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

  const handleRestoreBackup = (backupContent: string): void => {
    setCurrentContent(backupContent);
    const parsed = parseContent(backupContent, viewMode);
    setItems(parsed);
    setShowBackupTimeline(false);
  };

  const renderItem = (item: TextItem, level = 0): React.ReactNode => {
    const isSelected = selectedItem?.id === item.id;
    const isExpanded = expandedSections.has(item.id);
    const hasChildren = item.children && item.children.length > 0;

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
            editorRef={editorContainerRef}
          />
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
      {/* Top Bar */}
      <div className="px-4 py-2 border-b border-slate-200 bg-white shadow-sm h-10 flex items-center shrink-0">
        <div className="flex items-center justify-between w-full">
          {selectedFile ? (
            <div className="flex items-center gap-3">
              <FileText size={16} className="text-orange-500" />
              <h2 className="text-sm font-semibold text-slate-800">{selectedFile.name}</h2>
              {/* Save Status Indicator */}
              {saveStatus === 'saving' && (
                <span className="flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                  <Loader2 size={10} className="animate-spin" />
                  Saving...
                </span>
              )}
              {saveStatus === 'saved' && (
                <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                  <Check size={10} />
                  Saved
                </span>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-500 italic">No file selected</div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBackupTimeline(true)}
              className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded transition-colors"
              title="View backup history"
            >
              <Clock size={14} />
              Backups
            </button>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('section')}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${viewMode === 'section'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-800'
                  }`}
              >
                Section
              </button>
              <button
                onClick={() => setViewMode('paragraph')}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${viewMode === 'paragraph'
                  ? 'bg-white text-green-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-800'
                  }`}
              >
                Paragraph
              </button>
              <button
                onClick={() => setViewMode('sentence')}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${viewMode === 'sentence'
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

      {/* Content Area - dynamic height when AI panel is open */}
      <div
        ref={editorContainerRef}
        className="flex-1 overflow-y-auto p-6 relative"
      >
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
          currentContent={currentContent}
          onClose={() => setShowBackupTimeline(false)}
          onRestore={handleRestoreBackup}
        />
      )}
    </div>
  );
}); // Close component body

export default MainEditor;
