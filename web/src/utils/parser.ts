import type { TextItem, ViewMode } from '../types';

/**
 * Parses content into a list of Paragraphs, extracting "Thoughts" metadata if present.
 * Implements "Smart Chunking" to group LaTeX tags with text blocks.
 * 
 * Format:
 * % [FW_THOUGHTS]
 * % My thought content here...
 * % [/FW_THOUGHTS]
 * Actual paragraph text...
 */
export function parseContent(content: string): TextItem[] {
  const lines = content.split('\n');
  const items: TextItem[] = [];

  let currentBlockLines: string[] = [];
  let currentThoughts: string[] = [];
  let isReadingThoughts = false;
  let blockStartLine = 1;

  // Helper to commit the current accumulated lines as a single TextItem
  const commitBlock = (nextStartLine: number) => {
    // Join lines. We want to preserve newlines between them to keep exact representation.
    const blockContent = currentBlockLines.join('\n');

    // Let's trim the *result* to avoid start/end whitespace issues in the editor card
    const trimmedContent = blockContent.trim();

    // Only push if we have actual content or thoughts
    if (trimmedContent || currentThoughts.length > 0) {
      items.push({
        id: `para-${items.length + 1}`,
        content: trimmedContent, // Use trimmed content for the editor value
        type: 'paragraph',
        thoughts: currentThoughts.length > 0 ? currentThoughts.join('\n').trim() : undefined,
        lineStart: blockStartLine,
        status: 'unchanged'
      });
    }

    currentBlockLines = [];
    currentThoughts = [];
    blockStartLine = nextStartLine;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // --- 1. Thoughts Parsing (High Priority) ---
    if (trimmed === '% [FW_THOUGHTS]') {
      // If we have pending content, we MUST commit it because thoughts strictly start a new logical unit
      if (currentBlockLines.length > 0) {
        commitBlock(lineNum);
      }
      isReadingThoughts = true;
      blockStartLine = lineNum; // This thoughts block starts here
      continue;
    }

    if (trimmed === '% [/FW_THOUGHTS]') {
      isReadingThoughts = false;
      continue;
    }

    if (isReadingThoughts) {
      const cleanLine = line.replace(/^\s*%\s?/, '');
      currentThoughts.push(cleanLine);
      continue;
    }

    // --- 2. Content Grouping Logic ---

    // We want to group structure commands with subsequent text if possible.
    // Major structural breaks might still warrant a split if the previous block is substantial.

    const isStructureCmd = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{/.test(line);
    const isBeginEnv = /^\s*\\begin\{/.test(line);

    // If we hit a start of a new structure/env...
    if (isStructureCmd || isBeginEnv) {
      // Evaluate if we should split from previous content.
      // Heuristic: If previous content is "Substantial" (e.g. > 5 lines or has blank lines), split?
      // Actually, user wants "Basic Blocks" > 5 lines.
      // So we should try to KEEP accumulating unless we really need to split.

      // But `\section` usually *starts* a concept. 
      // If we have 20 lines of text, then `\section`, we probably want to split BEFORE the section.
      // If we have 2 lines of text, then `\section`, maybe keep together? (Unlikely in valid LaTeX)

      // Let's split BEFORE a structure command IF the current block has text content.
      const hasContent = currentBlockLines.some(l => l.trim().length > 0);
      if (hasContent) {
        commitBlock(lineNum);
        blockStartLine = lineNum;
      }
    }

    // Append current line to buffer
    // If it's the *start* of a new block (buffer empty), set start line
    if (currentBlockLines.length === 0 && currentThoughts.length === 0) {
      blockStartLine = lineNum;
    }

    currentBlockLines.push(line);

    // --- 3. Post-Line Flush Check (The "Chunking" Magic) ---

    // We want to split on BLANK LINES, but ONLY if the block is "Big Enough".
    // If the block is small (e.g. just a header or 1-2 lines), we eat the blank line and continue.

    if (trimmed === '') {
      // Check validity of current block.
      const textLines = currentBlockLines.filter(l => l.trim().length > 0);

      // If the block is largely just a header `\section{...}`, DO NOT flush yet.
      const isHeaderOnly = textLines.every(l => /^\s*\\(part|chapter|section|subsection|subsubsection|label|begin|maketitle)/.test(l));

      if (!isHeaderOnly && currentBlockLines.length > 0) {
        // It has real text.
        // Heuristic: Split if > 5 lines of *content* (ignoring blanks)
        const contentLineCount = textLines.length;

        if (contentLineCount >= 5) {
          // Standard Paragraph Split
          commitBlock(lineNum + 1);
          // Next block starts on next line (skipping this blank one in terms of content, 
          // but line numbers should track correctly. 
          // commitBlock sets blockStartLine to `lineNum + 1`.
        } else {
          // Block is small (< 5 lines). 
          // KEEP the blank line in the buffer?
          // If we keep it, it becomes part of the content. 
          // If we execute `commitBlock` later, `blockContent` will have the blank line.
          // This is GOOD because it preserves spacing when we write back.
        }
      }
    }
  }

  // Final flush
  commitBlock(0);

  // --- Post-Processing: Merge Small Blocks ---
  // Users reported that some blocks are too short. 
  // We merge small blocks (without thoughts) into the previous block to create larger editing units.

  if (items.length > 0) {
    const mergedItems: TextItem[] = [];

    // Start with the first item
    if (items.length > 0) mergedItems.push(items[0]);

    for (let i = 1; i < items.length; i++) {
      const current = items[i];
      const prev = mergedItems[mergedItems.length - 1];

      // Criteria for merging:
      // 1. Current has NO thoughts (thoughts imply a distinct unit/task).
      // 2. Current is "small" (e.g. < 3 lines of text).
      // 3. Previous block exists (handled by loop start).
      // 4. Ideally, we don't merge a Section Header *into* a previous text block? 
      //    Actually, if the current block IS a section header, we probably want it separate?
      //    Let's check if current is a structure command.

      const isStructure = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|begin|end)/.test(current.content);
      const lineCount = current.content.split('\n').length;
      const isSmall = lineCount < 3 && current.content.length < 300; // Heuristic

      if (!current.thoughts && isSmall && !isStructure) {
        // Merge into previous
        // We add a blank line separator to preserve LaTeX structure
        prev.content += '\n\n' + current.content;
        // We don't update prev.id, but maybe we should update prev.lineEnd if we had it.
        // prev.lineStart remains the same.
      } else {
        // Keep distinct
        mergedItems.push(current);
      }
    }
    return mergedItems;
  }

  return items;
}

/**
 * Splits a single paragraph's content into sentences for the "Focus Mode".
 * This does NOT parse the whole document, just the text passed to it.
 */
export function parseParagraphToSentences(content: string, startLineOffset: number = 0): TextItem[] {
  const items: TextItem[] = [];

  // Simple splitter - can be enhanced with the regex from before
  // or a more robust NLP library if needed later.

  // We need to be careful about preserving lines if user formatted manually.
  // But "Sentence Mode" implies re-flowing.
  // Let's use the tokenizer we had:

  // Regex to match sentence endings that aren't abbreviations (simplified)
  // Split by [.!?] followed by whitespace and capital letter
  const parts = content.split(/(?<=[.!?])\s+(?=[A-Z])/);

  let currentLine = startLineOffset;

  parts.forEach((part, idx) => {
    const trimmed = part.trim();
    if (trimmed) {
      items.push({
        id: `sent-${idx}`,
        content: trimmed,
        type: 'sentence',
        lineStart: currentLine, // Approx line number, hard to be exact without sourcemaps
        status: 'unchanged'
      });
      // Estimate line increment
      currentLine += part.split('\n').length - 1;
    }
  });

  return items;
}
