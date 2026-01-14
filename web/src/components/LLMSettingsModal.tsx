import React, { useState, useEffect } from 'react';
import { X, Key, Server, Bot, Eye, EyeOff, Loader2, CheckCircle, AlertCircle, Zap } from 'lucide-react';

interface LLMConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
	hasApiKey: boolean;
}

interface LLMSettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
}

const LLMSettingsModal: React.FC<LLMSettingsModalProps> = ({ isOpen, onClose }) => {
	const [config, setConfig] = useState<LLMConfig>({
		baseUrl: 'https://api.openai.com/v1',
		apiKey: '',
		model: 'gpt-4o',
		hasApiKey: false
	});
	const [newApiKey, setNewApiKey] = useState('');
	const [showApiKey, setShowApiKey] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [status, setStatus] = useState<'idle' | 'testing' | 'test-success' | 'test-error' | 'saving' | 'saved'>('idle');
	const [statusMessage, setStatusMessage] = useState('');

	useEffect(() => {
		if (isOpen) {
			loadConfig();
			setStatus('idle');
			setStatusMessage('');
		}
	}, [isOpen]);

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

	const loadConfig = async () => {
		setIsLoading(true);
		try {
			const response = await fetch('/api/llm-config');
			if (response.ok) {
				const data = await response.json();
				setConfig(data);
				setNewApiKey('');
			}
		} catch (error) {
			console.error('Failed to load LLM config:', error);
		} finally {
			setIsLoading(false);
		}
	};

	const testConnection = async (): Promise<boolean> => {
		const testConfig = {
			baseUrl: config.baseUrl,
			apiKey: newApiKey.trim() || config.apiKey, // Use new key if provided, else existing
			model: config.model
		};

		const response = await fetch('/api/llm-config/test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(testConfig)
		});

		const data = await response.json();
		if (data.success) {
			setStatusMessage(data.message || 'Connection successful');
			return true;
		} else {
			throw new Error(data.error || 'Connection failed');
		}
	};

	const handleSave = async () => {
		setIsSaving(true);
		setStatus('testing');
		setStatusMessage('Testing connection...');

		try {
			// Step 1: Test connection
			await testConnection();
			setStatus('test-success');
			setStatusMessage('Connection verified!');

			// Short delay to show success
			await new Promise(resolve => setTimeout(resolve, 800));

			// Step 2: Save config
			setStatus('saving');
			setStatusMessage('Saving settings...');

			const updateData: { baseUrl?: string; apiKey?: string; model?: string } = {
				baseUrl: config.baseUrl,
				model: config.model
			};

			if (newApiKey.trim()) {
				updateData.apiKey = newApiKey.trim();
			}

			const response = await fetch('/api/llm-config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updateData)
			});

			if (response.ok) {
				setStatus('saved');
				setStatusMessage('Settings saved successfully!');

				// Auto-close after showing success
				setTimeout(() => {
					onClose();
				}, 1000);
			} else {
				const data = await response.json();
				throw new Error(data.error || 'Failed to save');
			}
		} catch (error) {
			setStatus('test-error');
			setStatusMessage(error instanceof Error ? error.message : 'Operation failed');
		} finally {
			setIsSaving(false);
		}
	};

	if (!isOpen) return null;

	const getStatusColor = () => {
		switch (status) {
			case 'testing':
			case 'saving':
				return 'bg-blue-50 border-blue-200 text-blue-700';
			case 'test-success':
			case 'saved':
				return 'bg-green-50 border-green-200 text-green-700';
			case 'test-error':
				return 'bg-red-50 border-red-200 text-red-700';
			default:
				return '';
		}
	};

	const getStatusIcon = () => {
		switch (status) {
			case 'testing':
			case 'saving':
				return <Loader2 size={16} className="animate-spin" />;
			case 'test-success':
			case 'saved':
				return <CheckCircle size={16} />;
			case 'test-error':
				return <AlertCircle size={16} />;
			default:
				return null;
		}
	};

	return (
		<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
				{/* Header */}
				<div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-purple-50 to-blue-50">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="p-2 bg-purple-100 rounded-lg">
								<Bot size={20} className="text-purple-600" />
							</div>
							<div>
								<h2 className="text-lg font-bold text-slate-800">LLM Settings</h2>
								<p className="text-xs text-slate-500">Configure your AI provider</p>
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
				<div className="p-6 space-y-5">
					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<Loader2 size={24} className="animate-spin text-blue-500" />
						</div>
					) : (
						<>
							{/* API Base URL */}
							<div>
								<label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
									<Server size={16} className="text-slate-400" />
									API Base URL
								</label>
								<input
									type="text"
									value={config.baseUrl}
									onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
									placeholder="https://api.openai.com/v1"
									disabled={isSaving}
									className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm disabled:bg-slate-50"
								/>
							</div>

							{/* API Key */}
							<div>
								<label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
									<Key size={16} className="text-slate-400" />
									API Key
								</label>
								{config.hasApiKey && (
									<div className="mb-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
										<CheckCircle size={14} className="text-green-600" />
										<span className="text-sm text-green-700">Current: {config.apiKey}</span>
									</div>
								)}
								<div className="relative">
									<input
										type={showApiKey ? 'text' : 'password'}
										value={newApiKey}
										onChange={(e) => setNewApiKey(e.target.value)}
										placeholder={config.hasApiKey ? 'Enter new key to replace...' : 'sk-...'}
										disabled={isSaving}
										className="w-full px-4 py-2.5 pr-12 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono disabled:bg-slate-50"
									/>
									<button
										type="button"
										onClick={() => setShowApiKey(!showApiKey)}
										className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
									>
										{showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
									</button>
								</div>
							</div>

							{/* Model */}
							<div>
								<label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
									<Bot size={16} className="text-slate-400" />
									Model
								</label>
								<input
									type="text"
									value={config.model}
									onChange={(e) => setConfig({ ...config, model: e.target.value })}
									placeholder="gpt-4o"
									disabled={isSaving}
									className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm disabled:bg-slate-50"
								/>
							</div>

							{/* Status Message */}
							{status !== 'idle' && (
								<div className={`flex items-center gap-2 px-4 py-3 border rounded-lg text-sm ${getStatusColor()}`}>
									{getStatusIcon()}
									{statusMessage}
								</div>
							)}
						</>
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
						disabled={isSaving || isLoading || (!newApiKey.trim() && !config.hasApiKey)}
						className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium flex items-center gap-2"
					>
						{isSaving ? (
							<>
								<Loader2 size={16} className="animate-spin" />
								{status === 'testing' ? 'Testing...' : 'Saving...'}
							</>
						) : (
							<>
								<Zap size={16} />
								Test & Save
							</>
						)}
					</button>
				</div>
			</div>
		</div>
	);
};

export default LLMSettingsModal;
