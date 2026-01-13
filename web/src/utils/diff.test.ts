import { describe, it, expect } from 'vitest';
import { computeWordDiff } from './diff';

describe('diff', () => {
  describe('computeWordDiff', () => {
    it('should detect additions', () => {
      const original = 'Hello world';
      const modified = 'Hello wonderful world';
      
      const result = computeWordDiff(original, modified);
      
      expect(result.hasChanges).toBe(true);
      expect(result.summary.additions).toBeGreaterThan(0);
      expect(result.changes.some(c => c.type === 'addition')).toBe(true);
      expect(result.changes.some(c => c.modified === 'wonderful')).toBe(true);
    });

    it('should detect deletions', () => {
      const original = 'The quick brown fox jumps over the lazy dog';
      const modified = 'The fox jumps over the dog';
      
      const result = computeWordDiff(original, modified);
      
      expect(result.hasChanges).toBe(true);
      expect(result.summary.deletions).toBeGreaterThan(0);
      expect(result.changes.some(c => c.type === 'deletion')).toBe(true);
    });

    it('should detect modifications', () => {
      const original = 'The cat is black';
      const modified = 'The cat is white';
      
      const result = computeWordDiff(original, modified);
      
      expect(result.hasChanges).toBe(true);
      expect(result.summary.modifications).toBeGreaterThan(0);
      expect(result.changes.some(c => c.type === 'modification')).toBe(true);
      expect(result.changes.some(c => c.original === 'black' && c.modified === 'white')).toBe(true);
    });

    it('should handle mixed changes', () => {
      const original = 'We propose a new method for solving this problem';
      const modified = 'We propose a new method for solving this and other issues';
      
      const result = computeWordDiff(original, modified);
      
      expect(result.hasChanges).toBe(true);
      expect(result.summary.additions).toBeGreaterThan(0);
      expect(result.summary.modifications).toBeGreaterThan(0);
    });

    it('should detect no changes', () => {
      const content = 'This is the same text';
      const result = computeWordDiff(content, content);
      
      expect(result.hasChanges).toBe(false);
      expect(result.summary.additions).toBe(0);
      expect(result.summary.deletions).toBe(0);
      expect(result.summary.modifications).toBe(0);
      expect(result.changes).toHaveLength(0);
    });

    it('should handle empty strings', () => {
      const original = '';
      const modified = '';
      
      const result = computeWordDiff(original, modified);
      
      expect(result.hasChanges).toBe(false);
      expect(result.changes).toHaveLength(0);
    });

    it('should handle addition to empty string', () => {
      const original = '';
      const modified = 'New content added';
      
      const result = computeWordDiff(original, modified);
      
      expect(result.hasChanges).toBe(true);
      expect(result.summary.additions).toBeGreaterThan(0);
    });

    it('should handle deletion to empty string', () => {
      const original = 'Content to delete';
      const modified = '';
      
      const result = computeWordDiff(original, modified);
      
      expect(result.hasChanges).toBe(true);
      expect(result.summary.deletions).toBeGreaterThan(0);
    });

    it('should handle LaTeX special characters', () => {
      const original = 'The $\\alpha$ parameter is $\\beta$';
      const modified = 'The $\\gamma$ parameter is $\\delta$';
      
      const result = computeWordDiff(original, modified);
      
      expect(result.hasChanges).toBe(true);
      expect(result.itemId).toBeDefined();
    });

    it('should handle multi-line text', () => {
      const original = 'Line one\nLine two\nLine three';
      const modified = 'Line one modified\nLine two\nLine three modified';
      
      const result = computeWordDiff(original, modified);
      
      expect(result.hasChanges).toBe(true);
      expect(result.changes.some(c => c.modified === 'modified')).toBe(true);
    });

    it('should preserve word-level granularity', () => {
      const original = 'This sentence has five words';
      const modified = 'This sentence has many more words';
      
      const result = computeWordDiff(original, modified);
      
      expect(result.hasChanges).toBe(true);
      expect(result.changes.some(c => c.original === 'five')).toBe(true);
      expect(result.changes.some(c => c.modified === 'many')).toBe(true);
      expect(result.changes.some(c => c.type === 'addition')).toBe(true);
    });

    it('should calculate correct summary', () => {
      const original = 'Add some words and remove others';
      const modified = 'Add some different words and add new others';
      
      const result = computeWordDiff(original, modified);
      
      expect(result.summary.additions + result.summary.deletions + result.summary.modifications)
        .toBeGreaterThan(0);
    });

    it('should handle LaTeX commands in text', () => {
      const original = '\\textbf{Important} text here';
      const modified = '\\textbf{Important} modified text here';
      
      const result = computeWordDiff(original, modified);
      
      expect(result.hasChanges).toBe(true);
    });
  });
});
