/**
 * Browser-based LaTeX compiler service using Siglum (WASM).
 * Singleton wrapper around SiglumCompiler.
 */

import { SiglumCompiler, createBatchedLogger } from '@siglum/engine';

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
let localPackagesLoaded = false;

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
            eagerBundles: ['extra-misc', 'tex-latex-misc'], // Force load extra + commonly used packages (geometry, natbib, etc.)
            onLog: createBatchedLogger((msgs: string[]) => {
                logMessages.push(...msgs);
            }),
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
async function loadLocalPackages(c: SiglumCompiler): Promise<void> {
    if (localPackagesLoaded) return;
    try {
        const resp = await fetch('/local-packages/manifest.json');
        if (!resp.ok) {
            console.warn('[LaTeX] No local packages manifest found');
            return;
        }
        const manifest: Record<string, { localPath: string; size: number }> = await resp.json();
        const entries = Object.entries(manifest);
        console.log(`[LaTeX] Loading ${entries.length} local package files...`);

        // Fetch all files in parallel
        const results = await Promise.allSettled(
            entries.map(async ([texPath, info]) => {
                const resp = await fetch('/' + info.localPath);
                if (!resp.ok) throw new Error(`Failed to fetch ${info.localPath}: ${resp.status}`);
                const data = new Uint8Array(await resp.arrayBuffer());
                return { texPath, data };
            })
        );

        // Inject into ctanFetcher.fileCache (the internal Map that getCachedFiles() reads)
        const fetcher = (c as any).ctanFetcher;
        let loaded = 0;
        for (const r of results) {
            if (r.status === 'fulfilled') {
                fetcher.fileCache.set(r.value.texPath, r.value.data);
                loaded++;
            }
        }

        console.log(`[LaTeX] Loaded ${loaded}/${entries.length} local package files`);
        localPackagesLoaded = true;
    } catch (e) {
        console.warn('[LaTeX] Failed to load local packages:', e);
    }
}

/** Initialize (pre-warm) the compiler. Safe to call multiple times. */
export async function init(): Promise<void> {
    if (!initPromise) {
        const c = getCompiler();
        initPromise = (async () => {
            await c.init();
            await loadLocalPackages(c);
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

    // Append captured logs to result
    if (logMessages.length > 0 && !result.log) {
        (result as any).log = logMessages.join('\n');
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
    }
}
