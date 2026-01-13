import React, { useState, useEffect } from 'react';
import { Clock, RotateCcw, FileText, X } from 'lucide-react';
import type { Backup } from '../types';
import { api } from '../api';

interface BackupTimelineProps {
  projectId: string;
  filePath: string;
  fileName: string;
  onClose: () => void;
  onRestore: (content: string) => void;
}

const BackupTimeline: React.FC<BackupTimelineProps> = ({
  projectId,
  filePath,
  fileName,
  onClose,
  onRestore,
}) => {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBackups();
  }, [projectId]);

  const loadBackups = async () => {
    setLoading(true);
    try {
      const allBackups = await api.getBackups(projectId);
      const fileBackups = allBackups.filter(b => b.filename === fileName);
      setBackups(fileBackups);
    } catch (error) {
      console.error('Failed to load backups:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = (backup: Backup) => {
    if (confirm(`Restore this backup from ${backup.timestamp}?`)) {
      onRestore(backup.content);
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <Clock size={20} className="text-blue-500" />
            <h3 className="text-lg font-semibold text-slate-800">Backup History</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <FileText size={16} className="text-orange-500" />
            <span className="font-medium">{fileName}</span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-500">{filePath}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <div className="text-sm">Loading backups...</div>
            </div>
          ) : backups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Clock size={48} className="mb-4 text-slate-300" />
              <p className="text-sm">No backups found for this file</p>
            </div>
          ) : (
            <div className="space-y-3">
              {backups.map((backup, index) => (
                <div
                  key={backup.id}
                  className={`p-4 rounded-lg border-2 transition-all cursor-pointer ${
                    selectedBackup?.id === backup.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                  onClick={() => setSelectedBackup(backup)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <Clock size={16} className="text-slate-400 mt-0.5" />
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-slate-800">
                            {formatTimestamp(backup.timestamp)}
                          </span>
                          {index === 0 && (
                            <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                              Latest
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {backup.content.length} characters
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRestore(backup);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-md transition-colors"
                    >
                      <RotateCcw size={14} />
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default BackupTimeline;
