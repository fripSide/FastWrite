import React, { useState } from 'react';
import { Search, Wand2, Zap, X } from 'lucide-react';
import type { TextItem, AIMode, DiffResult } from '../types';
import { computeWordDiff } from '../utils/diff';
import DiffViewer from './DiffViewer';

interface AIPanelProps {
  isOpen: boolean;
  selectedItemId: string | null;
  item: TextItem | null;
  fileContent: string;
  onClose: () => void;
  onResult: (result: DiffResult, modifiedContent: string, mode: AIMode) => void;
}

const AIPanel: React.FC<AIPanelProps> = ({
  isOpen,
  selectedItemId,
  item,
  onClose,
  onResult
}) => {
  const [selectedMode, setSelectedMode] = useState<AIMode>('diagnose');
  const [userPrompt, setUserPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<DiffResult | null>(null);
  const [explanation, setExplanation] = useState<string>('');
  const [modifiedContent, setModifiedContent] = useState<string>('');

  const handleModeChange = (mode: AIMode): void => {
    setSelectedMode(mode);
    setResult(null);
    setExplanation('');
    setModifiedContent('');
  };

  const handleRunAI = async (): Promise<void> => {
    if (!item || !selectedItemId) return;
    setIsProcessing(true);
    setResult(null);
    setExplanation('');
    setModifiedContent('');

    try {
      const response = await fetch('/api/ai/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: selectedMode,
          content: item.content,
          userPrompt: userPrompt
        })
      });

      if (!response.ok) {
        throw new Error('AI processing failed');
      }

      const data = await response.json() as { content: string; explanation?: string };
      
      const diffResult = computeWordDiff(item.content, data.content);
      diffResult.itemId = selectedItemId;
      
      setResult(diffResult);
      setExplanation(data.explanation || '');
      setModifiedContent(data.content);
      onResult(diffResult, data.content, selectedMode);
    } catch (error) {
      console.error('AI error:', error);
      const emptyResult: DiffResult = {
        itemId: selectedItemId,
        hasChanges: false,
        changes: [],
        summary: { additions: 0, deletions: 0, modifications: 0 }
      };
      setResult(emptyResult);
      onResult(emptyResult, '', selectedMode);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  const getIconForMode = (mode: AIMode) => {
    switch (mode) {
      case 'diagnose':
        return <Search size={20} className="text-purple-500" />;
      case 'refine':
        return <Wand2 size={20} className="text-blue-500" />;
      case 'quickfix':
        return <Zap size={20} className="text-green-500" />;
    }
  };

  const getModeLabel = (mode: AIMode) => {
    switch (mode) {
      case 'diagnose':
        return 'Diagnose';
      case 'refine':
        return 'Refine';
      case 'quickfix':
        return 'QuickFix';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50">
      <div className="bg-white rounded-t-lg shadow-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-800">AI Editor Panel</h2>
            <span className="text-sm text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
              Selected: {selectedItemId}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2 text-gray-600"
          >
            <X size={20} />
            <span>Close</span>
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          <div className="w-80 bg-slate-50 border-r border-gray-200 flex flex-col p-4 space-y-6">
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Operation Mode
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {(['diagnose', 'refine', 'quickfix'] as AIMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => handleModeChange(mode)}
                    className={`flex items-center gap-3 px-4 py-3 border-2 rounded-lg transition-all ${
                      selectedMode === mode ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300'
                    }`}
                  >
                    {getIconForMode(mode)}
                    <span className="text-sm font-medium">{getModeLabel(mode)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Additional Instructions
              </h3>
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder="Tell AI what to focus on..."
                className="flex-1 w-full p-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none bg-white"
              />
            </div>

            <button
              onClick={() => handleRunAI()}
              disabled={isProcessing || !item}
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  {getIconForMode(selectedMode)}
                  <span>Run {getModeLabel(selectedMode)}</span>
                </>
              )}
            </button>
          </div>

          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            {result ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {explanation && (
                  <div className="p-4 bg-blue-50 border-b border-blue-200">
                    <h4 className="text-sm font-bold text-blue-800 mb-1">AI Explanation</h4>
                    <p className="text-sm text-blue-700">{explanation}</p>
                  </div>
                )}
                
                <DiffViewer
                  originalContent={item?.content || ''}
                  modifiedContent={modifiedContent}
                  diff={result}
                  onAccept={() => {
                    if (modifiedContent) {
                      onResult(result, modifiedContent, selectedMode);
                      onClose();
                    }
                  }}
                  onReject={() => {
                    setResult(null);
                    setExplanation('');
                    setModifiedContent('');
                  }}
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-12">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-300">
                  <Zap size={32} />
                </div>
                <h3 className="text-lg font-medium text-slate-600">Ready to Process</h3>
                <p className="text-sm text-center max-w-xs mt-2">
                  Select a mode and add any instructions, then click Run to see AI suggestions.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIPanel;
