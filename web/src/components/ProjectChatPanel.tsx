import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Loader2, MessageSquare, Send, Trash2 } from 'lucide-react';
import type { ChatMessage, SelectedFile, SelectedProject } from '../types';

interface ProjectChatPanelProps {
  selectedProject: SelectedProject | null;
  selectedFile: SelectedFile | null;
}

const CHAT_HISTORY_KEY = 'project-chat:global';
const CHAT_SYSTEM_PROMPT = `You are FastWrite's project chat assistant for LaTeX paper editing.
Answer conversationally and stay grounded in the provided project or file context when available.
If the current context is insufficient, say what information is missing instead of inventing details.
Do not claim that you edited files or executed actions.`;
const MAX_CONTEXT_CHARS = 12000;

const ProjectChatPanel: React.FC<ProjectChatPanelProps> = ({ selectedProject, selectedFile }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const projectId = selectedProject?.project.id || null;

  const fileContext = useMemo(() => {
    if (!selectedProject) return '';

    const parts = [`Project: ${selectedProject.project.name}`];
    if (selectedFile) {
      parts.push(`Current file: ${selectedFile.name}`);
      parts.push(`File path: ${selectedFile.path}`);

      const fileContent = selectedFile.content || '';
      if (fileContent.trim()) {
        const truncated = fileContent.length > MAX_CONTEXT_CHARS;
        const content = truncated
          ? `${fileContent.slice(0, MAX_CONTEXT_CHARS)}\n\n[Truncated ${fileContent.length - MAX_CONTEXT_CHARS} additional characters]`
          : fileContent;
        parts.push(`Current file content:\n${content}`);
      }
    } else {
      parts.push('No file is currently selected.');
    }

    return parts.join('\n\n');
  }, [selectedProject, selectedFile]);

  useEffect(() => {
    if (!projectId) {
      setMessages([]);
      setError(null);
      setIsHistoryLoaded(false);
      return;
    }

    setMessages([]);
    setError(null);
    setIsHistoryLoaded(false);

    fetch(`/api/projects/${projectId}/ai-cache?scope=chat`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load chat history (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        const history = Array.isArray(data?.[CHAT_HISTORY_KEY]) ? data[CHAT_HISTORY_KEY] : [];
        setMessages(history);
        setIsHistoryLoaded(true);
      })
      .catch((loadError) => {
        console.error('Failed to load project chat history:', loadError);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load chat history');
        setIsHistoryLoaded(true);
      });
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !isHistoryLoaded) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      fetch(`/api/projects/${projectId}/ai-cache?scope=chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [CHAT_HISTORY_KEY]: messages })
      }).catch((saveError) => {
        console.error('Failed to save project chat history:', saveError);
      });
    }, 1200);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages, projectId, isHistoryLoaded]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || !projectId || isSending) return;

    const userMessage: ChatMessage = {
      id: `chat-user-${Date.now()}`,
      role: 'user',
      content: trimmedInput,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setError(null);
    setIsSending(true);

    try {
      const previousHistory = messages.map((message) => ({
        role: message.role,
        content: message.content
      }));

      const response = await fetch('/api/ai/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'refine',
          systemPrompt: CHAT_SYSTEM_PROMPT,
          userPrompt: trimmedInput,
          content: fileContext,
          history: previousHistory
        })
      });

      if (!response.ok) {
        throw new Error(`Chat request failed (${response.status})`);
      }

      const data = await response.json() as { content: string; model?: string };
      const assistantMessage: ChatMessage = {
        id: `chat-ai-${Date.now()}`,
        role: 'ai',
        content: data.content,
        model: data.model,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (sendError) {
      console.error('Project chat request failed:', sendError);
      setError(sendError instanceof Error ? sendError.message : 'Chat request failed');
    } finally {
      setIsSending(false);
    }
  };

  const handleClearHistory = () => {
    setMessages([]);
    setError(null);
  };

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-900 text-slate-400">
        <div className="text-center px-6">
          <MessageSquare size={32} className="mx-auto mb-3 text-slate-500" />
          <p className="text-sm">Select a project to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquare size={16} className="text-blue-400" />
              <span>Project Chat</span>
            </div>
            <p className="mt-1 truncate text-xs text-slate-400">{selectedProject.project.name}</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <FileText size={12} />
              <span className="truncate">{selectedFile?.name || 'No file selected'}</span>
            </div>
          </div>

          <button
            onClick={handleClearHistory}
            disabled={messages.length === 0}
            className="flex items-center gap-1 rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-400 transition-colors hover:border-slate-700 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            title="Clear chat history"
          >
            <Trash2 size={12} />
            Clear
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-xs text-center text-sm text-slate-500">
              Ask about the current paper, the selected file, or request drafting help.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-900 text-slate-100 ring-1 ring-slate-800'
                }`}>
                  <div className="whitespace-pre-wrap">{message.content}</div>
                  <div className="mt-2 flex items-center gap-2 text-[10px] opacity-70">
                    <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                    {message.role === 'ai' && message.model && (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{message.model}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-slate-800 p-4">
        {error && (
          <div className="mb-3 rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={4}
            placeholder="Ask about the current project or file..."
            className="w-full resize-none bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500">
              Context uses the current project and selected file.
            </p>
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || isSending}
              className="flex items-center gap-2 rounded-full bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectChatPanel;
