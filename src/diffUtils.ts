import type { DiffItem } from "./types.js";

function removeLatexComments(text: string): string {
  const lines = text.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('%')) {
      return false;
    }
    return true;
  });
  return filteredLines.join('\n');
}

export function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  const textWithoutComments = removeLatexComments(text);
  const cleanedText = removeLatexSymbols(textWithoutComments);

  const sentenceRegex = /([^.!?]+[.!?]+|[^.!?]+$)/g;
  let match;
  while ((match = sentenceRegex.exec(cleanedText)) !== null) {
    const sentence = match[0].trim();
    if (sentence) {
      sentences.push(sentence);
    }
  }

  return sentences;
}

export function computeLCS<T>(arr1: T[], arr2: T[]): T[] {
  const m = arr1.length;
  const n = arr2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  const lcs: T[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (arr1[i - 1] === arr2[j - 1]) {
      lcs.unshift(arr1[i - 1]!);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

export function generateSentenceDiff(originalSentences: string[], newSentences: string[]): DiffItem[] {
  const lcs = computeLCS(originalSentences, newSentences);
  const diff: DiffItem[] = [];

  let i = 0, j = 0;
  let lcsIndex = 0;

  while (i < originalSentences.length || j < newSentences.length) {
    const origSentence = originalSentences[i];
    const newSentence = newSentences[j];
    const lcsSentence = lcs[lcsIndex];

    if (origSentence && origSentence === lcsSentence) {
      if (j < newSentences.length && newSentence && newSentence === lcsSentence) {
        diff.push({ type: 'unchanged', text: origSentence });
        i++;
        j++;
        lcsIndex++;
      } else {
        diff.push({ type: 'removed', text: origSentence });
        i++;
      }
    } else if (newSentence && newSentence === lcsSentence) {
      diff.push({ type: 'added', text: newSentence });
      j++;
      lcsIndex++;
    } else {
      if (i < originalSentences.length && origSentence) {
        diff.push({ type: 'removed', text: origSentence });
        i++;
      }
      if (j < newSentences.length && newSentence) {
        diff.push({ type: 'added', text: newSentence });
        j++;
      }
    }
  }

  return diff;
}

export function escapeHtml(text: string): string {
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return removeLatexSymbols(escaped);
}

export function removeLatexSymbols(text: string): string {
  let result = text;

  result = result.replace(/\\[a-zA-Z]+\{[^}]*\}/g, '');
  result = result.replace(/\\[a-zA-Z]+\s/g, '');
  result = result.replace(/\\[a-zA-Z]+$/gm, '');
  result = result.replace(/\$\$/g, '');
  result = result.replace(/\$/g, '');
  result = result.replace(/\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}/g, '');
  result = result.replace(/\\/g, '');
  result = result.replace(/%/g, '');
  result = result.replace(/_/g, '');
  result = result.replace(/\{/g, '');
  result = result.replace(/\}/g, '');
  result = result.replace(/~/g, '');
  result = result.replace(/&/g, '');
  result = result.replace(/#/g, '');
  result = result.replace(/@/g, '');
  result = result.replace(/\^/g, '');

  result = result.replace(/\s+/g, ' ').trim();

  return result;
}
