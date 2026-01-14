import OpenAI from 'openai';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PROJS_DIR = join(process.cwd(), 'projs');
const LLM_CONFIG_FILE = join(PROJS_DIR, 'llm-config.json');

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// Load config from file, fallback to environment variables
export function getLLMConfig(): LLMConfig {
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

// Save config to file
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
    return true;
  } catch (error) {
    console.error('Failed to save LLM config:', error);
    return false;
  }
}

export type AIMode = 'diagnose' | 'refine' | 'quickfix';

export interface AIRequest {
  mode: AIMode;
  content: string;
  systemPrompt?: string;
  userPrompt?: string;
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

export async function processWithAI(request: AIRequest): Promise<string> {
  const config = getLLMConfig();

  if (!config.apiKey) {
    throw new Error('API key not configured. Please set up your LLM API key in Settings.');
  }

  const baseURL = config.baseUrl.replace(/\/chat\/completions\/?$/, '');
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL
  });

  const systemPrompt = request.systemPrompt || DEFAULT_PROMPTS[request.mode].system;
  const userContent = `${request.userPrompt || DEFAULT_PROMPTS[request.mode].user}\n\n${request.content}`;

  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: request.mode === 'quickfix' ? 0.1 : 0.3,
      max_tokens: 4000
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('AI API returned empty content');
    }

    return stripMarkdownCodeFences(content);
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
