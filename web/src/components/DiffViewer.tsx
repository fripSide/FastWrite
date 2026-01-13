import React from 'react';
import { ArrowLeft, ArrowRight, Check, X, Edit3, Save, RotateCcw, ChevronLeft } from 'lucide-react';
import type { DiffResult, DiffChange } from '../types';

interface DiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  diff: DiffResult;
  onAccept: () => void;
  onReject: () => void;
  onEdit?: (content: string) => void;
  isReadOnly?: boolean;
}

const DiffViewer: React.FC<DiffViewerProps> = ({
  originalContent,
  modifiedContent,
  diff,
  onAccept,
  onReject,
  onEdit,
  isReadOnly = false
}) => {
  const [showOriginal, setShowOriginal] = React.useState(true);
  const [showModified, setShowModified] = React.useState(true);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editableContent, setEditableContent] = React.useState('');

  const handleEdit = (): void => {
    setIsEditing(true);
    setShowOriginal(false);
    setShowModified(false);
  };

  const handleCancel = (): void => {
    setIsEditing(false);
    setShowOriginal(true);
    setShowModified(true);
    setEditableContent('');
  };

  const handleSave = (): void => {
    if (editableContent !== modifiedContent) {
      onEdit?.(editableContent);
    }
    setIsEditing(false);
    setShowOriginal(true);
    setShowModified(true);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <RotateCcw size={20} className="text-blue-500" />
          <span>Word-Level Diff Viewer</span>
        </h3>

        <div className="flex items-center gap-2">
          {!isReadOnly && (
            <>
              {!isEditing ? (
                <button
                  onClick={handleEdit}
                  className="px-3 py-2 bg-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-300 transition-colors"
                >
                  <Edit3 size={16} />
                  <span>Edit</span>
                </button>
              ) : (
                <button
                  onClick={handleCancel}
                  className="px-3 py-2 bg-gray-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-gray-300 transition-colors"
                >
                  <X size={16} />
                  <span>Cancel</span>
                </button>
              )}

              {isEditing && (
                <button
                  onClick={handleSave}
                  disabled={editableContent === modifiedContent}
                  className="ml-2 px-3 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save size={16} />
                  <span>Save</span>
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className={`flex items-center gap-1 ${!showOriginal ? 'text-slate-600' : 'text-slate-800'}`}>
            <button
              onClick={() => setShowOriginal(true)}
              className={`px-3 py-1.5 rounded transition-colors ${
                showOriginal ? 'bg-blue-50 text-white' : 'bg-transparent text-slate-600'
              }`}
            >
              <ChevronLeft size={16} />
              <span>Original</span>
            </button>
          </div>

          <div className={`flex items-center gap-1 ${!showModified ? 'text-slate-600' : 'text-slate-800'}`}>
            <button
              onClick={() => setShowModified(true)}
              className={`px-3 py-1.5 rounded transition-colors ${
                showModified ? 'bg-blue-500 text-white' : 'bg-transparent text-slate-600'
              }`}
            >
              <span>Modified</span>
            </button>
          </div>

          {diff.summary.additions > 0 && (
            <span className="ml-4 px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded">
              +{diff.summary.additions} additions
            </span>
          )}

          {diff.summary.deletions > 0 && (
            <span className="ml-4 px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded">
              -{diff.summary.deletions} deletions
            </span>
          )}

          {diff.summary.modifications > 0 && (
            <span className="ml-4 px-2 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded">
              ~{diff.summary.modifications} modifications
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onAccept}
            className="px-6 py-2 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-colors"
            >
            <Check size={20} />
            <span>Accept Changes</span>
          </button>

          <button
            onClick={onReject}
            className="px-6 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition-colors"
            >
            <X size={20} />
            <span>Reject</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className={`w-1/2 border-r border-slate-200 ${showOriginal ? 'bg-white' : 'bg-gray-50'}`}>
          <h4 className="text-sm font-bold text-slate-800 mb-2 px-3">
            Original Version
          </h4>
          <div className="p-4 overflow-auto">
            {showOriginal ? (
              <pre className="text-sm text-slate-700 whitespace-pre-wrap break-words">{originalContent}</pre>
            ) : (
              <div className="p-4 text-center text-slate-600">
                <p>Hidden</p>
              </div>
            )}
          </div>

          {isEditing && (
            <textarea
              value={editableContent}
              onChange={(e) => setEditableContent(e.target.value)}
              className="w-full h-full p-3 text-sm border-0 resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
            />
          )}
        </div>

        <div className={`w-1/2 border-r border-slate-200 ${showModified ? 'bg-gray-50' : 'bg-white'}`}>
          <h4 className="text-sm font-bold text-slate-800 mb-2 px-3">
            Modified Version
          </h4>
          <div className="p-4 overflow-auto">
            {showModified ? (
              isEditing ? (
                <textarea
                  value={editableContent}
                  onChange={(e) => setEditableContent(e.target.value)}
                  className="w-full h-full p-3 text-sm border-0 resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                />
              ) : (
                <pre className="text-sm text-slate-700 whitespace-pre-wrap break-words">{modifiedContent}</pre>
              )
            ) : (
              <div className="p-4 text-center text-slate-600">
                <p>Hidden</p>
              </div>
            )}
          </div>
        </div>

        <div className="w-full border-l border-slate-200 bg-slate-100 overflow-y-auto">
          <h4 className="text-sm font-bold text-slate-800 mb-2 px-3">Changes</h4>
          {diff.changes.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-slate-600">No changes detected</p>
            </div>
          ) : (
            <div className="space-y-1">
              {diff.changes.map((change, idx) => (
                <div
                  key={idx}
                  className={`p-2 rounded ${
                    change.type === 'addition'
                      ? 'bg-green-50 border-green-200'
                      : change.type === 'deletion'
                        ? 'bg-red-50 border-red-200'
                        : 'bg-amber-50 border-amber-200'
                  }`}
                >
                  <span className={`text-xs font-semibold ${
                    change.type === 'addition' ? 'text-green-700' : change.type === 'deletion' ? 'text-red-700' : 'text-amber-700'
                  }`}>
                    {change.type === 'addition' ? '+' : change.type === 'deletion' ? '-' : '~'}
                    {' '}
                    {change.type === 'addition' ? change.modified : change.original}
                  </span>
                  <span className="text-slate-600 ml-2">
                    {change.type === 'addition' ? 'Add' : change.type === 'deletion' ? 'Delete' : 'Modified'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DiffViewer;
