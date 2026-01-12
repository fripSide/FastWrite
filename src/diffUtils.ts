export type DiffItem = { type: 'unchanged' | 'added' | 'removed'; text: string };

function removeLatexComments(text: string): string {
  return text.split('\n').filter(line => !line.trim().startsWith('%')).join('\n');
}

export function splitIntoSentences(text: string): string[] {
  const textWithoutComments = removeLatexComments(text);
  const cleanedText = removeLatexSymbols(textWithoutComments);
  
  // Normalize whitespace
  let normalized = cleanedText.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  // Protect abbreviations by replacing dots with placeholder
  // Pattern: letter(s) + optional space + dot → replace dot with §
  normalized = normalized
    .replace(/\b(e)\s*\.\s*(g)\s*\./gi, '$1§$2§')     // e.g.
    .replace(/\b(i)\s*\.\s*(e)\s*\./gi, '$1§$2§')     // i.e.
    .replace(/\b(et)\s+(al)\s*\./gi, '$1 $2§')        // et al.
    .replace(/\b(etc)\s*\./gi, '$1§')                  // etc.
    .replace(/\b(vs)\s*\./gi, '$1§')                   // vs.
    .replace(/\b(Dr|Mr|Ms|Prof|Fig|Eq|Sec|Ref)\s*\./gi, '$1§'); // titles

  // Split on sentence-ending punctuation followed by space and capital letter
  const sentences = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => s.replace(/§/g, '.'));  // Restore dots

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
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function removeLatexSymbols(text: string): string {
  return text
    .replace(/\\begin\{[^}]+\}/g, '')                         // \begin{...} tags only
    .replace(/\\end\{[^}]+\}/g, '')                           // \end{...} tags only
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')                 // commands with args: keep content
    .replace(/\\[a-zA-Z]+(\s|$)/gm, ' ')                      // commands without args
    .replace(/[\\$%_{}~&#@^]/g, '')                           // special chars
    .replace(/\s+/g, ' ')
    .trim();
}
