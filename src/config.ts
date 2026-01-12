export const API_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
export const API_KEY = process.env.OPENAI_API_KEY || "";
export const API_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

export const CONFIG = {
  sectionsDir: "sections",
  backupDir: "backups",
  promptsDir: "prompts",
  outputDir: "output",
  diffsDir: "diffs"
} as const;
