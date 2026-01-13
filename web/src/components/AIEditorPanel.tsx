import React, { useState, useEffect, useRef } from 'react';
import { Search, Wand2, Zap, Maximize2, Minimize2, Send, Check, Bot, Settings, History, Trash2, X } from 'lucide-react';
import type { TextItem, AIMode, DiffResult } from '../types';
import { computeWordDiff } from '../utils/diff';
import { api } from '../api';
import DiffViewer from './DiffViewer';

interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  suggestion?: string;
  timestamp: Date;
}

interface AIPanelProps {
  isOpen: boolean;
  selectedItemId: string | null;
  item: TextItem | null;
  fileContent: string;
  projectId: string;
  onClose: () => void;
  onResult: (result: DiffResult, modifiedContent: string, mode: AIMode) => void;
  onContentChange?: (content: string) => void;
  onFullscreenChange?: (isFullscreen: boolean) => void;
}

const AIPanel: React.FC<AIPanelProps> = ({
  isOpen,
  selectedItemId,
  item,
  projectId,
  onClose,
  onResult,
  onContentChange,
  onFullscreenChange
}) => {
  const [selectedMode, setSelectedMode] = useState<AIMode>('refine');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // User input
  const [userPrompt, setUserPrompt] = useState('');
  const [useSystemPrompt, setUseSystemPrompt] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState('');

  // AI Result logic
  // We no longer keep local workingContent state, we use item.content directly
  const [aiResultContent, setAiResultContent] = useState<string | null>(null);
  const [aiExplanation, setAiExplanation] = useState('');

  // Chat history
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load system prompt
  useEffect(() => {
    if (projectId) {
      api.getSystemPrompt(projectId).then(setSystemPrompt);
    }
  }, [projectId]);

  // Reset AI state when selected item changes (but not when content of same item changes)
  useEffect(() => {
    resetAIState();
  }, [item?.id]);

  const resetAIState = () => {
    setAiResultContent(null);
    setAiExplanation('');
    setUserPrompt('');
    setChatHistory([]);
  };

  const handleClearContext = () => {
    setChatHistory([]);
    setAiResultContent(null);
    setAiExplanation('');
  };

  const getDefaultModePrompt = (mode: AIMode): string => {
    switch (mode) {
      case 'diagnose':
        return 'Analyze the writing logic, structure, and clarity. Identify issues and suggest improvements.';
      case 'refine':
        return 'Polish the language, improve expression, and enhance readability while preserving technical content.';
      case 'quickfix':
        return 'Fix grammar, spelling, and punctuation errors. Keep the original meaning intact.';
    }
  };

  const handleRunAI = async () => {
    if (isProcessing || !item) return;

    // Add user message to history immediately
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userPrompt || 'Refine this content',
      timestamp: new Date()
    };
    setChatHistory(prev => [...prev, userMsg]);

    setIsProcessing(true);
    setAiResultContent(null);
    setAiExplanation('');

    try {
      const defaultPrompt = getDefaultModePrompt(selectedMode);
      let fullPrompt = defaultPrompt;

      if (userPrompt.trim()) {
        fullPrompt += '\n\nAdditional instructions: ' + userPrompt;
      }

      if (useSystemPrompt && systemPrompt) {
        fullPrompt = systemPrompt + '\n\n' + fullPrompt;
      }

      const response = await fetch('/api/ai/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: selectedMode,
          content: item.content, // Use live content from MainEditor
          userPrompt: fullPrompt
        })
      });

      if (!response.ok) {
        throw new Error('AI processing failed');
      }

      const data = await response.json() as { content: string; explanation?: string };

      setAiResultContent(data.content);
      setAiExplanation(data.explanation || '');

      // Add AI response to history
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: data.explanation || 'Here is the suggested revision.',
        suggestion: data.content,
        timestamp: new Date()
      };
      setChatHistory(prev => [...prev, aiMsg]);

    } catch (error) {
      console.error('AI error:', error);
      setAiExplanation('Error: Failed to process. Please try again.');
    } finally {
      setIsProcessing(false);
      setUserPrompt('');
    }
  };

  const handleApplyAIResult = () => {
    if (aiResultContent && selectedItemId && item) {
      const diffResult = computeWordDiff(item.content, aiResultContent);
      diffResult.itemId = selectedItemId;
      onResult(diffResult, aiResultContent, selectedMode);

      // Clear result state after applying to prepare for next round
      // setAiResultContent(null); // Optional: Do we keep showing diff until user clears? 
      // User said "If we apply, the text at the top is changed... Then we can continue"
      // So clearer to reset result view so it doesn't show "No changes" (since now original==modified)
      setAiResultContent(null);
    }
  };

  if (!isOpen) return null;

  // Compute diff on the fly
  const diff = (item && aiResultContent)
    ? computeWordDiff(item.content, aiResultContent)
    : null;

  const getIconForMode = (mode: AIMode) => {
    switch (mode) {
      case 'diagnose': return <Search size={14} className="text-purple-500" />;
      case 'refine': return <Wand2 size={14} className="text-blue-500" />;
      case 'quickfix': return <Zap size={14} className="text-green-500" />;
    }
  };

  const getModeLabel = (mode: AIMode) => {
    switch (mode) {
      case 'diagnose': return 'Diagnose';
      case 'refine': return 'Refine';
      case 'quickfix': return 'QuickFix';
    }
  };

  return (
    <div className={`border-t-2 border-blue-500 bg-white flex flex-col shadow-lg transition-all ${isFullscreen
      ? 'fixed inset-0 z-50 h-screen w-screen'
      : 'relative w-full mt-2 border-x border-b border-slate-200 rounded-b-lg mb-4'
      }`}>
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-blue-50 to-white border-b border-slate-200">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
            <h3 className="text-sm font-bold text-slate-800">AI Editor</h3>
          </div>

          {/* Mode selector */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {(['diagnose', 'refine', 'quickfix'] as AIMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSelectedMode(mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${selectedMode === mode
                  ? 'bg-white shadow-sm text-slate-800'
                  : 'text-slate-500 hover:text-slate-700'
                  }`}
              >
                {getIconForMode(mode)}
                {getModeLabel(mode)}
              </button>
            ))}
          </div>

          {/* History Toggle */}
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${showHistory ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100 text-slate-600'
              }`}
          >
            <History size={14} />
            History ({chatHistory.length})
          </button>

          {/* Clear Context */}
          {chatHistory.length > 0 && (
            <button
              onClick={handleClearContext}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-red-50 text-red-600 transition-all"
              title="Clear conversation history"
            >
              <Trash2 size={14} />
              Clear Context
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const newFullscreen = !isFullscreen;
              setIsFullscreen(newFullscreen);
              onFullscreenChange?.(newFullscreen);
            }}
            className="p-1.5 hover:bg-slate-100 rounded-md transition-colors text-slate-500"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button
            onClick={() => {
              onClose();
              onFullscreenChange?.(false);
            }}
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors"
            title="Close AI Panel"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Content Area - Split Vertical */}
      <div className={`flex flex-col flex-1 ${isFullscreen ? '' : 'min-h-[250px]'}`}>

        {/* Fullscreen Editor Mode - Only visible when maximized */}
        {isFullscreen && item && (
          <div className="flex-1 flex flex-col border-b border-slate-200 min-h-[300px]">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Fullscreen Editor
              </span>
            </div>
            <textarea
              value={item.content}
              onChange={(e) => onContentChange?.(e.target.value)}
              className="flex-1 w-full p-6 text-base font-mono focus:outline-none resize-none overflow-auto"
              placeholder="Edit content here..."
            />
          </div>
        )}

        {/* TOP: Prompt Input */}
        <div className="flex-initial p-3 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <Bot size={14} />
              AI Assistant
            </span>
            <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer hover:text-slate-700">
              <input
                type="checkbox"
                checked={useSystemPrompt}
                onChange={(e) => setUseSystemPrompt(e.target.checked)}
                className="w-3.5 h-3.5 border-slate-300 text-blue-600 focus:ring-blue-500 rounded"
              />
              <Settings size={12} />
              Include System Prompt
            </label>
          </div>
          <div className="flex gap-2">
            <textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleRunAI();
                }
              }}
              placeholder={`Ask AI to ${getModeLabel(selectedMode).toLowerCase()} the selected content...`}
              className="flex-1 p-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:outline-none resize-none"
              rows={1}
              style={{ minHeight: '42px', maxHeight: '100px' }}
            />
            <button
              onClick={handleRunAI}
              disabled={isProcessing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 self-start"
            >
              {isProcessing ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send size={16} />
              )}
              Run
            </button>
          </div>
        </div>

        {/* BOTTOM: AI Result Area (Diff View) - Only shown if Result exists */}
        {aiResultContent && diff && (
          <div className="flex-1 flex flex-col overflow-hidden bg-white border-t border-slate-200">
            <div className="px-3 py-2 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">
                Suggested Changes (Diff)
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-blue-600 mr-2">
                  {aiExplanation && aiExplanation.length > 50 ? aiExplanation.substring(0, 50) + '...' : aiExplanation}
                </span>
                <button
                  onClick={() => {
                    setAiResultContent(null);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5"
                >
                  Discard
                </button>
                <button
                  onClick={handleApplyAIResult}
                  className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 transition-colors flex items-center gap-1"
                >
                  <Check size={12} />
                  Accept Changes
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-2 min-h-[150px]">
              <DiffViewer
                originalContent={item?.content || ''}
                modifiedContent={aiResultContent}
                diff={diff}
                onAccept={handleApplyAIResult}
                onReject={() => setAiResultContent(null)}
              />
            </div>
          </div>
        )}

        {/* Empty State placeholder if no result yet */}
        {(!aiResultContent && !isProcessing) && (
          <div className="flex-1 bg-slate-50/50 flex flex-col items-center justify-center text-slate-400 p-8">
            <Bot size={32} className="mb-2 opacity-50" />
            <p className="text-sm font-medium">Ready to assist</p>
            <p className="text-xs">Select text above, define your prompt, and run.</p>
          </div>
        )}

        {isProcessing && (
          <div className="flex-1 bg-slate-50/50 flex items-center justify-center p-8">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm text-slate-500 font-medium">Generating suggestions...</p>
            </div>
          </div>
        )}
      </div>

      {/* Chat History Popup */}
      {showHistory && (
        <div className="absolute top-12 right-4 w-[800px] max-w-[90vw] max-h-[80%] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col z-[60] overflow-hidden ring-1 ring-black/5">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h4 className="font-semibold text-slate-700 flex items-center gap-2">
              <History size={16} />
              Chat History
            </h4>
            <button
              onClick={() => setShowHistory(false)}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white">
            {chatHistory.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-8">No history yet</p>
            ) : (
              chatHistory.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[90%] p-3 rounded-lg text-sm mb-1 ${msg.role === 'user' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-800'
                    }`}>
                    {msg.content}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {msg.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AIPanel;
