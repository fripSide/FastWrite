/**
 * SyncTeX Parser - Parse synctex files for PDF-source synchronization
 */
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, basename } from "node:path";

interface SyncTexBlock {
	type: 'h' | 'v' | 'x' | 'k' | 'g' | '(' | ')' | '[' | ']' | '!' | 'f' | 'l' | 'c';
	page?: number;
	h?: number;  // horizontal position
	v?: number;  // vertical position
	w?: number;  // width
	W?: number;  // width (alternative)
	H?: number;  // height
	d?: number;  // depth
	file?: number;
	line?: number;
	column?: number;
	tag?: number;
}

interface SyncTexInput {
	tag: number;
	name: string;
}

interface SyncTexData {
	inputs: Map<number, string>;
	blocks: SyncTexBlock[];
	magnification: number;
	unit: number;
	xOffset: number;
	yOffset: number;
}

/**
 * Parse a synctex file (supports .synctex.gz and .synctex)
 */
export function parseSynctex(synctexPath: string): SyncTexData | null {
	if (!existsSync(synctexPath)) {
		// Try with .gz extension
		const gzPath = synctexPath + '.gz';
		if (existsSync(gzPath)) {
			synctexPath = gzPath;
		} else {
			return null;
		}
	}

	try {
		let content: string;

		if (synctexPath.endsWith('.gz')) {
			const compressed = readFileSync(synctexPath);
			content = gunzipSync(compressed).toString('utf-8');
		} else {
			content = readFileSync(synctexPath, 'utf-8');
		}

		return parseSynctexContent(content);
	} catch (error) {
		console.error('Failed to parse synctex file:', error);
		return null;
	}
}

/**
 * Parse synctex file content
 */
function parseSynctexContent(content: string): SyncTexData {
	const lines = content.split('\n');
	const data: SyncTexData = {
		inputs: new Map(),
		blocks: [],
		magnification: 1000,
		unit: 1,
		xOffset: 0,
		yOffset: 0
	};

	let currentPage = 0;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		// Parse header values
		if (trimmed.startsWith('Magnification:')) {
			data.magnification = parseInt(trimmed.split(':')[1] || '1000', 10);
			continue;
		}
		if (trimmed.startsWith('Unit:')) {
			data.unit = parseInt(trimmed.split(':')[1] || '1', 10);
			continue;
		}
		if (trimmed.startsWith('X Offset:')) {
			data.xOffset = parseInt(trimmed.split(':')[1] || '0', 10);
			continue;
		}
		if (trimmed.startsWith('Y Offset:')) {
			data.yOffset = parseInt(trimmed.split(':')[1] || '0', 10);
			continue;
		}

		// Parse input files
		if (trimmed.startsWith('Input:')) {
			const match = trimmed.match(/^Input:(\d+):(.+)$/);
			if (match && match[1] && match[2]) {
				data.inputs.set(parseInt(match[1], 10), match[2]);
			}
			continue;
		}

		// Parse content blocks
		const firstChar = trimmed[0];

		if (firstChar === '{') {
			// Page start: {pageNum
			const pageNum = parseInt(trimmed.substring(1), 10);
			if (!isNaN(pageNum)) {
				currentPage = pageNum;
			}
		} else if (firstChar === 'h' || firstChar === 'v' || firstChar === 'x' ||
			firstChar === 'k' || firstChar === 'g') {
			// Content blocks with coordinates
			const block = parseBlockLine(trimmed, currentPage);
			if (block) {
				data.blocks.push(block);
			}
		} else if (firstChar === '[' || firstChar === '(') {
			// Vbox/hbox start
			const block = parseBlockLine(trimmed, currentPage);
			if (block) {
				data.blocks.push(block);
			}
		}
	}

	return data;
}

/**
 * Parse a single block line
 */
function parseBlockLine(line: string, currentPage: number): SyncTexBlock | null {
	const type = line[0] as SyncTexBlock['type'];
	const rest = line.substring(1);

	const block: SyncTexBlock = { type, page: currentPage };

	// Parse comma-separated values
	const parts = rest.split(',');

	for (const part of parts) {
		const colonIdx = part.indexOf(':');
		if (colonIdx > 0) {
			const key = part.substring(0, colonIdx);
			const value = parseInt(part.substring(colonIdx + 1), 10);

			switch (key) {
				case 'h': block.h = value; break;
				case 'v': block.v = value; break;
				case 'w': block.w = value; break;
				case 'W': block.W = value; break;
				case 'H': block.H = value; break;
				case 'd': block.d = value; break;
			}
		} else {
			// No colon - depends on block type
			// For most blocks: tag,line,column
			const numMatch = part.match(/^(\d+)/);
			if (numMatch && numMatch[1] && !block.tag) {
				block.tag = parseInt(numMatch[1], 10);
			}
		}
	}

	// Simple parsing for tag:line format
	const simpleMatch = rest.match(/^(\d+),(\d+)(?:,(\d+))?/);
	if (simpleMatch && simpleMatch[1] && simpleMatch[2]) {
		block.tag = parseInt(simpleMatch[1], 10);
		block.line = parseInt(simpleMatch[2], 10);
		if (simpleMatch[3]) {
			block.column = parseInt(simpleMatch[3], 10);
		}
	}

	return block;
}

/**
 * Find source location from PDF coordinates
 */
export function pdfToSource(
	synctexData: SyncTexData,
	page: number,
	x: number,
	y: number
): { filePath: string; line: number } | null {
	// Convert PDF coordinates to synctex units
	const unit = synctexData.unit || 1;
	const mag = synctexData.magnification / 1000 || 1;

	// PDF to synctex coordinate conversion (approximate)
	// Synctex uses scaled points (sp), 65536 sp = 1 pt
	const synctexX = x * 65536 / mag;
	const synctexY = y * 65536 / mag;

	// Find blocks on this page
	const pageBlocks = synctexData.blocks.filter(b => b.page === page);

	if (pageBlocks.length === 0) {
		return null;
	}

	// Find closest block with line information
	let bestBlock: SyncTexBlock | null = null;
	let bestDistance = Infinity;

	for (const block of pageBlocks) {
		if (block.line && block.tag !== undefined) {
			const bh = block.h || 0;
			const bv = block.v || 0;

			// Calculate distance (prioritize vertical match)
			const vDist = Math.abs(bv - synctexY);
			const hDist = Math.abs(bh - synctexX);
			const distance = vDist * 2 + hDist;

			if (distance < bestDistance) {
				bestDistance = distance;
				bestBlock = block;
			}
		}
	}

	if (!bestBlock || !bestBlock.line || bestBlock.tag === undefined) {
		// Fallback: return first block with line info on this page
		const fallback = pageBlocks.find(b => b.line && b.tag !== undefined);
		if (fallback && fallback.line && fallback.tag !== undefined) {
			const filePath = synctexData.inputs.get(fallback.tag);
			if (filePath) {
				return { filePath, line: fallback.line };
			}
		}
		return null;
	}

	const filePath = synctexData.inputs.get(bestBlock.tag);
	if (!filePath) {
		return null;
	}

	return { filePath, line: bestBlock.line };
}

/**
 * Find PDF location from source coordinates
 */
export function sourceToPdf(
	synctexData: SyncTexData,
	filePath: string,
	line: number
): { page: number; x: number; y: number } | null {
	// Find tag for file
	let fileTag: number | undefined;
	for (const [tag, path] of synctexData.inputs.entries()) {
		if (path.endsWith(basename(filePath)) || filePath.endsWith(path)) {
			fileTag = tag;
			break;
		}
	}

	if (fileTag === undefined) {
		return null;
	}

	// Find blocks matching tag and line
	let blocks = synctexData.blocks.filter(b => b.tag === fileTag && b.line === line);

	if (blocks.length === 0) {
		// Exact line not found - find closest line for this file
		const blocksForFile = synctexData.blocks.filter(b => b.tag === fileTag && b.line !== undefined);
		if (blocksForFile.length > 0) {
			// Find block with closest line number
			const closest = blocksForFile.reduce((best, block) => {
				const diff = Math.abs((block.line || 0) - line);
				const bestDiff = Math.abs((best.line || 0) - line);
				return diff < bestDiff ? block : best;
			});
			blocks = [closest];
		}
	}

	if (blocks.length === 0) {
		return null;
	}

	// Prefer horizontal blocks? or validation needed
	// For now take the first valid block
	const block = blocks[0];

	if (!block || !block.page || block.h === undefined || block.v === undefined) {
		return null;
	}

	// Convert synctex units (scaled points) to PDF points
	const unit = synctexData.unit || 1;
	const mag = synctexData.magnification / 1000 || 1;

	// PDF points = sp * mag / 65536
	const x = block.h * mag / 65536;
	const y = block.v * mag / 65536;

	return {
		page: block.page,
		x: Math.round(x),
		y: Math.round(y)
	};
}

/**
 * Get synctex path for a PDF
 */
export function getSynctexPath(pdfPath: string): string {
	return pdfPath.replace(/\.pdf$/, '.synctex.gz');
}
