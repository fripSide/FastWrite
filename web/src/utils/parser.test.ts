import { describe, it, expect } from 'vitest';
import { parseContent } from './parser';

describe('parser', () => {
  // parseContent doesn't parse sections hierarchically anymore in parser.ts
  describe('parseParagraphs', () => {
    it('should split content into paragraphs', () => {
      const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const result = parseContent(content);

      expect(result).toHaveLength(3);
      expect(result[0].content).toBe('First paragraph.');
      expect(result[1].content).toBe('Second paragraph.');
      expect(result[2].content).toBe('Third paragraph.');
      expect(result.every(item => item.type === 'paragraph')).toBe(true);
    });

    it('should handle single paragraph', () => {
      const content = 'Single paragraph.';
      const result = parseContent(content);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Single paragraph.');
    });

    it('should trim whitespace from paragraphs', () => {
      const content = '  Paragraph with spaces  ';
      const result = parseContent(content);
      expect(result[0].content).toBe('Paragraph with spaces');
    });
  });

  describe('parseSentences', () => {
    it('should split content into sentences', () => {
      const content = 'First sentence. Second sentence! Third sentence? Fourth sentence.';
      const result = parseContent(content);

      expect(result).toHaveLength(4);
      expect(result[0].content).toBe('First sentence.');
      expect(result[1].content).toBe('Second sentence!');
      expect(result[2].content).toBe('Third sentence?');
      expect(result[3].content).toBe('Fourth sentence.');
      expect(result.every(item => item.type === 'sentence')).toBe(true);
    });

    it('should filter out LaTeX comments', () => {
      const content = 'Sentence one.\n% Comment line\nSentence two.';
      const result = parseContent(content);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Sentence one.');
      expect(result[1].content).toBe('Sentence two.');
    });

    it('should handle empty content', () => {
      const result = parseContent('');
      expect(result).toHaveLength(0);
    });
  });

});
