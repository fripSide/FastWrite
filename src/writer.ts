import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { spawn } from "node:child_process";
import { basename, join } from "node:path";
import OpenAI from "openai";
import { API_BASE_URL, API_KEY, API_MODEL } from "./config.js";
import { escapeHtml, generateSentenceDiff, splitIntoSentences } from "./diffUtils.js";
import { loadProjectConfig, type ProjectConfig } from "./projectConfig.js";
import type { SectionFile } from "./types.js";

/**
 * Default system prompt embedded at build time.
 * Users can customize by editing `proj/system.md`.
 */
export const DEFAULT_SYSTEM_PROMPT = `**System Role:**  
You are a strict and professional academic editor and reviewer for top-tier computer security and systems conferences (such as IEEE S&P, USENIX Security, OSDI, CCS). Your goal is to refine the user's draft to meet the high standards of these venues, specifically mimicking the writing style of high-quality systems papers (e.g., the OSDI paper and top-4 security papers).

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

6. **Support for LaTeX Formatting and Special Character Escaping:**

    - Fully support and preserve all LaTeX syntax and symbols to ensure that mathematical expressions, Greek letters, and other LaTeX features are formatted correctly.
    - Automatically escape special LaTeX characters (such as %, $, &, #, _, {, }, ~, ^, and \\) as needed to prevent compilation errors. Example: Plain text 100% should be automatically converted to 100\\%, and _var should be converted to \\_var.

7. **Clarity in Sentence Structure and Minimal Use of Dashes or Colons:**
    - Express each technical idea in a single, well-constructed sentence. Use explicit logical connectors between concepts rather than linking multiple points with dashes or colons. This approach enhances readability and eliminates ambiguity.


**Example of Style Transformation:**

- _Bad (Draft):_ "We made a new system called X that is very good at stopping attacks. It is better than Y because Y is slow. X uses a cool technique to check memory."
- _Good (Target Style):_ "We present X, a system that enforces memory safety with negligible overhead. Unlike Y, which relies on slow context switches, X employs lightweight in-process isolation to mitigate attacks efficiently."

Here are the draft:`;

export class AcademicWritingHelper {
  private systemPrompt = "";
  private projectName: string | null = null;
  private project: ProjectConfig | null = null;

  constructor() {
    const loaded = loadProjectConfig();
    this.projectName = loaded?.name ?? null;
    this.project = loaded?.project ?? null;
    this.loadSystemPrompt();
  }

  /**
   * Load system prompt from proj/system.md if available, otherwise use default.
   */
  private loadSystemPrompt(): void {
    if (this.project) {
      const customPath = join(this.project.proj_dir, "system.md");
      if (existsSync(customPath)) {
        this.systemPrompt = readFileSync(customPath, "utf-8");
        return;
      }
    }
    this.systemPrompt = DEFAULT_SYSTEM_PROMPT;
  }

  private requireProject(): ProjectConfig {
    if (!this.project || !this.projectName) {
      throw new Error("No project configured. Run 'fastwrite prepare' first.");
    }
    return this.project;
  }

  ensureProjectDirectories(): void {
    const project = this.requireProject();
    const backupDir = join(project.proj_dir, "backups");
    const diffsDir = join(project.proj_dir, "diffs");
    const promptsDir = join(project.proj_dir, "prompts");

    for (const dir of [backupDir, diffsDir, promptsDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // Create customizable system.md if not present
    const systemPromptPath = join(project.proj_dir, "system.md");
    if (!existsSync(systemPromptPath)) {
      writeFileSync(systemPromptPath, DEFAULT_SYSTEM_PROMPT, "utf-8");
      console.log(`Created system prompt: ${systemPromptPath}`);
    }
  }

  scanSections(): SectionFile[] {
    const project = this.requireProject();
    const sectionsPath = project.sections_dir;

    if (!existsSync(sectionsPath)) return [];

    const files = readdirSync(sectionsPath);
    const sections: SectionFile[] = [];

    for (const file of files) {
      const filePath = join(sectionsPath, file);
      const stats = statSync(filePath);
      if (!stats.isFile()) continue;
      if (!file.endsWith(".tex")) continue;

      const match = file.match(/^(\d+)-(.+)\.tex$/);
      if (!match?.[1] || !match?.[2]) continue;

      sections.push({
        id: Number.parseInt(match[1], 10),
        filename: match[2],
        path: filePath,
        content: readFileSync(filePath, "utf-8")
      });
    }

    return sections.sort((a, b) => a.id - b.id);
  }

  generateMarkdownPrompts(sections: SectionFile[]): void {
    this.ensureProjectDirectories();
    const project = this.requireProject();
    const promptsDir = join(project.proj_dir, "prompts");

    for (const section of sections) {
      const promptPath = join(promptsDir, `${section.id}-${section.filename}.md`);
      if (existsSync(promptPath)) continue;

      const content =
        `# ${section.id}-${section.filename}\n\n` +
        `<!-- Write your modification requirements below -->\n\n` +
        `## Requirements\n\n` +
        `- \n`;

      writeFileSync(promptPath, content, "utf-8");
      console.log(`Generated prompt: ${promptPath}`);
    }
  }

  async processSection(sectionId: number, apiKey?: string, verbose?: boolean): Promise<string> {
    this.ensureProjectDirectories();
    const project = this.requireProject();

    const { sourcePath, promptPath } = this.locateSectionFiles(sectionId);
    console.log(`Writing ${basename(sourcePath)}...`);

    const originalLatex = readFileSync(sourcePath, "utf-8");
    const userPrompt = readFileSync(promptPath, "utf-8");

    const d = new Date();
    const ts = `${d.getDate()}_${d.getHours()}_${d.getMinutes()}_${d.getSeconds()}`;
    const backupPath = join(project.proj_dir, "backups", `${basename(sourcePath)}.${ts}.bak`);
    copyFileSync(sourcePath, backupPath);

    const newLatex = await this.generateNewContent({
      originalLatex,
      userPrompt,
      apiKey,
      verbose
    });
    writeFileSync(sourcePath, newLatex, "utf-8");

    const diffHtml = this.generateHtmlDiff(backupPath, sourcePath, sectionId);
    const diffPath = join(project.proj_dir, "diffs", `${basename(sourcePath)}.${ts}.diff.html`);
    writeFileSync(diffPath, diffHtml, "utf-8");

    openInBrowser(diffPath);
    return diffPath;
  }

  private locateSectionFiles(sectionId: number): { sourcePath: string; promptPath: string } {
    const project = this.requireProject();
    const idPrefix = `${sectionId}-`;

    const sourceMatches = readdirSync(project.sections_dir)
      .filter(f => f.startsWith(idPrefix) && f.endsWith(".tex"))
      .map(f => join(project.sections_dir, f));

    if (sourceMatches.length === 0) {
      throw new Error(`No source file matches '${idPrefix}*.tex' in ${project.sections_dir}`);
    }
    if (sourceMatches.length > 1) {
      throw new Error(`Multiple source files match section ${sectionId}: ${sourceMatches.map(p => basename(p)).join(", ")}`);
    }

    const promptsDir = join(project.proj_dir, "prompts");
    const promptMatches = readdirSync(promptsDir)
      .filter(f => f.startsWith(idPrefix) && f.endsWith(".md"))
      .map(f => join(promptsDir, f));

    if (promptMatches.length === 0) {
      throw new Error(`No prompt file matches '${idPrefix}*.md' in ${promptsDir}`);
    }
    if (promptMatches.length > 1) {
      throw new Error(`Multiple prompt files match section ${sectionId}: ${promptMatches.map(p => basename(p)).join(", ")}`);
    }

    return { sourcePath: sourceMatches[0]!, promptPath: promptMatches[0]! };
  }

  private async generateNewContent(input: {
    originalLatex: string;
    userPrompt: string;
    apiKey?: string;
    verbose?: boolean;
  }): Promise<string> {
    const effectiveApiKey = input.apiKey || API_KEY;
    if (!effectiveApiKey) return input.originalLatex;

    // Strip /chat/completions from URL (OpenAI client adds it)
    const baseURL = API_BASE_URL.replace(/\/chat\/completions\/?$/, "");
    
    const client = new OpenAI({
      apiKey: effectiveApiKey,
      baseURL
    });

    const userContent =
      `User requirements:\n\n${input.userPrompt}\n\n` +
      `Current LaTeX content:\n\n${input.originalLatex}\n\n` +
      `Rewrite the LaTeX to satisfy the requirements and system instructions. ` +
      `Return ONLY the updated LaTeX (no explanation, no markdown fences).`;

    if (input.verbose) {
      console.log("\n=== SYSTEM PROMPT ===");
      console.log(this.systemPrompt);
      console.log("\n=== USER CONTENT ===");
      console.log(userContent);
      console.log("\n=====================\n");
    }

    // Start spinner
    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let frameIndex = 0;
    let seconds = 0;
    const spinner = setInterval(() => {
      process.stdout.write(`\r${spinnerFrames[frameIndex]} Refining with LLM... ${seconds}s`);
      frameIndex = (frameIndex + 1) % spinnerFrames.length;
      seconds++;
    }, 1000);

    try {
      const response = await client.chat.completions.create({
        model: API_MODEL,
        messages: [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: userContent }
        ],
        temperature: 0.3,
        max_tokens: 4000
      });

      clearInterval(spinner);
      process.stdout.write(`\r✓ Refined with LLM in ${seconds}s\n`);

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("LLM API returned empty content");
      return stripMarkdownCodeFences(content);
    } catch (err) {
      clearInterval(spinner);
      process.stdout.write(`\r✗ LLM refinement failed after ${seconds}s\n`);
      if (err instanceof OpenAI.APIError) {
        throw new Error(`API error ${err.status}: ${err.message}`);
      }
      throw err;
    }
  }

  private generateHtmlDiff(originalPath: string, newPath: string, sectionId: number): string {
    const originalContent = readFileSync(originalPath, "utf-8");
    const newContent = readFileSync(newPath, "utf-8");
    const originalSentences = splitIntoSentences(originalContent);
    const newSentences = splitIntoSentences(newContent);
    const diff = generateSentenceDiff(originalSentences, newSentences);

    let html = "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\" />\n<title>Section Diff</title>\n";
    html += "<style>\n";
    html += "body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 20px; }\n";
    html += ".diff-container { max-width: 1000px; margin: 0 auto; }\n";
    html += ".diff-line { padding: 6px 12px; margin: 4px 0; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; border-radius: 6px; }\n";
    html += ".diff-removed { background-color: #ffeef0; color: #b31d28; }\n";
    html += ".diff-added { background-color: #e6ffed; color: #116329; }\n";
    html += ".diff-unchanged { color: #57606a; }\n";
    html += ".diff-header { background-color: #f6f8fa; padding: 10px 12px; font-weight: 600; border-radius: 8px; margin-bottom: 10px; }\n";
    html += ".meta { color: #57606a; font-size: 12px; margin-bottom: 12px; }\n";
    html += "</style>\n</head>\n<body>\n";
    html += "<div class=\"diff-container\">\n";
    html += `<div class="diff-header">Diff for Section ${sectionId}</div>\n`;
    html += `<div class="meta">Original: ${escapeHtml(basename(originalPath))} → New: ${escapeHtml(basename(newPath))}</div>\n`;

    for (const item of diff) {
      if (item.type === "removed") {
        html += `<div class="diff-line diff-removed">- ${escapeHtml(item.text)}</div>\n`;
      } else if (item.type === "added") {
        html += `<div class="diff-line diff-added">+ ${escapeHtml(item.text)}</div>\n`;
      } else {
        html += `<div class="diff-line diff-unchanged">  ${escapeHtml(item.text)}</div>\n`;
      }
    }

    html += "</div>\n</body>\n</html>";
    return html;
  }
}

function stripMarkdownCodeFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^\s*```[\w-]*\s*\n([\s\S]*?)\n```\s*$/);
  return (m?.[1] ?? t).trim();
}

function openInBrowser(filePath: string): void {
  try {
    if (process.platform === "darwin") {
      spawn("open", [filePath], { stdio: "ignore", detached: true });
      return;
    }
    if (process.platform === "win32") {
      // `start` is a cmd.exe built-in
      spawn("cmd", ["/c", "start", "", filePath], { stdio: "ignore", detached: true, windowsHide: true });
      return;
    }
    // linux, wsl, etc.
    spawn("xdg-open", [filePath], { stdio: "ignore", detached: true });
  } catch {
    // best-effort only
  }
}

