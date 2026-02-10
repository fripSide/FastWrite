import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Save, Loader2, CheckCircle, RotateCcw, Search, Wand2, Zap } from 'lucide-react';

type AIMode = 'diagnose' | 'refine' | 'quickfix';

interface ProjectPrompts {
	system: string;
	diagnose: { user: string };
	refine: { user: string };
	quickfix: { user: string };
}

interface SystemPromptModalProps {
	isOpen: boolean;
	projectId: string;
	onClose: () => void;
}



const SystemPromptModal: React.FC<SystemPromptModalProps> = ({ isOpen, projectId, onClose }) => {
	const [prompts, setPrompts] = useState<ProjectPrompts | null>(null);
	// Use 'system' as a special tab, plus the AIMode values
	const [activeTab, setActiveTab] = useState<'system' | AIMode>('system');
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [saved, setSaved] = useState(false);

	// ESC key handler
	useEffect(() => {
		const handleEsc = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && isOpen && !isSaving) {
				onClose();
			}
		};
		window.addEventListener('keydown', handleEsc);
		return () => window.removeEventListener('keydown', handleEsc);
	}, [isOpen, isSaving, onClose]);

	useEffect(() => {
		if (isOpen && projectId) {
			loadPrompts();
		}
	}, [isOpen, projectId]);

	const loadPrompts = async () => {
		setIsLoading(true);
		try {
			const response = await fetch(`/api/prompts/${projectId}?t=${Date.now()}`);
			if (response.ok) {
				const data = await response.json();
				setPrompts(data);
			}
		} catch (error) {
			console.error('Failed to load prompts:', error);
		} finally {
			setIsLoading(false);
		}
	};

	const handleSave = async () => {
		if (!prompts) return;

		setIsSaving(true);
		try {
			const response = await fetch(`/api/prompts/${projectId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(prompts)
			});

			if (response.ok) {
				setSaved(true);
				setTimeout(() => {
					setSaved(false);
					onClose();
				}, 800);
			}
		} catch (error) {
			console.error('Failed to save prompts:', error);
		} finally {
			setIsSaving(false);
		}
	};

	const handleReset = async () => {
		if (!confirm('Reset all prompts to defaults? This cannot be undone.')) return;

		setIsLoading(true);
		try {
			const response = await fetch(`/api/prompts/${projectId}/reset?t=${Date.now()}`, { method: 'POST' });
			if (response.ok) {
				const data = await response.json();
				setPrompts(data.prompts);
			}
		} catch (error) {
			console.error('Failed to reset prompts:', error);
		} finally {
			setIsLoading(false);
		}
	};

	const updateSystemPrompt = (value: string) => {
		if (!prompts) return;
		setPrompts({ ...prompts, system: value });
	};

	const updateModePrompt = (mode: AIMode, value: string) => {
		if (!prompts) return;
		setPrompts({
			...prompts,
			[mode]: { user: value }
		});
	};

	if (!isOpen) return null;

	// Define all tabs including System
	const TABS: { id: 'system' | AIMode; label: string; icon: React.ReactNode; color: string; description: string }[] = [
		{
			id: 'system',
			label: 'System Prompt',
			icon: <FileText size={14} />,
			color: 'blue',
			description: 'Default writing style and Personal settings.'
		},
		{
			id: 'diagnose',
			label: 'Diagnose',
			icon: <Search size={14} />,
			color: 'amber',
			description: 'Check the whole paper and local context to verify content, logic flow, and argumentation structure.'
		},
		{
			id: 'refine',
			label: 'Refine',
			icon: <Wand2 size={14} />,
			color: 'purple',
			description: 'Polish language, adjust structure, remove redundancy, and correct phrasing to improve quality.'
		},
		{
			id: 'quickfix',
			label: 'QuickFix',
			icon: <Zap size={14} />,
			color: 'green',
			description: 'Check syntax and grammar errors only. Do not change meaning or sentence order.'
		}
	];

	const activeTabConfig = TABS.find(t => t.id === activeTab)!;

	return createPortal(
		<div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] overflow-hidden flex flex-col">
				{/* Compact Header */}
				<div className="px-6 py-3 border-b border-slate-200 bg-slate-50 flex flex-col gap-3">
					<div className="flex items-start justify-between gap-4">
						{/* Title & Description */}
						<div className="flex-1 flex gap-3 min-w-0">
							<div className={`p-2 rounded-lg shrink-0 mt-0.5 self-start ${activeTab === 'system' ? 'bg-blue-100 text-blue-600' :
								activeTab === 'diagnose' ? 'bg-amber-100 text-amber-600' :
									activeTab === 'refine' ? 'bg-purple-100 text-purple-600' :
										'bg-green-100 text-green-600'
								}`}>
								{activeTabConfig.icon}
							</div>
							<div className="min-w-0">
								<h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
									{activeTabConfig.label}
									<span className="text-sm font-normal text-slate-400">configuration</span>
								</h2>
								<p className="text-xs text-slate-500 mt-0.5 leading-relaxed truncate">
									{activeTabConfig.description}
								</p>
							</div>
						</div>

						{/* Actions */}
						<div className="flex items-center gap-3 shrink-0">
							{/* Flow (Hidden on mobile) */}
							<div className="hidden lg:flex items-center gap-2 text-[10px] text-slate-500 bg-white px-2 py-1.5 rounded border border-slate-200 shadow-sm">
								<span className="font-bold text-slate-400">CONTEXT</span>
								<div className="flex items-center gap-1.5">
									<span className={`px-1.5 py-0.5 rounded border ${activeTab === 'system' ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>
										System
									</span>
									<span className="text-slate-300">+</span>
									<span className={`px-1.5 py-0.5 rounded border ${activeTab !== 'system' ? 'bg-purple-50 border-purple-200 text-purple-700 font-medium' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>
										{activeTab === 'system' ? 'Mode' : activeTabConfig.label}
									</span>
									<span className="text-slate-300">+</span>
									<span className="px-1.5 py-0.5 bg-slate-50 border-slate-100 text-slate-500 rounded border">
										User
									</span>
								</div>
							</div>

							<button
								onClick={onClose}
								disabled={isSaving}
								className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 text-slate-500"
							>
								<X size={20} />
							</button>
						</div>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 flex flex-col overflow-hidden">
					{isLoading ? (
						<div className="flex items-center justify-center h-full">
							<Loader2 size={32} className="animate-spin text-blue-500" />
						</div>
					) : prompts ? (
						<div className="flex flex-col h-full">
							{/* Tab Bar */}
							<div className="px-6 pt-4 border-b border-slate-200 bg-slate-50/50 flex gap-2 overflow-x-auto">
								{TABS.map(tab => {
									const isActive = activeTab === tab.id;
									// Dynamic color classes based on tab color
									const activeClasses = {
										blue: 'text-blue-700 border-blue-500 bg-blue-50',
										amber: 'text-amber-700 border-amber-500 bg-amber-50',
										purple: 'text-purple-700 border-purple-500 bg-purple-50',
										green: 'text-green-700 border-green-500 bg-green-50'
									}[tab.color] || 'text-slate-700 border-slate-500';

									return (
										<button
											key={tab.id}
											onClick={() => setActiveTab(tab.id)}
											className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap rounded-t-lg ${isActive
												? activeClasses
												: 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-100'
												}`}
										>
											{tab.icon}
											{tab.label}
										</button>
									);
								})}
							</div>

							{/* Input Area - Takes remaining height */}
							<div className="flex-1 p-6 bg-slate-50 overflow-hidden flex flex-col">
								<div className="flex-1 flex flex-col relative">
									<textarea
										value={activeTab === 'system' ? prompts.system : prompts[activeTab].user}
										onChange={(e) => activeTab === 'system'
											? updateSystemPrompt(e.target.value)
											: updateModePrompt(activeTab as AIMode, e.target.value)
										}
										placeholder={`Enter ${activeTab === 'system' ? 'System' : activeTabConfig.label} prompt...`}
										className="w-full h-full p-6 text-sm font-mono border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white shadow-sm leading-relaxed"
										disabled={isSaving}
										spellCheck={false}
									/>
									{/* Context Helper Text */}
									<div className="mt-2 text-xs text-slate-400 flex justify-end px-1">
										<span className="font-mono">
											{activeTab === 'system' ? prompts.system.length : prompts[activeTab as AIMode].user.length} characters
										</span>
									</div>
								</div>
							</div>
						</div>
					) : (
						<div className="text-center text-slate-400 py-12">
							Failed to load prompts
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="px-6 py-4 border-t border-slate-200 bg-white flex justify-between items-center z-10">
					<button
						onClick={handleReset}
						disabled={isSaving || isLoading}
						className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors text-sm font-medium flex items-center gap-2 disabled:opacity-50"
					>
						<RotateCcw size={16} />
						Reset to Defaults
					</button>
					<div className="flex gap-3">
						<button
							onClick={onClose}
							disabled={isSaving}
							className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors text-sm font-medium disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							onClick={handleSave}
							disabled={isSaving || isLoading || !prompts}
							className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium flex items-center gap-2 shadow-md hover:shadow-lg translate-y-0 hover:-translate-y-0.5 active:translate-y-0 transform duration-150"
						>
							{saved ? (
								<>
									<CheckCircle size={16} />
									Saved!
								</>
							) : isSaving ? (
								<>
									<Loader2 size={16} className="animate-spin" />
									Saving...
								</>
							) : (
								<>
									<Save size={16} />
									Save All
								</>
							)}
						</button>
					</div>
				</div>
			</div>
		</div>,
		document.body
	);
};

export default SystemPromptModal;
