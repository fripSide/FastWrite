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
 * Format: {type}{tag},{line}:{h},{v}:{w},{H},{d} or {type}{tag},{line},{column}
 */
function parseBlockLine(line: string, currentPage: number): SyncTexBlock | null {
	const type = line[0] as SyncTexBlock['type'];
	const rest = line.substring(1);

	const block: SyncTexBlock = { type, page: currentPage };

	// Split by : first to separate tag,line from coordinates
	const colonParts = rest.split(':');

	// First part contains tag,line (e.g., "62,12" from "h62,12:...")
	if (colonParts[0]) {
		const tagLineParts = colonParts[0].split(',');
		if (tagLineParts[0]) {
			block.tag = parseInt(tagLineParts[0], 10);
		}
		if (tagLineParts[1]) {
			block.line = parseInt(tagLineParts[1], 10);
		}
		if (tagLineParts[2]) {
			block.column = parseInt(tagLineParts[2], 10);
		}
	}

	// Second part contains h,v coordinates (e.g., "4736286,4736286" from ":4736286,4736286:0,0,0")
	if (colonParts[1]) {
		const hvParts = colonParts[1].split(',');
		if (hvParts[0]) {
			block.h = parseInt(hvParts[0], 10);
		}
		if (hvParts[1]) {
			block.v = parseInt(hvParts[1], 10);
		}
	}

	// Third part contains w,H,d (width, height, depth) (e.g., "0,0,0" or "1234567,654321,0")
	if (colonParts[2]) {
		const whdParts = colonParts[2].split(',');
		if (whdParts[0]) {
			block.w = parseInt(whdParts[0], 10);
		}
		if (whdParts[1]) {
			block.H = parseInt(whdParts[1], 10);
		}
		if (whdParts[2]) {
			block.d = parseInt(whdParts[2], 10);
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
): { page: number; x: number; y: number; width: number; height: number } | null {
	// Normalize file path (remove ./ and resolve)
	const normalizeP = (p: string) => p.replace(/\/\.\//g, '/').replace(/^\.\//g, '');
	const normalizedFilePath = normalizeP(filePath);
	const fileBasename = basename(filePath);

	// Find tag for file
	let fileTag: number | undefined;
	for (const [tag, path] of synctexData.inputs.entries()) {
		const normalizedSyncPath = normalizeP(path);
		// Match by: same basename, or normalized paths end with each other
		if (basename(path) === fileBasename ||
			normalizedSyncPath.endsWith(normalizedFilePath) ||
			normalizedFilePath.endsWith(normalizedSyncPath)) {
			fileTag = tag;
			break;
		}
	}

	if (fileTag === undefined) {
		console.log('[synctex] No file tag found for:', filePath, 'Available inputs:', Array.from(synctexData.inputs.values()).slice(0, 5));
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

	// When multiple blocks match, prefer:
	// 1. If any block has y > 800 (page height ~842pt), prefer blocks on later pages
	// 2. Otherwise, prefer the block with smallest y (closest to content start)
	let block = blocks[0];

	if (blocks.length > 1) {
		// Sort by page (ascending), then by v/y coordinate (ascending)
		blocks.sort((a, b) => {
			// First, compare pages
			if ((a.page || 0) !== (b.page || 0)) {
				return (a.page || 0) - (b.page || 0);
			}
			// Same page, compare y (v) coordinate - prefer smaller y (top of page)
			return (a.v || 0) - (b.v || 0);
		});

		const firstBlock = blocks[0];
		if (firstBlock) {
			// Check if first block's y is too close to page bottom (synctex returns ~842 for A4 page)
			const firstY = (firstBlock.v || 0) * (synctexData.magnification / 1000 || 1) / 65536;
			if (firstY > 780 && blocks.length > 1) {
				// Content likely wrapped to next page, use the second block if on different page
				const secondBlock = blocks.find(b => (b.page || 0) > (firstBlock.page || 0));
				if (secondBlock) {
					block = secondBlock;
				} else {
					block = firstBlock;
				}
			} else {
				block = firstBlock;
			}
		}
	}

	if (!block || !block.page || block.h === undefined || block.v === undefined) {
		return null;
	}

	// Convert synctex units (scaled points) to PDF points
	const unit = synctexData.unit || 1;
	const mag = synctexData.magnification / 1000 || 1;

	// PDF points
	const x = block.h * mag / 65536;
	const y = block.v * mag / 65536;

	// Synctex usually returns coordinates from bottom-left (Y-up).
	// We will handle inversion in the frontend where we know the page height.

	// Get width and height if available
	const rawW = block.w || block.W || 0;
	const rawH = block.H || 0;
	const w = (rawW * mag / 65536) || 300; // default width if 0
	const h = (rawH * mag / 65536) || 15; // default height if 0


	return {
		page: block.page,
		x: x,
		y: Math.max(0, y), // Ensure non-negative
		width: Math.round(w),
		height: Math.round(h)
	};
}

/**
 * Get synctex path for a PDF
 */
export function getSynctexPath(pdfPath: string): string {
	return pdfPath.replace(/\.pdf$/, '.synctex.gz');
}
