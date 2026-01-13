import OpenAI from 'openai';

const API_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const API_KEY = process.env.OPENAI_API_KEY || '';
const API_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

export type AIMode = 'diagnose' | 'refine' | 'quickfix';

export interface AIRequest {
  mode: AIMode;
  content: string;
  systemPrompt?: string;
  userPrompt?: string;
}

const DEFAULT_PROMPTS: Record<AIMode, { system: string; user: string }> = {
  diagnose: {
    system: 'You are an expert academic writing reviewer. Analyze the writing logic, structure, and clarity. Provide constructive feedback on logical flow, argumentation, and clarity.',
    user: 'Please diagnose the following text. Identify any logical issues, structural problems, or clarity concerns. Be specific and constructive.'
  },
  refine: {
    system: 'You are a professional academic editor specializing in computer science and systems papers. Refine and improve the writing while maintaining the original meaning and technical accuracy. Focus on clarity, precision, and academic tone.',
    user: 'Please refine the following text. Improve clarity, flow, and academic tone while preserving the core message and technical accuracy. Return only the refined text without explanations.'
  },
  quickfix: {
    system: 'You are a grammar and style checker. Fix basic grammar, spelling, punctuation, and syntax errors. Do not change the meaning or structure.',
    user: 'Please fix any grammar, spelling, punctuation, or syntax errors in the following text. Return only the corrected text.'
  }
};

export async function processWithAI(request: AIRequest): Promise<string> {
  if (!API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  const baseURL = API_BASE_URL.replace(/\/chat\/completions\/?$/, '');
  const client = new OpenAI({
    apiKey: API_KEY,
    baseURL
  });

  const systemPrompt = request.systemPrompt || DEFAULT_PROMPTS[request.mode].system;
  const userContent = `${request.userPrompt || DEFAULT_PROMPTS[request.mode].user}\n\n${request.content}`;

  try {
    const response = await client.chat.completions.create({
      model: API_MODEL,
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
