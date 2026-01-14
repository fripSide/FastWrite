import React from 'react';
import { Check } from 'lucide-react';
import type { DiffResult } from '../types';

interface DiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  diff: DiffResult;
  onAccept: () => void;
  onReject: () => void;
  hideHeader?: boolean;
}

// Compute inline word diff between original and modified
function computeInlineDiff(original: string, modified: string): Array<{ type: 'unchanged' | 'deleted' | 'added', text: string }> {
  const originalWords = original.split(/(\s+)/);
  const modifiedWords = modified.split(/(\s+)/);

  const result: Array<{ type: 'unchanged' | 'deleted' | 'added', text: string }> = [];

  // Simple LCS-based diff
  const m = originalWords.length;
  const n = modifiedWords.length;

  // Build LCS table
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (originalWords[i - 1] === modifiedWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  let i = m, j = n;
  const operations: Array<{ type: 'unchanged' | 'deleted' | 'added', text: string }> = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalWords[i - 1] === modifiedWords[j - 1]) {
      operations.unshift({ type: 'unchanged', text: originalWords[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      operations.unshift({ type: 'added', text: modifiedWords[j - 1] });
      j--;
    } else if (i > 0) {
      operations.unshift({ type: 'deleted', text: originalWords[i - 1] });
      i--;
    }
  }

  // Merge consecutive same-type items
  for (const op of operations) {
    const last = result[result.length - 1];
    if (last && last.type === op.type) {
      last.text += op.text;
    } else {
      result.push({ ...op });
    }
  }

  return result;
}

const DiffViewer: React.FC<DiffViewerProps> = ({
  originalContent,
  modifiedContent,
  diff,
  onAccept,
  hideHeader = false
}) => {
  const inlineDiff = computeInlineDiff(originalContent, modifiedContent);

  const hasChanges = inlineDiff.some(item => item.type !== 'unchanged');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with Accept button - only show if not hidden */}
      {hasChanges && !hideHeader && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-red-100 border border-red-300 rounded"></span>
              Deleted
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-green-100 border border-green-300 rounded"></span>
              Added
            </span>
          </div>
          <button
            onClick={onAccept}
            className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
          >
            <Check size={14} />
            Accept Changes
          </button>
        </div>
      )}

      {/* Inline Diff Content */}
      <div className="flex-1 overflow-auto p-4 bg-white">
        {!hasChanges ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            <p>No changes detected</p>
          </div>
        ) : (
          <div className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">
            {inlineDiff.map((item, idx) => {
              if (item.type === 'unchanged') {
                return <span key={idx}>{item.text}</span>;
              } else if (item.type === 'deleted') {
                return (
                  <span
                    key={idx}
                    className="bg-red-100 text-red-800 line-through decoration-red-500"
                  >
                    {item.text}
                  </span>
                );
              } else {
                return (
                  <span
                    key={idx}
                    className="bg-green-100 text-green-800"
                  >
                    {item.text}
                  </span>
                );
              }
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default DiffViewer;
