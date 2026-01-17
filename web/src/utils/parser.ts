import type { TextItem, ViewMode } from '../types';

/**
 * Helper to split text into atomic blocks (Headers, Environments) and Text Paragraphs.
 * This ensures that structures like tables and sections are never split into sentences.
 */
function parseAtomicBlocks(text: string): string[] {
  const placeholders: string[] = [];
  const placeholderPrefix = '___ATOM_BLOCK_';

  // 1. Extract Environments (Tables, Figures, Equations, etc.)
  // Note: We use a list of common block-level environments
  const envRegex = /\\begin\{(table|figure|algorithm|code|tabular|equation|itemize|enumerate)\*?\}([\s\S]*?)\\end\{\1\*?\}/g;

  let processed = text.replace(envRegex, (match) => {
    placeholders.push(match);
    return `${placeholderPrefix}${placeholders.length - 1}___`;
  });

  // 2. Extract Headers (Section, Subsection, etc.) - Line based
  // Matches \section{...} at start of line (allowing whitespace)
  const headerRegex = /^\s*\\(section|subsection|subsubsection|paragraph|subparagraph|chapter)\*?\{.*\}/gm;
  processed = processed.replace(headerRegex, (match) => {
    placeholders.push(match);
    return `${placeholderPrefix}${placeholders.length - 1}___`;
  });

  // 3. Split by double newlines (Paragraphs)
  // We trim each paragraph to avoid empty items
  const rawParagraphs = processed.split(/\n[ \t]*\n+/).map(p => p.trim()).filter(p => p.length > 0);

  // 4. For each paragraph:
  //    - If it's a placeholder, return it (restored).
  //    - If it's text, split into sentences.
  const finalItems: string[] = [];

  rawParagraphs.forEach((para, index) => {
    // Check if the paragraph is EXACTLY a placeholder (Atomic Block)
    // We trim again just in case
    const match = para.trim().match(/^___ATOM_BLOCK_(\d+)___$/);
    if (match) {
      finalItems.push(placeholders[parseInt(match[1])]);
    } else {
      // It's a text paragraph. It might CONTAIN placeholders (e.g. inline math or smaller blocks if we missed regex)
      // But mainly it's text. We split into sentences.

      const sentences = splitTextIntoSentences(para);

      // Restore placeholders in sentences
      const restoredSentences = sentences.map(s => {
        return s.replace(/___ATOM_BLOCK_(\d+)___/g, (_, index) => placeholders[parseInt(index)]);
      });

      finalItems.push(...restoredSentences);
    }

    // Insert paragraph separator (empty item) if not the last paragraph
    if (index < rawParagraphs.length - 1) {
      finalItems.push('');
    }
  });

  return finalItems;
}

function splitTextIntoSentences(text: string): string[] {
  // Simple sentence splitter that respects abbreviations could be complex.
  // Using the previous punctuation regex: lookbehind[.!?] + whitespace + lookahead[A-Z]
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

export function parseContent(content: string, mode: ViewMode): TextItem[] {
  switch (mode) {
    case 'section':
      return parseSections(content);
    case 'paragraph':
      return parseParagraphs(content);
    case 'sentence':
      return parseSentences(content);
    default:
      return parseSections(content);
  }
}

function parseSections(content: string): TextItem[] {
  const items: TextItem[] = [];
  const lines = content.split('\n');
  let currentItem: TextItem | null = null;
  let itemContent: string[] = [];
  let lineNum = 0;
  let itemIndex = 0;

  for (const line of lines) {
    lineNum++;
    // Match either section or subsection
    const sectionMatch = line.match(/\\(section|subsection)\{([^}]+)\}/);

    if (sectionMatch) {
      // Save previous item if exists
      if (currentItem) {
        currentItem.content = itemContent.join('\n');
        items.push(currentItem);
      }

      // Start new item (treat both section and subsection as flat items)
      itemIndex++;
      const type = sectionMatch[1]; // 'section' or 'subsection'
      // We can use the title from sectionMatch[2] if needed, but we store full content usually?
      // Actually MainEditor mostly uses .content.

      currentItem = {
        id: `section-${itemIndex}`,
        content: '', // content will be filled later, start with empty or the line?
        // Usually we include the header line in the content so the user sees it?
        // Yes, sectionContent = [line] in previous code.
        type: 'section',
        level: type === 'section' ? 1 : 2, // We can still track level field
        children: [], // No children in flat mode
        lineStart: lineNum,
        status: 'unchanged'
      };
      itemContent = [line];
    } else {
      if (currentItem) {
        itemContent.push(line);
      } else {
        // Content before first section?
        // We can start a default item or ignore.
        // Usually we create a default item if none exists.
        // Let's defer "if (currentItem)" check or create one lazily?
        // Better: create default item if content appears before any section.
        if (line.trim() !== '') {
          itemIndex++;
          currentItem = {
            id: `section-${itemIndex}`,
            content: '',
            type: 'section',
            level: 1,
            status: 'unchanged'
          };
          itemContent.push(line);
        }
      }
    }
  }

  // Save last item
  if (currentItem) {
    currentItem.content = itemContent.join('\n');
    items.push(currentItem);
  }

  // Fallback for no sections
  if (items.length === 0) {
    return [{
      id: 'content-1',
      content: content,
      type: 'section',
      level: 1,
      status: 'unchanged'
    }];
  }

  return items;
}

function parseParagraphs(content: string): TextItem[] {
  const lines = content.split('\n');
  const items: TextItem[] = [];
  let currentPara: string[] = [];
  let paraStartLine = 1;
  let paraIndex = 0;

  const flush = (nextStartLine: number) => {
    if (currentPara.length > 0) {
      paraIndex++;
      items.push({
        id: `paragraph-${paraIndex}`,
        content: currentPara.join('\n').trim(),
        type: 'paragraph',
        lineStart: paraStartLine,
        status: 'unchanged'
      });
      currentPara = [];
    }
    paraStartLine = nextStartLine;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (trimmed === '') {
      // Empty line - flush current paragraph
      flush(lineNum + 1);
    } else {
      // Check for implicit splitters: Sections or Block Environments
      // If we see a section header, it should be its own block (or start a new one)
      const isSection = /^\s*\\(section|subsection|subsubsection|chapter|paragraph|subparagraph)\*?\{/.test(line);
      const isBeginEnv = /^\s*\\begin\{/.test(line);
      const isEndEnv = /^\s*\\end\{/.test(line);

      // If we encounter a section or begin/end env, flush previous content first
      // But only if currentPara is not empty.
      // Exception: If currentPara is just started (length 0), we don't need to flush.
      if ((isSection || isBeginEnv || isEndEnv) && currentPara.length > 0) {
        flush(lineNum);
      }

      if (currentPara.length === 0) {
        paraStartLine = lineNum;
      }
      currentPara.push(line);

      // If it's a section header, force flush immediately so it stands alone?
      // Or if it's \end{...}, flush after?
      // Let's keep sections distinct.
      if (isSection) {
        flush(lineNum + 1);
      }
      // For environments, we might want to keep the whole environment as one paragraph/block?
      // But parseSentences has complex logic for that.
      // parseParagraphs simple approach: split on \begin and \end boundaries.
      // If we flush on \end, then the environment is grouped with preceding lines?
      // No, we flushed BEFORE \begin. So inner content starts new para.
      // If we flush AFTER \end, inner content is grouping until \end.

      if (isEndEnv) {
        flush(lineNum + 1);
      }
    }
  }

  // Save last paragraph
  flush(0);

  return items;
}

function parseSentences(content: string): TextItem[] {
  const lines = content.split('\n');
  const items: TextItem[] = [];
  let sentenceIndex = 0;

  // Block environments that should not be split (kept as single items)
  const blockEnvs = ['table', 'figure', 'algorithm', 'tabular', 'equation', 'itemize', 'enumerate', 'align', 'lstlisting', 'verbatim', 'abstract'];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (line.trim() === '') {
      continue; // Skip empty lines
    }

    // Check if this is a section/subsection header - treat as single item
    if (line.match(/^\s*\\(section|subsection|subsubsection|chapter|paragraph)\*?\{/)) {
      sentenceIndex++;
      items.push({
        id: `sentence-${sentenceIndex}`,
        content: line.trim(),
        type: 'sentence',
        lineStart: lineNum,
        status: 'unchanged'
      });
      continue;
    }

    // Check if this is a block environment start (only specific ones, not document)
    const envMatch = line.match(/^\s*\\begin\{(\w+)\*?\}/);
    if (envMatch && blockEnvs.includes(envMatch[1])) {
      const envName = envMatch[1];
      let blockContent = line;
      let blockStart = lineNum;
      let depth = 1;
      let j = i + 1;

      while (j < lines.length && depth > 0) {
        const checkLine = lines[j];
        if (checkLine.includes(`\\begin{${envName}`)) depth++;
        if (checkLine.includes(`\\end{${envName}`)) depth--;
        blockContent += '\n' + checkLine;
        j++;
      }
      i = j - 1; // Skip processed lines

      sentenceIndex++;
      items.push({
        id: `sentence-${sentenceIndex}`,
        content: blockContent.trim(),
        type: 'sentence',
        lineStart: blockStart,
        status: 'unchanged'
      });
      continue;
    }

    // Regular text line - split by sentence-ending punctuation
    const trimmedLine = line.trim();
    if (trimmedLine.length > 0) {
      const sentences = trimmedLine
        .split(/(?<=[.!?])\s+(?=[A-Z])/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const sentence of sentences) {
        sentenceIndex++;
        items.push({
          id: `sentence-${sentenceIndex}`,
          content: sentence,
          type: 'sentence',
          lineStart: lineNum,
          status: 'unchanged'
        });
      }
    }
  }

  return items;
}
