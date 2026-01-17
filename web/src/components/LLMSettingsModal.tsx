import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Key, Server, Bot, Eye, EyeOff, Loader2, CheckCircle, AlertCircle, Zap, Plus, Trash2, RefreshCw, Check } from 'lucide-react';
import type { LLMProvider } from '../types';

interface LLMSettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
}

const LLMSettingsModal: React.FC<LLMSettingsModalProps> = ({ isOpen, onClose }) => {
	const [providers, setProviders] = useState<LLMProvider[]>([]);
	const [selectedProvider, setSelectedProvider] = useState<LLMProvider | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [isFetchingModels, setIsFetchingModels] = useState(false);
	const [showApiKey, setShowApiKey] = useState(false);
	const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
	const [statusMessage, setStatusMessage] = useState('');

	// Form state for editing
	const [editName, setEditName] = useState('');
	const [editBaseUrl, setEditBaseUrl] = useState('');
	const [editApiKey, setEditApiKey] = useState('');
	const [editModels, setEditModels] = useState<string[]>([]);
	const [editSelectedModel, setEditSelectedModel] = useState('');

	useEffect(() => {
		if (isOpen) {
			loadProviders();
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

	const loadProviders = async () => {
		setIsLoading(true);
		try {
			const response = await fetch('/api/llm-providers');
			if (response.ok) {
				const data = await response.json();
				setProviders(data);
				// Select first provider by default
				if (data.length > 0 && !selectedProvider) {
					selectProvider(data[0]);
				}
			}
		} catch (error) {
			console.error('Failed to load providers:', error);
		} finally {
			setIsLoading(false);
		}
	};

	const selectProvider = (provider: LLMProvider) => {
		setSelectedProvider(provider);
		setEditName(provider.name);
		setEditBaseUrl(provider.baseUrl);
		setEditApiKey(''); // Don't show masked key, allow entering new one
		setEditModels(provider.models || []);
		setEditSelectedModel(provider.selectedModel || '');
		setStatus('idle');
		setStatusMessage('');
	};

	const handleAddProvider = () => {
		const newProvider: LLMProvider = {
			id: `provider_${Date.now()}`,
			name: 'New Provider',
			baseUrl: 'https://api.openai.com/v1',
			apiKey: '',
			models: [],
			selectedModel: '',
			isActive: providers.length === 0,
			createdAt: Date.now()
		};
		setProviders([...providers, newProvider]);
		selectProvider(newProvider);
	};

	const handleDeleteProvider = async (id: string) => {
		if (!confirm('Delete this provider?')) return;
		try {
			await fetch(`/api/llm-providers/${id}`, { method: 'DELETE' });
			const remaining = providers.filter(p => p.id !== id);
			setProviders(remaining);
			if (selectedProvider?.id === id) {
				setSelectedProvider(remaining[0] || null);
				if (remaining[0]) selectProvider(remaining[0]);
			}
		} catch (error) {
			console.error('Failed to delete provider:', error);
		}
	};

	const handleFetchModels = async () => {
		if (!editBaseUrl || !editApiKey) {
			setStatus('error');
			setStatusMessage('API URL and Key are required to fetch models');
			return;
		}

		setIsFetchingModels(true);
		setStatus('idle');
		try {
			const response = await fetch('/api/llm-providers/fetch-models', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ baseUrl: editBaseUrl, apiKey: editApiKey })
			});
			const data = await response.json();
			if (data.models) {
				setEditModels(data.models);
				if (data.models.length > 0 && !editSelectedModel) {
					setEditSelectedModel(data.models[0]);
				}
				setStatus('success');
				setStatusMessage(`Found ${data.models.length} models`);
			} else {
				setStatus('error');
				setStatusMessage(data.error || 'Failed to fetch models');
			}
		} catch (error) {
			setStatus('error');
			setStatusMessage('Network error');
		} finally {
			setIsFetchingModels(false);
		}
	};

	const handleSave = async () => {
		if (!selectedProvider) return;
		if (!editName.trim() || !editBaseUrl.trim()) {
			setStatus('error');
			setStatusMessage('Name and Base URL are required');
			return;
		}

		setIsSaving(true);
		setStatus('testing');
		setStatusMessage('Testing connection...');

		try {
			// Test connection first
			const testResponse = await fetch('/api/llm-config/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					baseUrl: editBaseUrl,
					apiKey: editApiKey || selectedProvider.apiKey,
					model: editSelectedModel || 'gpt-4o'
				})
			});
			const testData = await testResponse.json();

			if (!testData.success) {
				setStatus('error');
				setStatusMessage(testData.error || 'Connection test failed');
				setIsSaving(false);
				return;
			}

			// Save provider
			const updatedProvider: LLMProvider = {
				...selectedProvider,
				name: editName.trim(),
				baseUrl: editBaseUrl.trim(),
				apiKey: editApiKey || selectedProvider.apiKey,
				models: editModels,
				selectedModel: editSelectedModel
			};

			const saveResponse = await fetch('/api/llm-providers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updatedProvider)
			});

			if (saveResponse.ok) {
				setStatus('success');
				setStatusMessage('Saved successfully!');

				// Reload providers
				await loadProviders();

				// Auto-close after success
				setTimeout(() => onClose(), 1000);
			} else {
				setStatus('error');
				setStatusMessage('Failed to save');
			}
		} catch (error) {
			setStatus('error');
			setStatusMessage(error instanceof Error ? error.message : 'Save failed');
		} finally {
			setIsSaving(false);
		}
	};

	const handleActivate = async (id: string) => {
		try {
			await fetch(`/api/llm-providers/${id}/activate`, { method: 'POST' });
			await loadProviders();
		} catch (error) {
			console.error('Failed to activate provider:', error);
		}
	};

	if (!isOpen) return null;

	const getStatusColor = () => {
		switch (status) {
			case 'testing': return 'bg-blue-50 border-blue-200 text-blue-700';
			case 'success': return 'bg-green-50 border-green-200 text-green-700';
			case 'error': return 'bg-red-50 border-red-200 text-red-700';
			default: return '';
		}
	};

	const getStatusIcon = () => {
		switch (status) {
			case 'testing': return <Loader2 size={16} className="animate-spin" />;
			case 'success': return <CheckCircle size={16} />;
			case 'error': return <AlertCircle size={16} />;
			default: return null;
		}
	};

	return createPortal(
		<div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[600px] flex overflow-hidden">
				{/* Left Panel: Provider List */}
				<div className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col">
					<div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
						<h3 className="font-semibold text-slate-700 text-sm">Providers</h3>
						<button
							onClick={handleAddProvider}
							className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors text-slate-600"
							title="Add Provider"
						>
							<Plus size={18} />
						</button>
					</div>

					<div className="flex-1 overflow-y-auto p-2 space-y-1">
						{isLoading ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 size={24} className="animate-spin text-blue-500" />
							</div>
						) : providers.length === 0 ? (
							<div className="text-center text-slate-400 text-sm py-8">
								No providers yet.<br />Click + to add one.
							</div>
						) : (
							providers.map(provider => (
								<div
									key={provider.id}
									onClick={() => selectProvider(provider)}
									className={`p-3 rounded-lg cursor-pointer transition-all ${selectedProvider?.id === provider.id
										? 'bg-white border-2 border-blue-500 shadow-sm'
										: 'bg-white border border-slate-200 hover:border-slate-300'
										}`}
								>
									<div className="flex items-center justify-between mb-1">
										<span className="font-medium text-slate-800 text-sm truncate flex-1">
											{provider.name}
										</span>
										<div className="flex items-center gap-1">
											{provider.isActive && (
												<span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] font-medium rounded">
													Active
												</span>
											)}
										</div>
									</div>
									<div className="text-xs text-slate-500 truncate">
										{provider.selectedModel || 'No model selected'}
									</div>
								</div>
							))
						)}
					</div>
				</div>

				{/* Right Panel: Editor */}
				<div className="flex-1 flex flex-col">
					{/* Header */}
					<div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-purple-50 to-blue-50">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div className="p-2 bg-purple-100 rounded-lg">
									<Bot size={20} className="text-purple-600" />
								</div>
								<div>
									<h2 className="text-lg font-bold text-slate-800">LLM Settings</h2>
									<p className="text-xs text-slate-500">Configure your AI providers</p>
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
					<div className="flex-1 overflow-y-auto p-6 space-y-5">
						{!selectedProvider ? (
							<div className="flex flex-col items-center justify-center h-full text-slate-400">
								<Bot size={48} className="mb-4 text-slate-200" />
								<p>Select or add a provider</p>
							</div>
						) : (
							<>
								{/* Provider Name */}
								<div>
									<label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
										<Bot size={16} className="text-slate-400" />
										Provider Name
									</label>
									<input
										type="text"
										value={editName}
										onChange={(e) => setEditName(e.target.value)}
										placeholder="OpenAI"
										disabled={isSaving}
										className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm disabled:bg-slate-50"
									/>
								</div>

								{/* API Base URL */}
								<div>
									<label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
										<Server size={16} className="text-slate-400" />
										API Base URL
									</label>
									<input
										type="text"
										value={editBaseUrl}
										onChange={(e) => setEditBaseUrl(e.target.value)}
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
									{selectedProvider.apiKey && !editApiKey && (
										<div className="mb-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
											<CheckCircle size={14} className="text-green-600" />
											<span className="text-sm text-green-700">Key saved (enter new to replace)</span>
										</div>
									)}
									<div className="relative">
										<input
											type={showApiKey ? 'text' : 'password'}
											value={editApiKey}
											onChange={(e) => setEditApiKey(e.target.value)}
											placeholder={selectedProvider.apiKey ? 'Enter new key to replace...' : 'sk-...'}
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

								{/* Model Selection */}
								<div>
									<label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
										<Bot size={16} className="text-slate-400" />
										Model
									</label>
									<div className="flex gap-2">
										<select
											value={editSelectedModel}
											onChange={(e) => setEditSelectedModel(e.target.value)}
											disabled={isSaving}
											className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm disabled:bg-slate-50"
										>
											{editModels.length === 0 ? (
												<option value="">Click Fetch to load models</option>
											) : (
												editModels.map(model => (
													<option key={model} value={model}>{model}</option>
												))
											)}
										</select>
										<button
											onClick={handleFetchModels}
											disabled={isSaving || isFetchingModels}
											className="px-4 py-2.5 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2 text-sm disabled:opacity-50"
											title="Fetch available models from API"
										>
											{isFetchingModels ? (
												<Loader2 size={16} className="animate-spin" />
											) : (
												<RefreshCw size={16} />
											)}
											Fetch
										</button>
									</div>
									<p className="mt-1 text-xs text-slate-500">
										Enter API key first, then click Fetch to load available models
									</p>
								</div>

								{/* Status Message */}
								{status !== 'idle' && (
									<div className={`flex items-center gap-2 px-4 py-3 border rounded-lg text-sm ${getStatusColor()}`}>
										{getStatusIcon()}
										{statusMessage}
									</div>
								)}

								{/* Actions */}
								<div className="flex items-center justify-between pt-4 border-t border-slate-200">
									<div className="flex items-center gap-2">
										{!selectedProvider.isActive && (
											<button
												onClick={() => handleActivate(selectedProvider.id)}
												className="px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1"
											>
												<Check size={14} />
												Set Active
											</button>
										)}
										<button
											onClick={() => handleDeleteProvider(selectedProvider.id)}
											className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1"
											disabled={isSaving}
										>
											<Trash2 size={14} />
											Delete
										</button>
									</div>
									<div className="flex items-center gap-3">
										<button
											onClick={onClose}
											disabled={isSaving}
											className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors text-sm font-medium disabled:opacity-50"
										>
											Cancel
										</button>
										<button
											onClick={handleSave}
											disabled={isSaving || !editName.trim() || !editBaseUrl.trim() || (!editApiKey && !selectedProvider.apiKey)}
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
							</>
						)}
					</div>
				</div>
			</div>
		</div>,
		document.body
	);
};

export default LLMSettingsModal;
