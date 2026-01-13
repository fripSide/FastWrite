import type { DiffChange, DiffResult } from '../types';

interface Word {
  text: string;
  index: number;
}

function tokenize(text: string): Word[] {
  const regex = /\s+/g;
  const tokens = text.split(regex).filter(t => t.trim());
  let index = 0;
  const words: Word[] = [];
  
  for (const token of tokens) {
    words.push({
      text: token,
      index: index++
    });
  }
  
  return words;
}

function findLineNumber(text: string, wordIndex: number): number {
  const tokens = text.split(/\s+/);
  const token = tokens[wordIndex];
  if (!token) return 0;
  return text.substring(0, text.indexOf(token)).split('\n').length - 1;
}

function computeDiffSummary(changes: DiffChange[]) {
  const additions = changes.filter(c => c.type === 'addition').length;
  const deletions = changes.filter(c => c.type === 'deletion').length;
  const modifications = changes.filter(c => c.type === 'modification').length;
  
  return { additions, deletions, modifications };
}

export function computeWordDiff(original: string, modified: string): DiffResult {
  const originalWords = tokenize(original);
  const modifiedWords = tokenize(modified);
  const changes: DiffChange[] = [];
  
  let i = 0;
  let j = 0;
  
  while (i < originalWords.length || j < modifiedWords.length) {
    const origWord = originalWords[i];
    const modWord = modifiedWords[j];
    
    if (origWord && modWord && origWord.text === modWord.text) {
      i++;
      j++;
      continue;
    }
    
    if (!origWord && modWord) {
      changes.push({
        type: 'addition',
        original: '',
        modified: modWord.text,
        lineNumber: findLineNumber(modified, j)
      });
      j++;
      continue;
    }

    if (origWord && !modWord) {
      changes.push({
        type: 'deletion',
        original: origWord.text,
        modified: '',
        lineNumber: findLineNumber(original, i)
      });
      i++;
      continue;
    }

    if (origWord && modWord) {
      changes.push({
        type: 'modification',
        original: origWord.text,
        modified: modWord.text,
        lineNumber: findLineNumber(original, i)
      });
      i++;
      j++;
    }
  }
  
  const summary = computeDiffSummary(changes);
  
  return {
    itemId: 'temp',
    hasChanges: changes.length > 0,
    changes,
    summary
  };
}
