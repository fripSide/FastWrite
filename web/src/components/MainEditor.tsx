import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { FileText, Clock, FolderOpen, Check, Loader2, MessageSquare, Maximize2, Minimize2, Lightbulb, Trash2 } from 'lucide-react';
import type { SelectedFile, SelectedProject, TextItem, DiffResult, AIMode, ChatMessage } from '../types';
import { parseContent, parseParagraphToSentences } from '../utils/parser';
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
  onSaveSuccess?: () => void;
}

const MainEditor = forwardRef<MainEditorRef, MainEditorProps>(({ selectedFile, selectedProject, scrollToLine, onSyncToPDF, onSaveSuccess }, ref) => {
  // Core Data
  const [items, setItems] = useState<TextItem[]>([]);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [focusedItemSentences, setFocusedItemSentences] = useState<TextItem[]>([]);

  // UI State
  const [expandedThoughts, setExpandedThoughts] = useState<Set<string>>(new Set());
  const [showBackupTimeline, setShowBackupTimeline] = useState(false);
  const [currentContent, setCurrentContent] = useState<string>('');
  const [isAIPanelFullscreen, setIsAIPanelFullscreen] = useState(false);

  // Selection for AI
  const [selectedItem, setSelectedItem] = useState<TextItem | null>(null);

  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Auto-save state
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isDirty, setIsDirty] = useState(false);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingContentRef = useRef<string>('');
  const displayedFilePathRef = useRef<string | null>(null);

  // AI Cache Persistence
  const [aiHistories, setAiHistories] = useState<Record<string, ChatMessage[]>>({});
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const aiSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced save for Content
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
      setIsDirty(false);
      setTimeout(() => setSaveStatus('idle'), 2000);
      if (onSaveSuccess) onSaveSuccess();
    } catch (error) {
      console.error('Auto-save failed:', error);
      setSaveStatus('idle');
    }
  }, [selectedFile, selectedProject, onSaveSuccess]);

  // Load AI Cache
  useEffect(() => {
    if (selectedProject?.project.id) {
      setIsHistoryLoaded(false);
      setAiHistories({});
      fetch(`/api/projects/${selectedProject.project.id}/ai-cache`)
        .then(res => res.json())
        .then(data => {
          if (data && !data.error) {
            setAiHistories(data);
          }
          setIsHistoryLoaded(true);
        })
        .catch(err => {
          console.error('Failed to load AI cache:', err);
          setIsHistoryLoaded(true);
        });
    }
  }, [selectedProject?.project.id]);

  // Debounced Save AI Cache
  useEffect(() => {
    if (!selectedProject?.project.id || !isHistoryLoaded) return;

    if (aiSaveTimerRef.current) clearTimeout(aiSaveTimerRef.current);

    aiSaveTimerRef.current = setTimeout(() => {
      fetch(`/api/projects/${selectedProject.project.id}/ai-cache`, {
        method: 'POST',
        body: JSON.stringify(aiHistories)
      }).catch(err => console.error('Failed to save AI cache', err));
    }, 2000);

    return () => {
      if (aiSaveTimerRef.current) clearTimeout(aiSaveTimerRef.current);
    };
  }, [aiHistories, selectedProject?.project.id, isHistoryLoaded]);

  // Schedule save after content change
  const scheduleSave = useCallback((newContent: string) => {
    pendingContentRef.current = newContent;
    setIsDirty(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(debouncedSave, 3000);
  }, [debouncedSave]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (aiSaveTimerRef.current) clearTimeout(aiSaveTimerRef.current);
    };
  }, []);

  // Initialize Items and Handle File Switching
  useEffect(() => {
    if (selectedFile?.content) {
      // Check if we switched files
      const isNewFile = displayedFilePathRef.current !== selectedFile.path;

      if (isNewFile) {
        // Reset editing state for new file
        displayedFilePathRef.current = selectedFile.path;
        pendingContentRef.current = selectedFile.content;
        setCurrentContent(selectedFile.content);
        setItems(parseContent(selectedFile.content));
        setIsDirty(false);
        setFocusedItemId(null);
        setFocusedItemSentences([]);
        setExpandedThoughts(new Set());
      } else {
        // Same file, maybe content update logic?
        // Usually we trust internal state, but if file changed externally (unlikely without events), we might re-parse.
        // For now, assume internal state is truth is ok.
      }
    }
  }, [selectedFile]);

  // Expose current line and line count for external sync triggering
  useImperativeHandle(ref, () => ({
    getCurrentLine: () => {
      // 1. If an item is selected (AI Panel), use its line
      if (selectedItem?.lineStart) {
        return selectedItem.lineStart;
      }
      // 2. If an item is focused (Drill Down), use its line
      if (focusedItemId) {
        const item = items.find(i => i.id === focusedItemId);
        if (item?.lineStart) return item.lineStart;
      }

      // 3. Fallback to first visible
      if (items.length > 0) {
        return items[0]?.lineStart || 1;
      }
      return 1;
    },
    getSelectedLineCount: () => {
      if (selectedItem?.content) return selectedItem.content.split('\n').length;
      return 1;
    }
  }));

  // Handle scroll to line from PDF sync
  useEffect(() => {
    if (scrollToLine && items.length > 0) {
      const targetItem = [...items].reverse().find(item => {
        if (item.lineStart) {
          return item.lineStart <= scrollToLine;
        }
        return false;
      });

      if (targetItem) {
        // Scroll into view
        setTimeout(() => {
          const el = document.getElementById(`item-${targetItem.id}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Highlight effect could be added here
            el.classList.add('bg-blue-50');
            setTimeout(() => el.classList.remove('bg-blue-50'), 2000);
          }
        }, 100);
      }
    }
  }, [scrollToLine, items]);

  const toggleThoughts = (itemId: string) => {
    setExpandedThoughts(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleUpdateItem = (itemId: string, updates: Partial<TextItem>) => {
    const newItems = items.map(item => {
      if (item.id === itemId) {
        return { ...item, ...updates };
      }
      return item;
    });
    setItems(newItems);
    reconstructAndSave(newItems);
  };

  const handleUpdateSentence = (sentenceId: string, newContent: string) => {
    if (!focusedItemId) return;

    const newSentences = focusedItemSentences.map(s =>
      s.id === sentenceId ? { ...s, content: newContent } : s
    );
    setFocusedItemSentences(newSentences);

    // Debounce re-assembling the paragraph to avoid lag? 
    // For now, we update the parent paragraph immediately
    const joinedContent = newSentences.map(s => s.content).join(' '); // Sentences are usually space-separated

    const newItems = items.map(item => {
      if (item.id === focusedItemId) {
        return { ...item, content: joinedContent };
      }
      return item;
    });
    setItems(newItems);
    reconstructAndSave(newItems);
  };

  const reconstructAndSave = (currentItems: TextItem[]) => {
    // Rebuild full file content
    const fullContent = currentItems.map(item => {
      let block = '';
      // Add thoughts if present
      if (item.thoughts) {
        block += `% [FW_THOUGHTS]\n`;
        // Prefix each line with % if not already
        const lines = item.thoughts.split('\n');
        const commentedLines = lines.map(l => l.trim().startsWith('%') ? l : `% ${l}`).join('\n');
        block += commentedLines + '\n';
        block += `% [/FW_THOUGHTS]\n`;
      }
      block += item.content;
      return block;
    }).join('\n\n'); // Separate paragraphs with blank lines

    scheduleSave(fullContent);
  };

  const handleAIResult = (result: DiffResult, modifiedContent: string, mode: AIMode) => {
    if (!modifiedContent) return;

    // AI result usually targets a specific item ID
    // If we are in focused mode, and it targeted a sentence, update sentence
    if (focusedItemId && items.find(i => i.id === result.itemId) === undefined) {
      // It might be a sentence ID
      const sent = focusedItemSentences.find(s => s.id === result.itemId);
      if (sent) {
        handleUpdateSentence(result.itemId, modifiedContent);
        return;
      }
    }

    // Otherwise update paragraph
    handleUpdateItem(result.itemId, {
      modifiedContent: modifiedContent,
      status: 'modified',
      aiMode: mode,
      aiTimestamp: new Date().toISOString()
    });

    // Also save directly? handleUpdateItem calls reconstructAndSave triggers scheduleSave. 
    // AI usually wants "Apply" later, but existing interface applies immediately via callback?
    // The previous MainEditor used `handleSaveChanges` for direct confirmation, 
    // but `handleAIResult` actually set "modifiedContent" field.
    // Let's stick to setting modifiedContent and let user "Accept" if we implement diff view.
    // Wait, the previous code SAVED the modified content immediately if applied?
    // "const newFileContent = ... handleSaveChanges" 
    // Yes, it auto-saved.

    // For now, we'll update the content directly for simplicity as per "Refine" behavior usually expected
    handleUpdateItem(result.itemId, { content: modifiedContent });
  };

  const enterFocusMode = (item: TextItem) => {
    setFocusedItemId(item.id);
    // Parse into sentences
    const sents = parseParagraphToSentences(item.content, item.lineStart);
    setFocusedItemSentences(sents);
    setSelectedItem(null); // Clear AI selection to avoid confusion
  };

  const exitFocusMode = () => {
    setFocusedItemId(null);
    setFocusedItemSentences([]);
  };

  const renderParagraph = (item: TextItem) => {
    const isFocused = focusedItemId === item.id;
    const isSelected = selectedItem?.id === item.id;
    const hasThoughts = !!item.thoughts;
    const thoughtsOpen = expandedThoughts.has(item.id) || (hasThoughts && !item.content); // Auto-open if no content

    if (isFocused) {
      return (
        <div key={item.id} id={`item-${item.id}`} className="mb-0 bg-white rounded-xl shadow-lg border-2 border-blue-500 p-6 transition-all h-full flex flex-col">
          <div className="flex items-center justify-between mb-6 border-b border-blue-100 pb-4 shrink-0">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 p-2 rounded-lg">
                <Maximize2 size={24} className="text-blue-600" />
              </div>
              <div>
                <h3 className="font-bold text-xl text-slate-800">Focused Editing</h3>
                <p className="text-sm text-slate-500">Distraction-free mode</p>
              </div>
            </div>
            <button
              onClick={exitFocusMode}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors font-medium text-sm"
              title="Exit Focus Mode"
            >
              <Minimize2 size={16} />
              <span>Exit Focus</span>
            </button>
          </div>

          {/* Thoughts in Focus Mode - Always visible but styled nicely */}
          <div className="mb-6 bg-yellow-50 p-4 rounded-xl border border-yellow-200 shrink-0">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-yellow-700 uppercase tracking-wide">
              <Lightbulb size={14} />
              <span>Thoughts & Plan</span>
            </div>
            <textarea
              className="w-full bg-transparent border-0 text-slate-700 text-base focus:ring-0 p-0 resize-none font-medium leading-relaxed"
              value={item.thoughts ? item.thoughts.replace(/^% ?/gm, '') : ''}
              onChange={(e) => handleUpdateItem(item.id, { thoughts: e.target.value })}
              placeholder="What is the main point of this paragraph?"
              rows={2}
            />
          </div>

          <div className="space-y-4 overflow-y-auto flex-1 pr-2">
            {focusedItemSentences.map((sent, idx) => (
              <div key={sent.id} className="flex gap-4 items-start group">
                <span className="text-sm text-slate-300 font-mono mt-3 w-6 text-right select-none">{idx + 1}</span>
                <textarea
                  className="flex-1 p-4 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-400 focus:shadow-md focus:outline-none transition-all resize-none text-lg text-slate-800 leading-loose"
                  value={sent.content}
                  onChange={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                    handleUpdateSentence(sent.id, e.target.value);
                  }}
                  ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                />
                <button
                  className="opacity-0 group-hover:opacity-100 p-2 text-slate-400 hover:text-blue-500 transition-opacity mt-2"
                  onClick={() => setSelectedItem(sent)} // Select for AI
                  title="AI tools for this sentence"
                >
                  <MessageSquare size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div key={item.id} id={`item-${item.id}`} className="mb-4 group relative">
        {/* Card Container */}
        <div className={`rounded-lg border transition-all hover:shadow-md ${isSelected ? 'bg-slate-100 border-slate-300 shadow-sm' : 'bg-white border-slate-200'}`}>

          {/* Toolbar (Visible on Hover/Selected) */}
          <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <button
              onClick={() => enterFocusMode(item)}
              className="p-1.5 bg-white border border-slate-200 rounded text-slate-500 hover:text-blue-600 hover:border-blue-400 shadow-sm"
              title="Focus / Drill Down"
            >
              <Maximize2 size={14} />
            </button>
          </div>


          {/* Main Content */}
          <div className="p-6">
            {editingItemId === item.id ? (
              <textarea
                autoFocus
                className="w-full text-base text-slate-800 leading-relaxed resize-none border-0 focus:ring-0 focus:outline-none p-0 bg-transparent"
                value={item.content}
                onChange={(e) => {
                  handleUpdateItem(item.id, { content: e.target.value });
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                placeholder="Write your paragraph here..."
              />
            ) : (
              <div
                className="w-full text-base text-slate-800 leading-relaxed whitespace-pre-wrap cursor-pointer p-0 min-h-[1.5em] hover:text-blue-900 transition-colors"
                onClick={() => {
                  setEditingItemId(item.id);
                  setSelectedItem(item);
                }}
                title="Click to edit and open AI tools"
              >
                {item.content || <span className="text-slate-400 italic">Empty paragraph... Click to write.</span>}
              </div>
            )}
          </div>

          {/* AI Panel (Embedded) */}
          {isSelected && (
            <AIEditorPanel
              isOpen={true}
              selectedItemId={item.id}
              item={item}
              fileContent=""
              projectId={selectedProject?.project.id || ''}
              currentFilePath={selectedFile?.path}
              histories={aiHistories}
              onHistoryChange={setAiHistories}
              onClose={() => setSelectedItem(null)}
              onResult={handleAIResult}
              onContentChange={(newContent) => handleUpdateItem(item.id, { content: newContent })}
              onFullscreenChange={setIsAIPanelFullscreen}
              editorRef={editorContainerRef}
              embedded={true}
            />
          )}
        </div>
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
              {saveStatus === 'saving' ? (
                <span className="flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                  <Loader2 size={10} className="animate-spin" />
                  Saving...
                </span>
              ) : isDirty ? (
                <span className="flex items-center gap-1 text-[10px] text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full" title="Changes not yet saved to disk">
                  <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                  Unsaved
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-slate-400 px-1.5 py-0.5 rounded-full">
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
            focusedItemId ? (
              /* Fullscreen Focus Mode */
              (() => {
                const item = items.find(i => i.id === focusedItemId);
                if (!item) return null;
                return (
                  <div className="max-w-4xl mx-auto h-full flex flex-col">
                    {renderParagraph(item)}
                  </div>
                );
              })()
            ) : (
              /* Normal List Mode */
              <div className="max-w-4xl mx-auto pb-4">
                {items.map(item => renderParagraph(item))}
                {/* Add Paragraph Button at bottom */}
                <div
                  className="mt-8 border-2 border-dashed border-slate-200 rounded-lg p-4 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors text-slate-400 hover:text-blue-500"
                  onClick={() => {
                    const newItem: TextItem = {
                      id: `para-new-${Date.now()}`,
                      content: '',
                      type: 'paragraph',
                      lineStart: items.length > 0 ? (items[items.length - 1].lineStart || 0) + 10 : 1,
                      status: 'unchanged'
                    };
                    setItems([...items, newItem]);
                  }}
                >
                  <span className="text-sm font-medium">+ Add Paragraph</span>
                </div>
              </div>
            )
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              <div className="text-center">
                <button
                  onClick={() => setItems([{ id: 'para-1', content: '', type: 'paragraph', lineStart: 1, status: 'unchanged' }])}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg shadow hover:bg-blue-600"
                >
                  Start Writing
                </button>
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
          onRestore={(content) => {
            // Handle restore
            pendingContentRef.current = content;
            setIsDirty(true);
            debouncedSave(); // force save
            setCurrentContent(content);
            const parsed = parseContent(content);
            setItems(parsed);
            setShowBackupTimeline(false);
          }}
        />
      )}
    </div>
  );
});

export default MainEditor;
