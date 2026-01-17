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

const MODE_LABELS: Record<AIMode, { label: string; icon: React.ReactNode; color: string }> = {
	diagnose: { label: 'Diagnose', icon: <Search size={14} />, color: 'blue' },
	refine: { label: 'Refine', icon: <Wand2 size={14} />, color: 'purple' },
	quickfix: { label: 'QuickFix', icon: <Zap size={14} />, color: 'green' }
};

const SystemPromptModal: React.FC<SystemPromptModalProps> = ({ isOpen, projectId, onClose }) => {
	const [prompts, setPrompts] = useState<ProjectPrompts | null>(null);
	const [activeMode, setActiveMode] = useState<AIMode>('diagnose');
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
			const response = await fetch(`/api/prompts/${projectId}`);
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
			const response = await fetch(`/api/prompts/${projectId}/reset`, { method: 'POST' });
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

	return createPortal(
		<div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] overflow-hidden flex flex-col">
				{/* Header */}
				<div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-amber-50 to-orange-50">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="p-2 bg-amber-100 rounded-lg">
								<FileText size={20} className="text-amber-600" />
							</div>
							<div>
								<h2 className="text-lg font-bold text-slate-800">AI Prompts</h2>
								<p className="text-xs text-slate-500">Configure AI behavior for each mode</p>
							</div>
						</div>
						<button
							onClick={onClose}
							disabled={isSaving}
							className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
						>
							<X size={20} className="text-slate-500" />
						</button>
					</div>
				</div>

				{/* Runtime explanation */}
				<div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
					<p className="text-xs text-blue-700">
						<span className="font-semibold">Run with prompts:</span>
						<span className="mx-1 px-1.5 py-0.5 bg-blue-100 rounded">System Prompt</span>
						<span className="text-blue-400">+</span>
						<span className="mx-1 px-1.5 py-0.5 bg-purple-100 rounded">{MODE_LABELS[activeMode].label} User Prompt</span>
						<span className="text-blue-400">+</span>
						<span className="mx-1 px-1.5 py-0.5 bg-green-100 rounded">Selected Text</span>
					</p>
				</div>

				{/* Content */}
				<div className="flex-1 p-6 overflow-auto">
					{isLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 size={24} className="animate-spin text-blue-500" />
						</div>
					) : prompts ? (
						<div className="space-y-5">
							{/* Shared System Prompt */}
							<div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
								<label className="block text-sm font-semibold text-blue-800 mb-2">
									System Prompt
									<span className="text-xs text-blue-500 ml-2 font-normal">(Shared across all modes)</span>
								</label>
								<textarea
									value={prompts.system}
									onChange={(e) => updateSystemPrompt(e.target.value)}
									placeholder="Enter system prompt..."
									className="w-full h-[120px] p-3 text-sm font-mono border border-blue-200 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
									disabled={isSaving}
								/>
							</div>

							{/* Mode Tabs */}
							<div>
								<div className="flex gap-1 mb-3 border-b border-slate-200">
									{(Object.entries(MODE_LABELS) as [AIMode, typeof MODE_LABELS[AIMode]][]).map(([mode, { label, icon }]) => (
										<button
											key={mode}
											onClick={() => setActiveMode(mode)}
											className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeMode === mode
												? 'text-blue-600 border-blue-500 bg-blue-50'
												: 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50'
												}`}
										>
											{icon}
											{label}
										</button>
									))}
								</div>

								{/* Mode User Prompt */}
								<div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
									<label className="block text-sm font-semibold text-purple-800 mb-2">
										{MODE_LABELS[activeMode].label} User Prompt
										<span className="text-xs text-purple-500 ml-2 font-normal">(Prepended to selected text)</span>
									</label>
									<textarea
										value={prompts[activeMode].user}
										onChange={(e) => updateModePrompt(activeMode, e.target.value)}
										placeholder={`Enter ${MODE_LABELS[activeMode].label.toLowerCase()} user prompt...`}
										className="w-full h-[150px] p-3 text-sm font-mono border border-purple-200 rounded-lg resize-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
										disabled={isSaving}
									/>
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
				<div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-between">
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
							className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium flex items-center gap-2"
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
