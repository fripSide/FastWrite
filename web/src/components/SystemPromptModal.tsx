import React, { useState, useEffect } from 'react';
import { X, FileText, Save, Loader2, CheckCircle } from 'lucide-react';
import { api } from '../api';

interface SystemPromptModalProps {
	isOpen: boolean;
	projectId: string;
	onClose: () => void;
}

const DEFAULT_SYSTEM_PROMPT = `**System Role:**  
You are a strict and professional academic editor and reviewer for top-tier computer security and systems conferences (such as IEEE S&P, USENIX Security, OSDI, CCS). Your goal is to refine the user's draft to meet the high standards of these venues, specifically mimicking the writing style of high-quality systems papers (e.g., the "bpftime" OSDI'25 paper).

**Task:**  
Rewrite and polish the provided text. The goal is to make it **concise, precise, and authoritative**.

**Style Guidelines (Strictly Follow These):**

1. **Conciseness & Density (High Information Density):**
    - Eliminate all "fluff," filler words, and redundant adjectives (e.g., remove "very," "extremely," "successfully").
    - Every sentence must convey new information or a necessary logical step.
    - Avoid long-winded passive constructions. Use **Active Voice** whenever possible.

2. **Authoritative & Direct Tone:**
    - Use strong, specific verbs (e.g., enforce, guarantee, mitigate, isolate, decouple, orchestrate).
    - Avoid hedging or weak language (e.g., avoid "we try to," "it seems that"). Be confident: "We demonstrate," "We present".
    - When describing your own work, use "We + Verb".

3. **Logical Flow & Signposting:**
    - Use logical connectors: In contrast, Conversely, Consequently, Specifically, To address this challenge...
    - Ensure the problem statement clearly articulates the **tension** or **trade-off**.

4. **Terminological Precision:**
    - Ensure technical terms are used consistently.
    - Distinguish clearly between actors (e.g., "Attacker" vs. "User" vs. "Developer").
    - Avoid vague pronouns. If "it" is ambiguous, repeat the noun.

5. **Quantitative over Qualitative:**
    - Prefer "reduces overhead by 5x" over "greatly reduces overhead."
    - Prefer "negligible performance impact (<1%)" over "very fast."

Here are the draft:`;

const SystemPromptModal: React.FC<SystemPromptModalProps> = ({ isOpen, projectId, onClose }) => {
	const [content, setContent] = useState('');
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
			loadPrompt();
		}
	}, [isOpen, projectId]);

	const loadPrompt = async () => {
		setIsLoading(true);
		try {
			const promptContent = await api.getSystemPrompt(projectId);
			// Use default if no saved prompt
			setContent(promptContent || DEFAULT_SYSTEM_PROMPT);
		} catch (error) {
			console.error('Failed to load system prompt:', error);
			setContent(DEFAULT_SYSTEM_PROMPT);
		} finally {
			setIsLoading(false);
		}
	};

	const handleSave = async () => {
		setIsSaving(true);
		try {
			await api.saveSystemPrompt(projectId, content);
			setSaved(true);
			setTimeout(() => {
				setSaved(false);
				onClose();
			}, 800);
		} catch (error) {
			console.error('Failed to save system prompt:', error);
		} finally {
			setIsSaving(false);
		}
	};

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
				{/* Header */}
				<div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-amber-50 to-orange-50">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="p-2 bg-amber-100 rounded-lg">
								<FileText size={20} className="text-amber-600" />
							</div>
							<div>
								<h2 className="text-lg font-bold text-slate-800">System Prompt</h2>
								<p className="text-xs text-slate-500">Configure AI behavior for this project</p>
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

				{/* Content */}
				<div className="flex-1 p-6 overflow-auto">
					{isLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 size={24} className="animate-spin text-blue-500" />
						</div>
					) : (
						<div className="h-full">
							<p className="text-sm text-slate-600 mb-3">
								This prompt will be prepended to all AI requests for this project. Use it to set context, style guidelines, or specific instructions.
							</p>
							<textarea
								value={content}
								onChange={(e) => setContent(e.target.value)}
								placeholder="Enter your system prompt here..."
								className="w-full h-[400px] p-4 text-sm font-mono border border-slate-200 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
								disabled={isSaving}
							/>
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
					<button
						onClick={onClose}
						disabled={isSaving}
						className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors text-sm font-medium disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						onClick={handleSave}
						disabled={isSaving || isLoading}
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
								Save
							</>
						)}
					</button>
				</div>
			</div>
		</div>
	);
};

export default SystemPromptModal;
