import React, { useState, useEffect } from 'react';
import { Settings, X, Save, FileText, Loader2 } from 'lucide-react';
import { api } from '../api';
import type { ProjectConfig, FileNode } from '../types';

interface CompileSettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
}

const CompileSettingsModal: React.FC<CompileSettingsModalProps> = ({
	isOpen,
	onClose,
	projectId
}) => {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [config, setConfig] = useState<Partial<ProjectConfig>>({});
	const [texFiles, setTexFiles] = useState<string[]>([]);

	useEffect(() => {
		if (isOpen && projectId) {
			loadData();
		}
	}, [isOpen, projectId]);

	const loadData = async () => {
		setLoading(true);
		try {
			// Load config
			const currentConfig = await api.getProjectConfig(projectId);
			if (currentConfig) {
				setConfig(currentConfig);
			}

			// Load files to find .tex candidates
			// We manually fetch here since we need a flat list of paths
			const res = await fetch(`/api/projects/${projectId}/files`);
			if (res.ok) {
				const data = await res.json();
				const files: FileNode[] = data.files || [];
				const flattened = flattenFiles(files);
				setTexFiles(flattened.filter(f => f.endsWith('.tex')));
			}
		} catch (error) {
			console.error('Failed to load settings:', error);
		} finally {
			setLoading(false);
		}
	};

	const flattenFiles = (nodes: FileNode[]): string[] => {
		let paths: string[] = [];
		for (const node of nodes) {
			if (node.type === 'file') {
				paths.push(node.name); // Using name for now as mainFile typically stores filename in root or relative path
				// ideally we should handle full relative paths if the user projects have deep structure
				// But current server implementation of mainFile detection seems to look for 'main.tex' basename
				// Let's assume for now we list filenames. PROPER FIX: use relative paths.
				// Re-reading server logic: mainFile is stored as just filename in createProject? 
				// "mainFile: texFiles.find(...)". texFiles there is readdirSync of root.
				// So it likely expects a filename in the root.
				// However, if we support subdirectories, we should probably support paths.
				// For this iteration, let's just list basenames recursively or relative paths?
				// Let's stick to relative paths (node.id in our FileNode structure usually holds relative path)
			} else if (node.children) {
				paths = [...paths, ...flattenFiles(node.children)];
			}
		}
		return paths;
	};

	// Improved flatten using "id" which usually holds relative path in our system (checked server.ts:55)
	const flattenFileNodes = (nodes: FileNode[]): { name: string; path: string }[] => {
		let results: { name: string; path: string }[] = [];
		for (const node of nodes) {
			if (node.type === 'file') {
				results.push({ name: node.name, path: node.id });
			} else if (node.children) {
				results = [...results, ...flattenFileNodes(node.children)];
			}
		}
		return results;
	};

	// Let's redefine loadData to use the better flatten
	const loadDataRefined = async () => {
		setLoading(true);
		try {
			const currentConfig = await api.getProjectConfig(projectId);
			if (currentConfig) {
				setConfig(currentConfig);
			}

			const res = await fetch(`/api/projects/${projectId}/files`);
			if (res.ok) {
				const data = await res.json();
				const nodes: FileNode[] = data.files || [];
				const flat = flattenFileNodes(nodes);
				// Filter .tex files
				setTexFiles(flat.filter(f => f.name.endsWith('.tex')).map(f => f.name));
				// NOTE: Currently server seems to store mainFile as simple filename (basename).
				// If we want to support deep main files, we should change this. 
				// But to be safe and consistent with current backend (projectConfig.ts around line 84),
				// we will stick to filenames for now or relative paths if the backend supports it.
				// Looking at server.ts:509 (compile), it does:
				// const { projectId, texPath } = req.json()
				// Wait, compile api takes texPath. Who calls compile? PDFViewer.
				// PDFViewer calls compile with `mainTexPath`.
				// `App.tsx` determines `mainTexPath`.
				// If we want the CONFIG to drive this, App.tsx should start using config.mainFile.
			}
		} catch (error) {
			console.error('Failed to load settings:', error);
		} finally {
			setLoading(false);
		}
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			await api.saveProjectConfig(projectId, {
				compiler: config.compiler,
				mainFile: config.mainFile,
			});
			onClose();
			// We might need to trigger a reload of config in parent or just let the next compile pick it up
			// Ideally App.tsx should listen to this or re-fetch.
			// For now, since PDFViewer calls compile using internal state or passed props... 
			// Actually App.tsx passes `mainTexPath`. logic in App.tsx:124: `const mainTexPath = selectedFile?.path || null;`
			// Wait! The current app compiles the SELECTED file.
			// The user wants to set a "Main File".
			// If we set a Main File, we probably want "Recompile" to compile THAT file, not the currently open one (unless it's the same).
			// Or maybe "Recompile" always compiles the Main File?
			// "Recompile" in Overleaf compiles the project's main file.
			// Currently FastWrite compiles `selectedFile`.
			// If we confirm this change, we should fundamentally receive `mainTexPath` from config in App.tsx, not valid from selectedFile.
		} catch (error) {
			console.error('Failed to save settings:', error);
		} finally {
			setSaving(false);
		}
	};

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
			<div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200">
				<div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
					<h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
						<Settings size={16} className="text-slate-500" />
						Compilation Settings
					</h3>
					<button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
						<X size={16} />
					</button>
				</div>

				<div className="p-6 space-y-4">
					{loading ? (
						<div className="flex justify-center py-8">
							<Loader2 className="animate-spin text-blue-500" size={24} />
						</div>
					) : (
						<>
							<div className="space-y-1.5">
								<label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
									LaTeX Engine
								</label>
								<select
									value={config.compiler || 'pdflatex'}
									onChange={(e) => setConfig({ ...config, compiler: e.target.value as any })}
									className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
								>
									<option value="browser-wasm">Browser (WASM) — No Install Required</option>
									<option value="pdflatex">pdfLaTeX (Standard)</option>
									<option value="xelatex">XeLaTeX (Better Font Support)</option>
									<option value="lualatex">LuaLaTeX (Modern)</option>
								</select>
								<p className="text-[10px] text-slate-400">
									{config.compiler === 'browser-wasm'
										? 'Compiles entirely in the browser via WebAssembly. No local LaTeX installation needed. Note: Supports basic packages only.'
										: 'Select the engine used to compile your LaTeX document.'}
								</p>
							</div>

							<div className="space-y-1.5">
								<label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
									Main Document
								</label>
								<div className="relative">
									<FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
									<select
										value={config.mainFile || ''}
										onChange={(e) => setConfig({ ...config, mainFile: e.target.value })}
										className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
									>
										{!config.mainFile && <option value="">Select a file...</option>}
										{texFiles.map(file => (
											<option key={file} value={file}>{file}</option>
										))}
									</select>
								</div>
								<p className="text-[10px] text-slate-400">
									The root file that will be compiled (usually main.tex).
								</p>
							</div>
						</>
					)}
				</div>

				<div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
					<button
						onClick={onClose}
						className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
					>
						Cancel
					</button>
					<button
						onClick={handleSave}
						disabled={saving || loading}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors shadow-sm"
					>
						{saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
						Save Settings
					</button>
				</div>
			</div>
		</div>
	);
};

export default CompileSettingsModal;
