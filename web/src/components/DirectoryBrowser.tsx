import React, { useState, useEffect, useCallback } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Home, ArrowUp, Loader2, X, Check, FileText } from 'lucide-react';

interface DirectoryBrowserProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (path: string, mainTexFile?: string) => void;
    initialPath?: string;
}

interface DirEntry {
    name: string;
    path: string;
}

interface TexFileEntry {
    name: string;
    path: string;
    hasDocumentclass: boolean;
}

interface DirListing {
    path: string;
    dirs: DirEntry[];
    texFiles: TexFileEntry[];
    hasTexFiles: boolean;
}

const DirectoryBrowser: React.FC<DirectoryBrowserProps> = ({ isOpen, onClose, onSelect, initialPath }) => {
    const [currentPath, setCurrentPath] = useState(initialPath || '');
    const [listing, setListing] = useState<DirListing | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
    const [childListings, setChildListings] = useState<Map<string, DirListing>>(new Map());
    const [pathInput, setPathInput] = useState('');
    const [selectedMainFile, setSelectedMainFile] = useState<string | null>(null);

    const loadDirectory = useCallback(async (dirPath?: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/utils/list-directory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: dirPath || undefined }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to list directory');
            }
            const data = await res.json() as DirListing;
            setListing(data);
            setCurrentPath(data.path);
            setPathInput(data.path);
            setExpandedDirs(new Set());
            setChildListings(new Map());

            // Auto-select the first file with \documentclass as main file
            const mainCandidate = data.texFiles?.find(f => f.hasDocumentclass);
            setSelectedMainFile(mainCandidate?.name || null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load directory');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const loadChildDirectory = useCallback(async (dirPath: string) => {
        try {
            const res = await fetch('/api/utils/list-directory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: dirPath }),
            });
            if (res.ok) {
                const data = await res.json() as DirListing;
                setChildListings(prev => new Map(prev).set(dirPath, data));
            }
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        if (isOpen) {
            loadDirectory(initialPath || undefined);
        }
    }, [isOpen]);

    const handleNavigate = (path: string) => {
        loadDirectory(path);
    };

    const handleGoUp = () => {
        if (!currentPath || currentPath === '/') return;
        const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
        loadDirectory(parent);
    };

    const handleGoHome = () => {
        loadDirectory();
    };

    const handleToggleExpand = async (dirPath: string) => {
        const newExpanded = new Set(expandedDirs);
        if (newExpanded.has(dirPath)) {
            newExpanded.delete(dirPath);
        } else {
            newExpanded.add(dirPath);
            if (!childListings.has(dirPath)) {
                await loadChildDirectory(dirPath);
            }
        }
        setExpandedDirs(newExpanded);
    };

    const handlePathInputSubmit = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && pathInput.trim()) {
            loadDirectory(pathInput.trim());
        }
    };

    const handleSelect = (path: string) => {
        onSelect(path, selectedMainFile || undefined);
        onClose();
    };

    // Build breadcrumb parts
    const pathParts = currentPath.split('/').filter(Boolean);
    const breadcrumbs = pathParts.map((part, i) => ({
        name: part,
        path: '/' + pathParts.slice(0, i + 1).join('/'),
    }));

    if (!isOpen) return null;

    const texFiles = listing?.texFiles || [];

    return (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[110]">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                    <h3 className="text-sm font-semibold text-slate-700">Select LaTeX Project Directory</h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* Path input + navigation */}
                <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2">
                    <button
                        onClick={handleGoHome}
                        className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-700 transition-colors"
                        title="Home"
                    >
                        <Home size={16} />
                    </button>
                    <button
                        onClick={handleGoUp}
                        disabled={!currentPath || currentPath === '/'}
                        className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-700 disabled:text-slate-300 transition-colors"
                        title="Go up"
                    >
                        <ArrowUp size={16} />
                    </button>
                    <input
                        type="text"
                        value={pathInput}
                        onChange={(e) => setPathInput(e.target.value)}
                        onKeyDown={handlePathInputSubmit}
                        className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded bg-white focus:ring-1 focus:ring-blue-400 focus:border-blue-400 font-mono"
                        placeholder="Type path and press Enter"
                    />
                </div>

                {/* Breadcrumbs */}
                <div className="px-4 py-1.5 border-b border-slate-100 flex items-center gap-0.5 text-xs text-slate-500 overflow-x-auto whitespace-nowrap">
                    <button onClick={() => handleNavigate('/')} className="hover:text-blue-600 px-1 py-0.5 rounded hover:bg-blue-50 transition-colors">/</button>
                    {breadcrumbs.map((crumb, i) => (
                        <React.Fragment key={crumb.path}>
                            <ChevronRight size={10} className="text-slate-300 flex-shrink-0" />
                            <button
                                onClick={() => handleNavigate(crumb.path)}
                                className={`hover:text-blue-600 px-1 py-0.5 rounded hover:bg-blue-50 transition-colors ${i === breadcrumbs.length - 1 ? 'font-medium text-slate-700' : ''}`}
                            >
                                {crumb.name}
                            </button>
                        </React.Fragment>
                    ))}
                </div>

                {/* Directory listing */}
                <div className="flex-1 overflow-y-auto min-h-0">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 size={24} className="animate-spin text-blue-500" />
                        </div>
                    ) : error ? (
                        <div className="p-4 text-sm text-red-600">{error}</div>
                    ) : listing ? (
                        <div className="py-1">
                            {/* .tex files in current directory */}
                            {texFiles.length > 0 && (
                                <div className="px-3 py-2 border-b border-slate-100">
                                    <div className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
                                        <FileText size={12} className="text-orange-500" />
                                        LaTeX Files — select main file:
                                    </div>
                                    {texFiles.map(f => (
                                        <label
                                            key={f.name}
                                            className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${selectedMainFile === f.name
                                                    ? 'bg-blue-50 border border-blue-200'
                                                    : 'hover:bg-slate-50 border border-transparent'
                                                }`}
                                        >
                                            <input
                                                type="radio"
                                                name="mainTexFile"
                                                checked={selectedMainFile === f.name}
                                                onChange={() => setSelectedMainFile(f.name)}
                                                className="accent-blue-600"
                                            />
                                            <FileText size={14} className={f.hasDocumentclass ? 'text-orange-500' : 'text-slate-400'} />
                                            <span className={`text-sm ${f.hasDocumentclass ? 'font-medium text-slate-800' : 'text-slate-600'}`}>
                                                {f.name}
                                            </span>
                                            {f.hasDocumentclass && (
                                                <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">main</span>
                                            )}
                                        </label>
                                    ))}
                                </div>
                            )}

                            {/* Subdirectories */}
                            {listing.dirs.length === 0 && texFiles.length === 0 ? (
                                <div className="px-4 py-8 text-center text-sm text-slate-400">Empty directory</div>
                            ) : (
                                listing.dirs.map(dir => (
                                    <div key={dir.path}>
                                        <div className="flex items-center group hover:bg-blue-50 transition-colors">
                                            <button
                                                onClick={() => handleToggleExpand(dir.path)}
                                                className="p-1 ml-2 text-slate-400 hover:text-slate-600"
                                            >
                                                {expandedDirs.has(dir.path) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                            </button>
                                            <button
                                                onClick={() => handleNavigate(dir.path)}
                                                className="flex items-center gap-2 flex-1 px-2 py-1.5 text-left text-sm"
                                            >
                                                {expandedDirs.has(dir.path) ? (
                                                    <FolderOpen size={16} className="text-amber-500 flex-shrink-0" />
                                                ) : (
                                                    <Folder size={16} className="text-amber-400 flex-shrink-0" />
                                                )}
                                                <span className="text-slate-700 truncate">{dir.name}</span>
                                            </button>
                                            <button
                                                onClick={() => handleSelect(dir.path)}
                                                className="opacity-0 group-hover:opacity-100 px-2 py-1 mr-2 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-all"
                                            >
                                                Select
                                            </button>
                                        </div>
                                        {/* Expanded children */}
                                        {expandedDirs.has(dir.path) && (
                                            <div className="ml-6 border-l border-slate-200">
                                                {childListings.has(dir.path) ? (
                                                    <>
                                                        {/* Show .tex files in child directories */}
                                                        {childListings.get(dir.path)!.texFiles?.map(f => (
                                                            <div key={f.name} className="flex items-center gap-2 px-3 py-1 text-xs text-slate-500">
                                                                <FileText size={12} className={f.hasDocumentclass ? 'text-orange-500' : 'text-slate-400'} />
                                                                <span>{f.name}</span>
                                                                {f.hasDocumentclass && (
                                                                    <span className="text-[9px] bg-orange-100 text-orange-600 px-1 rounded">main</span>
                                                                )}
                                                            </div>
                                                        ))}
                                                        {childListings.get(dir.path)!.dirs.length > 0 ? (
                                                            childListings.get(dir.path)!.dirs.map(child => (
                                                                <div key={child.path} className="flex items-center group hover:bg-blue-50 transition-colors">
                                                                    <button
                                                                        onClick={() => handleNavigate(child.path)}
                                                                        className="flex items-center gap-2 flex-1 px-3 py-1 text-left text-sm"
                                                                    >
                                                                        <Folder size={14} className="text-amber-400 flex-shrink-0" />
                                                                        <span className="text-slate-600 truncate text-xs">{child.name}</span>
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleSelect(child.path)}
                                                                        className="opacity-0 group-hover:opacity-100 px-2 py-0.5 mr-2 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-all"
                                                                    >
                                                                        Select
                                                                    </button>
                                                                </div>
                                                            ))
                                                        ) : childListings.get(dir.path)!.texFiles?.length === 0 ? (
                                                            <div className="px-3 py-1 text-xs text-slate-400 italic">Empty</div>
                                                        ) : null}
                                                    </>
                                                ) : (
                                                    <div className="px-3 py-1">
                                                        <Loader2 size={12} className="animate-spin text-slate-400" />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    ) : null}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        {texFiles.length > 0 && (
                            <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex-shrink-0">
                                <FileText size={10} />
                                {texFiles.length} .tex file{texFiles.length !== 1 ? 's' : ''}
                            </span>
                        )}
                        <span className="text-xs text-slate-500 truncate font-mono">{currentPath}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => handleSelect(currentPath)}
                            disabled={texFiles.length > 0 && !selectedMainFile}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                        >
                            <Check size={12} />
                            Select This Folder
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DirectoryBrowser;
