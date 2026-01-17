// Embedded web assets for single binary distribution
// These imports embed the files directly into the Bun binary

// @ts-ignore - Bun file embed
import indexHtml from "../web/dist/index.html" with { type: "file" };
// @ts-ignore - Bun file embed  
import indexCss from "../web/dist/assets/index-CzLmtdS5.css" with { type: "file" };
// @ts-ignore - Bun file embed
import indexJs from "../web/dist/assets/index-ZIHSvWh0.js" with { type: "file" };
// @ts-ignore - Bun file embed
import viteExternal from "../web/dist/assets/__vite-browser-external-BIHI7g3E.js" with { type: "file" };

// Bun embeds return file paths that work with Bun.file()
export const EMBEDDED_ASSETS: Record<string, any> = {
	"/": indexHtml,
	"/index.html": indexHtml,
	"/assets/index-CzLmtdS5.css": indexCss,
	"/assets/index-ZIHSvWh0.js": indexJs,
	"/assets/__vite-browser-external-BIHI7g3E.js": viteExternal,
};

export function isEmbeddedAsset(path: string): boolean {
	return path in EMBEDDED_ASSETS;
}

export function getEmbeddedAsset(path: string): any {
	return EMBEDDED_ASSETS[path];
}
