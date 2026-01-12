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
import { escapeHtml, generateSentenceDiff, splitIntoSentences } from "./diffUtils.js";

const API_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const API_KEY = process.env.OPENAI_API_KEY || "";
const API_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
import { loadProjectConfig, type ProjectConfig } from "./projectConfig.js";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt.js";

export interface SectionFile {
  id: number;
  filename: string;
  path: string;
  content: string;
}

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
    html += ".diff-unchanged { color: #57606a; background-color: #f6f8fa; border: 1px solid #e1e4e8; }\n";
    html += ".diff-header { background-color: #f6f8fa; padding: 10px 12px; font-weight: 600; border-radius: 8px; margin-bottom: 10px; }\n";
    html += ".meta { color: #57606a; font-size: 12px; margin-bottom: 12px; }\n";
    html += "</style>\n</head>\n<body>\n";
    html += "<div class=\"diff-container\">\n";
    html += `<div class="diff-header">Diff for Section ${sectionId}</div>\n`;
    html += `<div class="meta">Original: ${escapeHtml(basename(originalPath))} → New: ${escapeHtml(basename(newPath))}</div>\n`;

    const hasChanges = diff.some(item => item.type === "removed" || item.type === "added");

    if (!hasChanges) {
      html += `<div style="padding: 20px; text-align: center; color: #57606a; background: #f6f8fa; border-radius: 8px; margin: 20px 0;">
        <div style="font-size: 24px; margin-bottom: 8px;">✓</div>
        <div style="font-weight: 600;">No changes</div>
        <div style="font-size: 14px; margin-top: 4px;">The content remains the same after LLM refinement.</div>
      </div>\n`;
    }

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

