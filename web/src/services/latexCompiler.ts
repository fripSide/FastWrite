/**
 * Browser-based LaTeX compiler service using Siglum (WASM).
 * Singleton wrapper around SiglumCompiler.
 */

import { SiglumCompiler } from '@siglum/engine';

export interface CompileOptions {
    engine?: string;
    useCache?: boolean;
    additionalFiles?: Record<string, string | Uint8Array>;
}

export interface CompileResult {
    success: boolean;
    pdf?: Uint8Array;
    pdfIsShared?: boolean;
    log?: string;
    error?: string;
    exitCode?: number;
}

const CDN_BASE = 'https://cdn.siglum.org/tl2025';

let compiler: SiglumCompiler | null = null;
let initPromise: Promise<void> | null = null;
let logMessages: string[] = [];
let localResourcesLoaded = false;
const RESOURCE_FETCH_CONCURRENCY = 24;
const RESOURCE_FETCH_RETRIES = 2;
const SKIPPED_LOCAL_MAP_PATHS = new Set([
    '/texlive/texmf-dist/fonts/map/dvips/mt11p/mt11p.map',
    '/texlive/texmf-dist/fonts/map/dvips/mtpro2/mtpro2.map',
    '/texlive/texmf-dist/dvips/mtpro2/mtpro2.map',
]);

/** Get or create the singleton compiler instance */
function getCompiler(): SiglumCompiler {
    if (!compiler) {
        compiler = new SiglumCompiler({
            bundlesUrl: '/bundles',
            wasmUrl: '/busytex.wasm',
            workerUrl: '/worker.js',
            enableCtan: false,     // Disable CTAN: no public proxy available
            enableLazyFS: true,    // Lazy load for faster startup
            enableDocCache: true,  // Cache compiled PDFs by preamble hash
            verbose: true,         // Enable verbose for debugging
            eagerBundles: {
                pdflatex: ['extra-misc', 'tex-latex-misc'],
                xelatex: ['extra-misc', 'tex-latex-misc', 'fonts-lm-type1'],
                lualatex: ['extra-misc', 'tex-latex-misc', 'fonts-lm-type1'],
            }, // Force load common extras; Xe/LuaTeX also need LM Type1 for xdvipdfmx/pdf output fallback
            onLog: (msg: string) => {
                logMessages.push(msg);
            },
            onProgress: (stage: string, detail: string) => {
                console.log(`[LaTeX] ${stage}: ${detail}`);
            },
        });
    }
    return compiler;
}

/**
 * Load local packages from /local-packages/ and inject into the compiler's
 * CTAN fetcher cache. These are pre-downloaded TeX packages (algorithm,
 * booktabs, listings, lipsum, etc.) that aren't included in the standard
 * bundles. Files are loaded once at init and passed to the worker on every
 * compile via the ctanFiles mechanism.
 */
async function loadManifestResources(
    manifestUrl: string,
    label: string,
    c: SiglumCompiler
): Promise<number> {
    const resp = await fetch(manifestUrl);
    if (!resp.ok) {
        console.warn(`[LaTeX] No ${label} manifest found`);
        return 0;
    }

    const manifest: Record<string, { localPath: string; size: number }> = await resp.json();
    const entries = Object.entries(manifest).filter(([texPath]) => !SKIPPED_LOCAL_MAP_PATHS.has(texPath));
    console.log(`[LaTeX] Loading ${entries.length} ${label} files...`);

    const fetchResource = async (texPath: string, localPath: string): Promise<{ texPath: string; data: Uint8Array }> => {
        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= RESOURCE_FETCH_RETRIES; attempt++) {
            try {
                const fileResp = await fetch('/' + localPath);
                if (!fileResp.ok) {
                    throw new Error(`HTTP ${fileResp.status}`);
                }
                const data = new Uint8Array(await fileResp.arrayBuffer());
                return { texPath, data };
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < RESOURCE_FETCH_RETRIES) {
                    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
                }
            }
        }
        throw new Error(`Failed to fetch ${localPath}: ${lastError?.message ?? 'unknown error'}`);
    };

    const results: PromiseSettledResult<{ texPath: string; data: Uint8Array }>[] = [];
    for (let i = 0; i < entries.length; i += RESOURCE_FETCH_CONCURRENCY) {
        const batch = entries.slice(i, i + RESOURCE_FETCH_CONCURRENCY);
        const batchResults = await Promise.allSettled(
            batch.map(([texPath, info]) => fetchResource(texPath, info.localPath))
        );
        results.push(...batchResults);
    }

    const fetcher = (c as any).ctanFetcher;
    let loaded = 0;
    const failed: string[] = [];
    for (const r of results) {
        if (r.status === 'fulfilled') {
            fetcher.fileCache.set(r.value.texPath, r.value.data);
            loaded++;
        } else {
            failed.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        }
    }

    console.log(`[LaTeX] Loaded ${loaded}/${entries.length} ${label} files`);
    if (failed.length > 0) {
        console.warn(
            `[LaTeX] Failed to load ${failed.length} ${label} files. ` +
            `First failures: ${failed.slice(0, 10).join(' | ')}`
        );
    }
    return loaded;
}

async function loadLocalResources(c: SiglumCompiler): Promise<void> {
    if (localResourcesLoaded) return;
    try {
        await loadManifestResources('/local-packages/manifest.json', 'local package', c);
        localResourcesLoaded = true;
    } catch (e) {
        console.warn('[LaTeX] Failed to load local resources:', e);
    }
}

/** Initialize (pre-warm) the compiler. Safe to call multiple times. */
export async function init(): Promise<void> {
    if (!initPromise) {
        const c = getCompiler();
        initPromise = (async () => {
            await c.init();
            await loadLocalResources(c);
        })().catch((err) => {
            console.error('[LaTeX] Failed to initialize compiler:', err);
            initPromise = null; // Allow retry
            throw err;
        });
    }
    return initPromise;
}

/** Pre-warm the compiler in the background (fire and forget). */
export function prewarm(): void {
    init().catch(() => { }); // Silently swallow errors during prewarm
}

/** Check if the compiler is ready to compile. */
export function isReady(): boolean {
    return compiler?.isReady() ?? false;
}

/**
 * Compile LaTeX source to PDF in the browser.
 *
 * @param source - The main LaTeX source code
 * @param options - Additional files, engine selection, etc.
 * @returns CompileResult with { success, pdf, log, error }
 */
export async function compile(
    source: string,
    options?: CompileOptions
): Promise<CompileResult> {
    // Ensure compiler is initialized
    await init();

    // Clear log buffer for this compilation
    logMessages = [];

    const c = getCompiler();
    const result = await c.compile(source, options);

    const capturedLog = logMessages.join('\n');
    if (capturedLog) {
        if (result.log && result.log !== capturedLog) {
            (result as any).log = `${capturedLog}\n${result.log}`;
        } else if (!result.log) {
            (result as any).log = capturedLog;
        }
    }

    return result;
}

/** Get the log from the last compilation. */
export function getLastLog(): string {
    return logMessages.join('\n');
}

/** Clear all caches (CTAN packages, compiled PDFs). */
export async function clearCache(): Promise<void> {
    if (compiler) {
        await compiler.clearCache();
    }
}

/** Unload the compiler to free memory. */
export function unload(): void {
    if (compiler) {
        compiler.unload();
        compiler = null;
        initPromise = null;
        localResourcesLoaded = false;
    }
}
