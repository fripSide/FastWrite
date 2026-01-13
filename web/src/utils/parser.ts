import type { TextItem, ViewMode } from '../types';

// Simple sentence splitter
function splitIntoSentences(text: string): string[] {
  const withoutComments = text.split('\n').filter(line => !line.trim().startsWith('%')).join('\n');
  const sentences = withoutComments
    .split(/(?<=[.!?])\s*(?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return sentences;
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
  let currentSection: TextItem | null = null;
  let currentSubsection: TextItem | null = null;
  let sectionContent: string[] = [];
  let subsectionContent: string[] = [];
  let lineNum = 0;
  let sectionIndex = 0;
  let subsectionIndex = 0;

  for (const line of lines) {
    lineNum++;
    const sectionMatch = line.match(/\\section\{([^}]+)\}/);
    const subsectionMatch = line.match(/\\subsection\{([^}]+)\}/);

    if (sectionMatch) {
      // Save previous section if exists
      if (currentSection) {
        if (currentSubsection) {
          currentSection.children = [currentSubsection];
        }
        currentSection.content = sectionContent.join('\n');
        items.push(currentSection);
      }

      // Start new section
      sectionIndex++;
      currentSection = {
        id: `section-${sectionIndex}`,
        content: '',
        type: 'section',
        level: 1,
        children: [],
        lineStart: lineNum,
        status: 'unchanged'
      };
      sectionContent = [line];
      currentSubsection = null;
      subsectionContent = [];
    } else if (subsectionMatch && currentSection) {
      // Save previous subsection if exists
      if (currentSubsection) {
        currentSubsection.content = subsectionContent.join('\n');
        if (!currentSection.children) {
          currentSection.children = [];
        }
        currentSection.children.push(currentSubsection);
      }

      // Start new subsection
      subsectionIndex++;
      currentSubsection = {
        id: `subsection-${subsectionIndex}`,
        content: line,
        type: 'section',
        level: 2,
        lineStart: lineNum,
        status: 'unchanged'
      };
      subsectionContent = [line];
    } else {
      // Add line to current section/subsection
      if (currentSubsection) {
        subsectionContent.push(line);
      } else if (currentSection) {
        sectionContent.push(line);
      }
    }
  }

  // Save last section/subsection
  if (currentSection) {
    if (currentSubsection) {
      currentSubsection.content = subsectionContent.join('\n');
      if (!currentSection.children) {
        currentSection.children = [];
      }
      currentSection.children.push(currentSubsection);
    }
    currentSection.content = sectionContent.join('\n');
    items.push(currentSection);
  }

  // If no sections found, return entire content as one item
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
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);
  
  return paragraphs.map((para, index) => ({
    id: `paragraph-${index + 1}`,
    content: para.trim(),
    type: 'paragraph',
    status: 'unchanged'
  }));
}

function parseSentences(content: string): TextItem[] {
  const sentences = splitIntoSentences(content);
  
  return sentences.map((sentence, index) => ({
    id: `sentence-${index + 1}`,
    content: sentence.trim(),
    type: 'sentence',
    status: 'unchanged'
  }));
}
