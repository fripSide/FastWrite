import { describe, it, expect } from 'vitest';
import { parseContent } from './parser';

describe('parser', () => {
  describe('parseSections', () => {
    it('should parse LaTeX sections and subsections', () => {
      const content = `
\\section{Introduction}
This is the introduction.
\\subsection{Background}
This is background content.
\\section{Methods}
This is the methods section.
      `;

      const result = parseContent(content, 'section');
      
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('section');
      expect(result[0].level).toBe(1);
      expect(result[0].content).toContain('Introduction');
      expect(result[0].content).toContain('This is the introduction.');
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children![0].type).toBe('section');
      expect(result[0].children![0].level).toBe(2);
      expect(result[0].children![0].content).toContain('\\subsection{Background}');
    });

    it('should handle empty content', () => {
      const result = parseContent('', 'section');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('');
    });

    it('should handle content without sections', () => {
      const content = 'This is plain text without sections.';
      const result = parseContent(content, 'section');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe(content);
    });

    it('should track line numbers', () => {
      const content = 'Line 1\n\\section{Title}\nContent';
      const result = parseContent(content, 'section');
      expect(result[0].lineStart).toBe(2);
    });

    it('should filter out LaTeX comments', () => {
      const content = `
% This is a comment
\\section{Title}
Real content
% Another comment
      `;
      const result = parseContent(content, 'section');
      expect(result[0].content).not.toContain('% This is a comment');
    });
  });

  describe('parseParagraphs', () => {
    it('should split content into paragraphs', () => {
      const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const result = parseContent(content, 'paragraph');
      
      expect(result).toHaveLength(3);
      expect(result[0].content).toBe('First paragraph.');
      expect(result[1].content).toBe('Second paragraph.');
      expect(result[2].content).toBe('Third paragraph.');
      expect(result.every(item => item.type === 'paragraph')).toBe(true);
    });

    it('should handle single paragraph', () => {
      const content = 'Single paragraph.';
      const result = parseContent(content, 'paragraph');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Single paragraph.');
    });

    it('should trim whitespace from paragraphs', () => {
      const content = '  Paragraph with spaces  ';
      const result = parseContent(content, 'paragraph');
      expect(result[0].content).toBe('Paragraph with spaces');
    });
  });

  describe('parseSentences', () => {
    it('should split content into sentences', () => {
      const content = 'First sentence. Second sentence! Third sentence? Fourth sentence.';
      const result = parseContent(content, 'sentence');
      
      expect(result).toHaveLength(4);
      expect(result[0].content).toBe('First sentence.');
      expect(result[1].content).toBe('Second sentence!');
      expect(result[2].content).toBe('Third sentence?');
      expect(result[3].content).toBe('Fourth sentence.');
      expect(result.every(item => item.type === 'sentence')).toBe(true);
    });

    it('should filter out LaTeX comments', () => {
      const content = 'Sentence one.\n% Comment line\nSentence two.';
      const result = parseContent(content, 'sentence');
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Sentence one.');
      expect(result[1].content).toBe('Sentence two.');
    });

    it('should handle empty content', () => {
      const result = parseContent('', 'sentence');
      expect(result).toHaveLength(0);
    });
  });

  describe('parseContent dispatch', () => {
    it('should call parseSections for mode "section"', () => {
      const content = '\\section{Title}\nContent';
      const result = parseContent(content, 'section');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('section');
    });

    it('should call parseParagraphs for mode "paragraph"', () => {
      const content = 'First paragraph.\n\nSecond paragraph.';
      const result = parseContent(content, 'paragraph');
      expect(result).toHaveLength(2);
      expect(result.every(item => item.type === 'paragraph')).toBe(true);
    });

    it('should call parseSentences for mode "sentence"', () => {
      const content = 'First sentence. Second sentence.';
      const result = parseContent(content, 'sentence');
      expect(result).toHaveLength(2);
      expect(result.every(item => item.type === 'sentence')).toBe(true);
    });
  });
});
