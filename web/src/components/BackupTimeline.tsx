import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Clock, RotateCcw, FileText, X, Trash2, GitCommit } from 'lucide-react';
import type { Backup } from '../types';
import { api } from '../api';
import DiffViewer from './DiffViewer';
import { computeWordDiff } from '../utils/diff';

interface BackupTimelineProps {
  projectId: string;
  filePath: string;
  fileName: string;
  currentContent: string;
  onClose: () => void;
  onRestore: (content: string) => void;
}

const BackupTimeline: React.FC<BackupTimelineProps> = ({
  projectId,
  filePath,
  fileName,
  currentContent,
  onClose,
  onRestore,
}) => {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBackups();
  }, [projectId]);

  // Select the latest backup by default when loaded
  useEffect(() => {
    if (backups.length > 0 && !selectedBackup) {
      setSelectedBackup(backups[0]);
    }
  }, [backups]);

  const loadBackups = async () => {
    setLoading(true);
    try {
      const allBackups = await api.getBackups(projectId);
      // Filter backups for this file. 
      // Note: filename matches basename(path).
      // We assume backup.filename is just the name "foo.tex"
      const fileBackups = allBackups.filter(b => b.filename === fileName);
      setBackups(fileBackups);
    } catch (error) {
      console.error('Failed to load backups:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClearCurrent = async () => {
    if (confirm(`Are you sure you want to delete ALL backups for ${fileName}? This cannot be undone.`)) {
      setLoading(true);
      await api.deleteBackups(projectId, fileName);
      await loadBackups();
      setSelectedBackup(null);
    }
  };

  const handleClearAll = async () => {
    if (confirm(`Are you sure you want to delete ALL backups for the ENTIRE project? This cannot be undone.`)) {
      setLoading(true);
      await api.deleteBackups(projectId); // No filename = clear all
      await loadBackups();
      setSelectedBackup(null);
    }
  };

  const handleRestore = (backup: Backup) => {
    if (confirm(`Restore this version from ${formatTimestamp(backup.timestamp)}? Current changes will be backed up.`)) {
      onRestore(backup.content);
      onClose(); // Close modal after restore
    }
  };

  // Compute diff between current file content and selected backup
  const diffResult = useMemo(() => {
    if (!selectedBackup) return null;

    // Always compare current file content with the selected backup
    // This shows what changes exist between the backup and the current file
    return {
      diff: computeWordDiff(selectedBackup.content, currentContent),
      originalContent: selectedBackup.content,
      modifiedContent: currentContent,
    };
  }, [selectedBackup, currentContent]);

  const formatTimestamp = (timestamp: string): string => {
    try {
      // Timestamp format YYYYMMDDHHMMSS
      // Need to parse manually if ISO format not strict
      if (timestamp.length === 14) {
        const y = timestamp.substring(0, 4);
        const m = timestamp.substring(4, 6);
        const d = timestamp.substring(6, 8);
        const h = timestamp.substring(8, 10);
        const min = timestamp.substring(10, 12);
        const s = timestamp.substring(12, 14);
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
      }
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]">
      <div className="bg-white rounded-xl shadow-2xl w-[90vw] max-w-6xl h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <Clock size={24} className="text-blue-600" />
            <div>
              <h3 className="text-lg font-bold text-slate-800">Version History</h3>
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <FileText size={14} />
                <span>{fileName}</span>
                <span className="text-slate-300">|</span>
                <span>{backups.length} versions</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleClearCurrent}
              disabled={backups.length === 0}
              className="flex items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium disabled:opacity-50"
              title="Delete backups for this file"
            >
              <Trash2 size={16} />
              Clear File Backups
            </button>
            <button
              onClick={handleClearAll}
              className="flex items-center gap-2 px-3 py-2 text-red-700 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium border border-transparent hover:border-red-200"
              title="Delete ALL project backups"
            >
              <Trash2 size={16} />
              Clear All Project Backups
            </button>
            <div className="w-px h-6 bg-slate-300 mx-2"></div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-200 rounded-lg transition-colors text-slate-500"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left: Sidebar List */}
          <div className="w-80 border-r border-slate-200 flex flex-col bg-slate-50/50">
            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
                <span>Loading...</span>
              </div>
            ) : backups.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                <Clock size={32} className="mb-2 opacity-50" />
                <p>No history found</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {backups.map((backup, index) => (
                  <div
                    key={backup.id}
                    onClick={() => setSelectedBackup(backup)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedBackup?.id === backup.id
                      ? 'bg-white border-blue-500 shadow-md ring-1 ring-blue-500/20'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                      }`}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <span className={`text-xs font-bold ${index === 0 ? 'text-blue-600' : 'text-slate-600'}`}>
                        {index === 0 ? 'Current Version' : `Version ${backups.length - index}`}
                      </span>
                      <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full font-mono">
                        {backup.content.split(/\s+/).filter(w => w.length > 0).length} words
                      </span>
                    </div>
                    <div className="text-sm font-medium text-slate-800 mb-1">
                      {formatTimestamp(backup.timestamp)}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <GitCommit size={12} />
                      <span className="truncate w-full font-mono text-[10px]" title={backup.id}>{backup.id}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Diff View */}
          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            {selectedBackup && diffResult ? (
              <>
                <div className="px-6 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-800">Changes since this backup</span>
                      <span className="text-xs text-slate-500">
                        Backup from {formatTimestamp(selectedBackup.timestamp)} vs Current file
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleRestore(selectedBackup)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 shadow-sm"
                  >
                    <RotateCcw size={16} />
                    Revert to this Version
                  </button>
                </div>

                <div className="flex-1 overflow-auto p-6">
                  <div className="max-w-4xl mx-auto bg-white border border-slate-200 rounded-lg shadow-sm min-h-[500px]">
                    <DiffViewer
                      originalContent={diffResult.originalContent}
                      modifiedContent={diffResult.modifiedContent}
                      diff={diffResult.diff}
                      onAccept={() => { }} // Not used in history
                      onReject={() => { }} // Not used
                      hideHeader={true} // Use our custom header above
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                <FileText size={48} className="mb-4 text-slate-200" />
                <p>Select a version to view changes</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default BackupTimeline;
