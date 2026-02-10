import OpenAI from 'openai';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PROJS_DIR = join(process.cwd(), 'projs');
const LLM_CONFIG_FILE = join(PROJS_DIR, 'llm-config.json');
const LLM_PROVIDERS_FILE = join(PROJS_DIR, 'llm-providers.json');

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// New: LLM Provider for multi-API management
export interface LLMProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  selectedModel: string;
  isActive: boolean;
  createdAt: number;
}

// Load config from file, fallback to environment variables
export function getLLMConfig(): LLMConfig {
  // First try to get from active provider
  const providers = getLLMProviders();
  const activeProvider = providers.find(p => p.isActive);
  if (activeProvider) {
    return {
      baseUrl: activeProvider.baseUrl,
      apiKey: activeProvider.apiKey,
      model: activeProvider.selectedModel
    };
  }

  // Fallback to legacy config file
  try {
    if (existsSync(LLM_CONFIG_FILE)) {
      const data = JSON.parse(readFileSync(LLM_CONFIG_FILE, 'utf-8'));
      return {
        baseUrl: data.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        apiKey: data.apiKey || process.env.OPENAI_API_KEY || '',
        model: data.model || process.env.OPENAI_MODEL || 'gpt-4o'
      };
    }
  } catch (error) {
    console.error('Failed to load LLM config:', error);
  }

  return {
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o'
  };
}

// Save config to file (legacy, for backward compatibility)
export function saveLLMConfig(config: Partial<LLMConfig>): boolean {
  try {
    if (!existsSync(PROJS_DIR)) {
      mkdirSync(PROJS_DIR, { recursive: true });
    }

    const currentConfig = getLLMConfig();
    const newConfig = {
      baseUrl: config.baseUrl ?? currentConfig.baseUrl,
      apiKey: config.apiKey ?? currentConfig.apiKey,
      model: config.model ?? currentConfig.model
    };

    writeFileSync(LLM_CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf-8');
    console.log(`Synced LLM config to ${LLM_CONFIG_FILE}: model=${newConfig.model}`);
    return true;
  } catch (error) {
    console.error('Failed to save LLM config:', error);
    return false;
  }
}

// ============ LLM Provider Management ============

// Load all providers
export function getLLMProviders(): LLMProvider[] {
  try {
    if (existsSync(LLM_PROVIDERS_FILE)) {
      const data = JSON.parse(readFileSync(LLM_PROVIDERS_FILE, 'utf-8'));
      return Array.isArray(data) ? data : [];
    }
  } catch (error) {
    console.error('Failed to load LLM providers:', error);
  }
  return [];
}

// Save all providers
function saveLLMProviders(providers: LLMProvider[]): boolean {
  try {
    if (!existsSync(PROJS_DIR)) {
      mkdirSync(PROJS_DIR, { recursive: true });
    }
    writeFileSync(LLM_PROVIDERS_FILE, JSON.stringify(providers, null, 2), 'utf-8');

    // Also sync the active provider to the legacy config file
    const activeProvider = providers.find(p => p.isActive);
    if (activeProvider) {
      saveLLMConfig({
        baseUrl: activeProvider.baseUrl,
        apiKey: activeProvider.apiKey, // Note: This might save masked key if not careful, but source is unmasked from getLLMProviders
        model: activeProvider.selectedModel
      });
    }

    return true;
  } catch (error) {
    console.error('Failed to save LLM providers:', error);
    return false;
  }
}

// Add or update a provider
export function saveLLMProvider(provider: LLMProvider): boolean {
  const providers = getLLMProviders();
  const existingIndex = providers.findIndex(p => p.id === provider.id);

  if (existingIndex >= 0) {
    // Check if API key is masked and restore original if so
    const existing = providers[existingIndex];
    if (existing && provider.apiKey && provider.apiKey.includes('...') && existing.apiKey) {
      const prefix = existing.apiKey.substring(0, 8);
      const suffix = existing.apiKey.substring(existing.apiKey.length - 4);
      const masked = `${prefix}...${suffix}`;

      // If the provided key matches the masked pattern of the existing key, keep the existing key
      if (provider.apiKey === masked) {
        console.log(`Restoring original API key for provider ${provider.name}`);
        provider.apiKey = existing.apiKey;
      }
    }
    if (existing) {
      providers[existingIndex] = provider;
    }
  } else {
    providers.push(provider);
  }

  return saveLLMProviders(providers);
}

// Delete a provider
export function deleteLLMProvider(id: string): boolean {
  const providers = getLLMProviders();
  const filtered = providers.filter(p => p.id !== id);

  // If deleted provider was active, activate another one
  if (filtered.length > 0 && !filtered.some(p => p.isActive) && filtered[0]) {
    filtered[0].isActive = true;
  }

  return saveLLMProviders(filtered);
}

// Set active provider
export function setActiveProvider(id: string): boolean {
  const providers = getLLMProviders();
  let found = false;

  for (const provider of providers) {
    if (provider.id === id) {
      provider.isActive = true;
      found = true;
    } else {
      provider.isActive = false;
    }
  }

  if (!found) return false;
  return saveLLMProviders(providers);
}

// Fetch models from OpenAI-compatible API
export async function fetchModelsFromAPI(baseUrl: string, apiKey: string): Promise<string[]> {
  try {
    const normalizedUrl = baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions\/?$/, '');
    const client = new OpenAI({
      apiKey,
      baseURL: normalizedUrl,
      timeout: 10000
    });

    const response = await client.models.list();
    const models: string[] = [];

    for await (const model of response) {
      models.push(model.id);
    }

    // Sort models alphabetically
    return models.sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.error('Failed to fetch models:', error);
    throw error;
  }
}

export type AIMode = 'diagnose' | 'refine' | 'quickfix';

export interface AIRequest {
  mode: AIMode;
  content: string;
  systemPrompt?: string;
  userPrompt?: string;
  history?: { role: 'user' | 'ai'; content: string }[];
}

const DEFAULT_PROMPTS: Record<AIMode, { system: string; user: string }> = {
  diagnose: {
    system: `You are an expert academic writing reviewer for top-tier computer science conferences (IEEE S&P, USENIX Security, OSDI, CCS).

Your goal is to analyze and discuss the paper's structure, logic flow, and argumentation.

Provide constructive feedback on:
1. Logical flow and argumentation structure
2. Whether the problem statement clearly articulates tensions or trade-offs
3. Clarity of the main contributions
4. Any structural issues or missing elements

Be specific and constructive. Point out both strengths and areas for improvement.`,
    user: 'Please analyze and diagnose the following text. Discuss the structure, logic flow, and identify any issues with clarity or argumentation. Provide specific and constructive feedback.'
  },
  refine: {
    system: `You are a strict and professional academic editor for top-tier computer security and systems conferences (IEEE S&P, USENIX Security, OSDI, CCS). Your goal is to refine the text to meet high publication standards.

**Task:** Rewrite and polish the text to make it **concise, precise, and authoritative**.

**Style Guidelines (Strictly Follow):**

1. **Conciseness & High Information Density:**
   - Eliminate all filler words and redundant adjectives (remove "very," "extremely," "successfully")
   - Every sentence must convey new information
   - Use **Active Voice** (e.g., "The system validates" not "The data is validated by")

2. **Authoritative & Direct Tone:**
   - Use strong, specific verbs (enforce, guarantee, mitigate, isolate, decouple, orchestrate)
   - Avoid hedging (no "we try to," "it seems that"). Be confident: "We demonstrate," "We present"
   - When describing your work, use "We + Verb"

3. **Logical Flow & Signposting:**
   - Use logical connectors: In contrast, Conversely, Consequently, Specifically, To address this...
   - Ensure problem statements show clear **tension** or **trade-off**

4. **Terminological Precision:**
   - Use technical terms consistently
   - Distinguish between actors (Attacker vs. User vs. Developer)
   - Avoid vague pronouns - repeat nouns when ambiguous

5. **Quantitative over Qualitative:**
   - Prefer "reduces overhead by 5x" over "greatly reduces"
   - Prefer "negligible impact (<1%)" over "very fast"

Return ONLY the refined text without any explanations.`,
    user: 'Please refine the following text. Improve clarity, structure, eliminate redundancy, and enhance academic writing quality. Return only the refined text.'
  },
  quickfix: {
    system: `You are a grammar and style checker for academic writing.
Fix ONLY:
- Grammar errors
- Spelling mistakes
- Punctuation issues
- Syntax errors

Do NOT:
- Change the meaning or structure
- Rephrase sentences
- Add or remove content
- Modify technical terms

Return only the corrected text with minimal changes.`,
    user: 'Please fix any grammar, spelling, punctuation, or syntax errors in the following text. Do not change the meaning or structure. Return only the corrected text.'
  }
};

// Export for use by API endpoints
export { DEFAULT_PROMPTS };

// Project-specific prompts type - shared system + mode user prompts
export interface ProjectPrompts {
  system: string; // Shared system prompt for all modes
  diagnose: { user: string };
  refine: { user: string };
  quickfix: { user: string };
}

// Default shared system prompt
const DEFAULT_SHARED_SYSTEM = `**System Role:**
You are a strict and professional academic editor and reviewer for top-tier computer security and systems conferences (such as IEEE S&P, USENIX Security, OSDI, CCS). Your goal is to refine the user's draft to meet the high standards of these venues, specifically mimicking the writing style of high-quality systems papers (e.g., the "bpftime" OSDI'25 paper).

**Task:**
Rewrite and polish the provided text. The goal is to make it **concise, precise, and authoritative**.

**Style Guidelines (Strictly Follow These):**

1. **Conciseness & Density (High Information Density):**
    - Eliminate all "fluff," filler words, and redundant adjectives (e.g., remove "very," "extremely," "successfully").
    - Every sentence must convey new information or a necessary logical step.
    - Avoid long-winded passive constructions. Use **Active Voice** whenever possible (e.g., Change "The data is validated by the system" to "The system validates the data").

2. **Authoritative & Direct Tone:**
    - Use strong, specific verbs (e.g., _enforce, guarantee, mitigate, isolate, decouple, orchestrate_).
    - Avoid hedging or weak language (e.g., avoid "we try to," "it seems that"). Be confident in the contributions (e.g., "We demonstrate," "We present").
    - When describing your own work, use "We + Verb" (e.g., "We introduce EIM...").

3. **Logical Flow & Signposting:**
    - Use logical connectors to guide the reader's thinking, similar to a mathematical proof.
    - Use phrases like: _In contrast, Conversely, Consequently, Specifically, To address this challenge, On the one hand... On the other hand..._
    - Ensure the problem statement clearly articulates the **tension** or **trade-off** (e.g., "Safety vs. Efficiency").

4. **Terminological Precision:**
    - Ensure technical terms are used consistently.
    - Distinguish clearly between actors (e.g., "Attacker" vs. "User" vs. "Developer").
    - Avoid vague pronouns. If "it" is ambiguous, repeat the noun.

5. **Quantitative over Qualitative:**
    - Prefer "reduces overhead by 5x" over "greatly reduces overhead."
    - Prefer "negligible performance impact (<1%)" over "very fast."

**Example of Style Transformation:**

- _Bad (Draft):_ "We made a new system called X that is very good at stopping attacks. It is better than Y because Y is slow. X uses a cool technique to check memory."
- _Good (Target Style):_ "We present X, a system that enforces memory safety with negligible overhead. Unlike Y, which relies on slow context switches, X employs lightweight in-process isolation to mitigate attacks efficiently."`;

// Get project prompts (returns project-specific or defaults)
export function getProjectPrompts(projectId: string): ProjectPrompts {
  const promptsFile = join(PROJS_DIR, projectId, 'prompts.json');

  try {
    if (existsSync(promptsFile)) {
      const data = JSON.parse(readFileSync(promptsFile, 'utf-8'));
      // Support both old and new format
      return {
        system: data.system || DEFAULT_SHARED_SYSTEM,
        diagnose: { user: data.diagnose?.user || DEFAULT_PROMPTS.diagnose.user },
        refine: { user: data.refine?.user || DEFAULT_PROMPTS.refine.user },
        quickfix: { user: data.quickfix?.user || DEFAULT_PROMPTS.quickfix.user }
      };
    }
  } catch (error) {
    console.error('Failed to load project prompts:', error);
  }

  return {
    system: DEFAULT_SHARED_SYSTEM,
    diagnose: { user: DEFAULT_PROMPTS.diagnose.user },
    refine: { user: DEFAULT_PROMPTS.refine.user },
    quickfix: { user: DEFAULT_PROMPTS.quickfix.user }
  };
}

// Save project prompts
export function saveProjectPrompts(projectId: string, prompts: Partial<ProjectPrompts>): boolean {
  const projectDir = join(PROJS_DIR, projectId);
  const promptsFile = join(projectDir, 'prompts.json');

  try {
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }

    // Merge with existing prompts
    const current = getProjectPrompts(projectId);
    const merged = {
      system: prompts.system ?? current.system,
      diagnose: { user: prompts.diagnose?.user ?? current.diagnose.user },
      refine: { user: prompts.refine?.user ?? current.refine.user },
      quickfix: { user: prompts.quickfix?.user ?? current.quickfix.user }
    };

    writeFileSync(promptsFile, JSON.stringify(merged, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Failed to save project prompts:', error);
    return false;
  }
}

// Export default shared system prompt for reset
export { DEFAULT_SHARED_SYSTEM };

export async function processWithAI(request: AIRequest): Promise<{ content: string; model: string }> {
  const config = getLLMConfig();

  if (!config.apiKey) {
    throw new Error('API key not configured. Please set up your LLM API key in Settings.');
  }

  const baseURL = config.baseUrl.replace(/\/chat\/completions\/?$/, '');
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL,
    timeout: 30000 // Increased timeout for long content
  });

  const systemPrompt = request.systemPrompt || DEFAULT_PROMPTS[request.mode].system;
  const userContent = `${request.userPrompt || DEFAULT_PROMPTS[request.mode].user}\n\n${request.content}`;

  const historyMessages = request.history?.map(m => ({
    role: m.role === 'ai' ? 'assistant' : 'user',
    content: m.content
  })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[] || [];

  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: userContent }
      ],
      temperature: request.mode === 'quickfix' ? 0.1 : 0.3,
      max_tokens: 4000
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('AI API returned empty content');
    }

    return {
      content: stripMarkdownCodeFences(content),
      model: config.model
    };
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      throw new Error(`API error ${error.status}: ${error.message}`);
    }
    throw error;
  }
}

function stripMarkdownCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^\s*```[\w-]*\s*\n([\s\S]*?)\n```\s*$/);
  return (match?.[1] ?? trimmed).trim();
}

export async function loadAICache(projectPath: string): Promise<Record<string, any[]>> {
  try {
    const cachePath = join(projectPath, '.fastwrite', 'ai-cache.json');
    if (!existsSync(cachePath)) return {};
    const content = await Bun.file(cachePath).text();
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to load AI cache:', error);
    return {};
  }
}

export async function saveAICache(projectPath: string, cache: Record<string, any[]>) {
  try {
    const dir = join(projectPath, '.fastwrite');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const cachePath = join(projectPath, '.fastwrite', 'ai-cache.json');
    await Bun.write(cachePath, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('Failed to save AI cache:', e);
  }
}
