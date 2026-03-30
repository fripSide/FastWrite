import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const PROJECT_ROOT = process.cwd();
const WEB_PUBLIC_DIR = join(PROJECT_ROOT, 'web', 'public');
const LOCAL_PACKAGES_DIR = join(WEB_PUBLIC_DIR, 'local-packages');
const LOCAL_PACKAGES_DOWNLOADS_DIR = join(LOCAL_PACKAGES_DIR, 'downloads');
const LOCAL_PACKAGES_EXTRACTED_DIR = join(LOCAL_PACKAGES_DIR, 'extracted');
const LOCAL_PACKAGES_MANIFEST = join(LOCAL_PACKAGES_DIR, 'manifest.json');
const TEMPLATES_DIR = join(WEB_PUBLIC_DIR, 'templates');
const TEMPLATES_DOWNLOADS_DIR = join(TEMPLATES_DIR, 'downloads');
const TEMPLATES_EXTRACTED_DIR = join(TEMPLATES_DIR, 'extracted');
const TEMPLATES_MANIFEST = join(TEMPLATES_DIR, 'manifest.json');
const BUNDLE_FILE_MANIFEST = join(WEB_PUBLIC_DIR, 'bundles', 'file-manifest.json');
const BUNDLES_MANIFEST = join(WEB_PUBLIC_DIR, 'bundles', 'bundles.json');
const PACKAGE_ALIASES_FILE = join(WEB_PUBLIC_DIR, 'latexPackageAliases.json');
const FONT_FILE_INDEX_FILE = join(WEB_PUBLIC_DIR, 'latexFontFileIndex.json');

const PRESERVED_RUNTIME_ROOTS = [
  'tex',
  'bibtex',
  'fonts',
  'dvips',
  'metafont',
  'scripts',
  'makeindex',
  'context',
];

const NON_RUNTIME_TEXMF_ROOTS = [
  'source',
  'doc',
  'tlpkg',
];

const RUNTIME_FILE_EXTENSIONS = new Set([
  '.sty', '.cls', '.tex', '.cfg', '.def', '.fd', '.ldf', '.clo',
  '.bst', '.bib', '.bbx', '.cbx', '.lbx',
  '.map', '.enc', '.pfb', '.tfm', '.vf', '.afm', '.otf', '.ttf',
]);

const FONT_FILE_EXTENSIONS = new Set([
  '.pfb', '.tfm', '.vf', '.afm', '.map', '.enc', '.otf', '.ttf',
]);

let fontFileIndexCache: Record<string, string[]> | null = null;
let aliasWarmupPromise: Promise<void> | null = null;

interface PackageAliasEntry {
  package: string;
  downloadUrl?: string;
}

interface OfficialTemplateSource {
  id: string;
  description: string;
  packages: string[];
  matchFiles: string[];
  archiveUrls?: string[];
  templateFiles?: Array<{
    url: string;
    targetPath: string;
  }>;
}

type PackageInstallErrorCode =
  | 'download_failed'
  | 'archive_invalid'
  | 'extract_failed'
  | 'no_generation_rule'
  | 'latex_command_missing'
  | 'generation_failed'
  | 'target_not_generated'
  | 'runtime_files_missing'
  | 'install_failed'
  | 'integrity_check_failed';

interface PackageInstallErrorInfo {
  pkg: string;
  requestedFiles: string[];
  error: string;
  errorCode: PackageInstallErrorCode;
}

type ArchiveInstallMode =
  | 'direct-runtime'
  | 'generated-runtime'
  | 'font-assets-only'
  | 'unsupported-for-request';

interface ArchiveInspectionResult {
  ok: boolean;
  mode: ArchiveInstallMode;
  usableFiles: string[];
  primaryRuntimeFiles: string[];
  attemptedGeneration: boolean;
  error?: string;
  errorCode?: PackageInstallErrorCode;
}

interface DownloadedArchiveInfo {
  archivePath: string;
  downloadedUrl: string;
  sourceDescription: string;
}

const OFFICIAL_TEMPLATE_SOURCES: OfficialTemplateSource[] = [];

const FONT_PACKAGE_URL_BUILDERS = [
  (pkg: string) => `https://mirrors.ctan.org/fonts/${pkg}.zip`,
  (pkg: string) => `https://mirrors.ctan.org/fonts/${pkg}.tar.xz`,
  (pkg: string) => `https://mirrors.ctan.org/install/fonts/${pkg}.tds.zip`,
];

const GENERAL_PACKAGE_URL_BUILDERS = [
  (pkg: string) => `https://mirrors.ctan.org/install/macros/latex/required/${pkg}.tds.zip`,
  (pkg: string) => `https://mirrors.ctan.org/macros/latex/required/${pkg}.zip`,
  (pkg: string) => `https://mirrors.ctan.org/macros/latex/required/${pkg}.tar.xz`,
  (pkg: string) => `https://mirrors.ctan.org/install/macros/latex/contrib/${pkg}.tds.zip`,
  (pkg: string) => `https://mirrors.ctan.org/macros/latex/contrib/${pkg}.zip`,
  (pkg: string) => `https://mirrors.ctan.org/macros/latex/contrib/${pkg}.tar.xz`,
  (pkg: string) => `https://mirrors.ctan.org/install/macros/generic/${pkg}.tds.zip`,
  (pkg: string) => `https://mirrors.ctan.org/macros/generic/${pkg}.zip`,
  (pkg: string) => `https://mirrors.ctan.org/macros/generic/${pkg}.tar.xz`,
  (pkg: string) => `https://mirrors.ctan.org/install/biblio/bibtex/contrib/${pkg}.tds.zip`,
  (pkg: string) => `https://mirrors.ctan.org/biblio/bibtex/contrib/${pkg}.zip`,
  (pkg: string) => `https://mirrors.ctan.org/biblio/bibtex/contrib/${pkg}.tar.xz`,
];

// config for the package downlaad
export const ENABLE_LOG_BASED_RETRY_INSTALL = true;
const PACKAGE_DOWNLOAD_CONCURRENCY = 16;

function isDirectFontAsset(filename: string): boolean {
  return FONT_FILE_EXTENSIONS.has(extname(filename).toLowerCase());
}

function buildTargetPathFromFontCtanPath(ctanPath: string): string | null {
  const normalized = ctanPath.replace(/^\/+/, '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const kindIndex = parts.findIndex(part =>
    ['opentype', 'otf', 'type1', 'pfb', 'truetype', 'ttf', 'afm', 'tfm', 'vf', 'map', 'enc', 'dvips'].includes(part.toLowerCase())
  );
  if (kindIndex <= 0 || kindIndex >= parts.length - 1) {
    return null;
  }

  const packagePath = parts.slice(0, kindIndex);
  const kindPart = parts[kindIndex];
  if (!kindPart) {
    return null;
  }
  const kind = kindPart.toLowerCase();
  const remainder = parts.slice(kindIndex + 1);

  switch (kind) {
    case 'opentype':
    case 'otf':
      return join('fonts', 'opentype', 'public', ...packagePath, ...remainder);
    case 'truetype':
    case 'ttf':
      return join('fonts', 'truetype', 'public', ...packagePath, ...remainder);
    case 'type1':
    case 'pfb':
      return join('fonts', 'type1', 'public', ...packagePath, ...remainder);
    case 'afm':
      return join('fonts', 'afm', 'public', ...packagePath, ...remainder);
    case 'tfm':
      return join('fonts', 'tfm', 'public', ...packagePath, ...remainder);
    case 'vf':
      return join('fonts', 'vf', 'public', ...packagePath, ...remainder);
    case 'map':
      return join('fonts', 'map', ...packagePath, ...remainder);
    case 'enc':
      return join('fonts', 'enc', ...packagePath, ...remainder);
    case 'dvips':
      return join('fonts', 'map', 'dvips', ...packagePath, ...remainder);
    default:
      return null;
  }
}

function buildDirectFontFileCandidates(filename: string): Array<{ url: string; targetPath: string; ctanPath: string }> {
  const file = basename(filename);
  const normalized = normalizeFileToken(file);
  const fontFileIndex = loadFontFileIndex();
  const ctanPaths = fontFileIndex[normalized] || [];

  return ctanPaths
    .map(ctanPath => {
      const targetPath = buildTargetPathFromFontCtanPath(ctanPath);
      if (!targetPath) {
        return null;
      }
      return {
        url: `https://mirrors.ctan.org/fonts/${ctanPath}`,
        targetPath,
        ctanPath,
      };
    })
    .filter((value): value is { url: string; targetPath: string; ctanPath: string } => Boolean(value));
}

export interface PackageInstallSummary {
  requestedFiles: string[];
  missingFiles: string[];
  resolvedPackages: Record<string, string>;
  unresolvedFiles: string[];
  installedPackages: string[];
  addedFiles: string[];
  bundleHintPackages: string[];
  packageErrors: Array<{
    packageName: string;
    requestedFiles: string[];
    errorCode: PackageInstallErrorCode;
    reason: string;
  }>;
  manifestUpdated: boolean;
  logRetryInstallEnabled: boolean;
}

export interface PackageInstallProgress {
  stage: 'analyzing' | 'resolving' | 'downloading' | 'installing' | 'completed';
  pendingPackages: string[];
  currentPackage: string | null;
  installedPackages: string[];
  totalPackages: number;
  completedPackages: number;
}

function ensureLocalPackagesDirs() {
  mkdirSync(LOCAL_PACKAGES_DIR, { recursive: true });
  mkdirSync(LOCAL_PACKAGES_DOWNLOADS_DIR, { recursive: true });
  mkdirSync(LOCAL_PACKAGES_EXTRACTED_DIR, { recursive: true });
}

function ensureTemplateDirs() {
  mkdirSync(TEMPLATES_DIR, { recursive: true });
  mkdirSync(TEMPLATES_DOWNLOADS_DIR, { recursive: true });
  mkdirSync(TEMPLATES_EXTRACTED_DIR, { recursive: true });
}

function initializeLocalPackagesIfEmpty() {
  ensureLocalPackagesDirs();

  let entries: string[] = [];
  try {
    entries = readdirSync(LOCAL_PACKAGES_DIR);
  } catch {
    entries = [];
  }

  if (entries.length === 0) {
    const rebuilt = rebuildLocalPackageManifest();
    if (!existsSync(LOCAL_PACKAGES_MANIFEST)) {
      writeFileSync(LOCAL_PACKAGES_MANIFEST, '{}\n', 'utf-8');
    }
    console.log(
      `[latexAutoPackages] Initialized empty local-packages directory at ${LOCAL_PACKAGES_DIR} ` +
      `(manifest entries: ${rebuilt.count})`
    );
  }
}

function initializeTemplatesIfEmpty() {
  ensureTemplateDirs();

  let entries: string[] = [];
  try {
    entries = readdirSync(TEMPLATES_DIR);
  } catch {
    entries = [];
  }

  if (entries.length === 0) {
    const rebuilt = rebuildManifestForExtractedDir(TEMPLATES_EXTRACTED_DIR, TEMPLATES_MANIFEST, 'templates/extracted');
    if (!existsSync(TEMPLATES_MANIFEST)) {
      writeFileSync(TEMPLATES_MANIFEST, '{}\n', 'utf-8');
    }
    console.log(
      `[latexAutoPackages] Initialized empty templates directory at ${TEMPLATES_DIR} ` +
      `(manifest entries: ${rebuilt.count})`
    );
  }
}

function normalizeFileToken(token: string): string {
  return basename(token.trim()).toLowerCase();
}

function loadPackageAliases(): Record<string, PackageAliasEntry> {
  if (!existsSync(PACKAGE_ALIASES_FILE)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(PACKAGE_ALIASES_FILE, 'utf-8')) as Record<
      string,
      string | { package?: string; downloadUrl?: string }
    >;
    const normalized: Record<string, PackageAliasEntry> = {};
    for (const [fileName, rawEntry] of Object.entries(parsed)) {
      const normalizedFile = normalizeFileToken(fileName);
      if (!normalizedFile) {
        continue;
      }

      const rawValue = typeof rawEntry === 'string' ? rawEntry.trim() : '';
      const rawDownloadUrl = typeof rawEntry === 'object' && rawEntry
        ? String(rawEntry.downloadUrl || '').trim()
        : (/^https?:\/\//i.test(rawValue) ? rawValue : '');
      const rawPackage = typeof rawEntry === 'object' && rawEntry
        ? String(rawEntry.package || '').trim()
        : (/^https?:\/\//i.test(rawValue) ? '' : rawValue);

      const inferredPackageFromUrl = rawDownloadUrl
        ? sanitizePackageName(
            basename(new URL(rawDownloadUrl).pathname).replace(/(\.tds\.zip|\.tar\.xz|\.tar\.gz|\.tgz|\.zip|\.tar)$/i, '')
          )
        : '';
      const normalizedPackage = sanitizePackageName(rawPackage || inferredPackageFromUrl);

      if (normalizedPackage) {
        normalized[normalizedFile] = {
          package: normalizedPackage,
          downloadUrl: rawDownloadUrl || undefined,
        };
      }
    }
    return normalized;
  } catch (error) {
    console.error('[latexAutoPackages] Failed to load package alias config:', error);
    return {};
  }
}

function loadFontFileIndex(): Record<string, string[]> {
  if (!existsSync(FONT_FILE_INDEX_FILE)) {
    fontFileIndexCache = {};
    return fontFileIndexCache;
  }

  try {
    const parsed = JSON.parse(readFileSync(FONT_FILE_INDEX_FILE, 'utf-8')) as { files?: Record<string, string[] | string> };
    const normalized: Record<string, string[]> = {};
    for (const [fileName, entry] of Object.entries(parsed.files || {})) {
      const normalizedFile = normalizeFileToken(fileName);
      const paths = Array.isArray(entry) ? entry : [entry];
      const cleanedPaths = paths
        .map(path => String(path || '').trim().replace(/^\/+/, ''))
        .filter(Boolean);
      if (!normalizedFile || cleanedPaths.length === 0) {
        continue;
      }
      normalized[normalizedFile] = cleanedPaths;
    }
    fontFileIndexCache = normalized;
  } catch (error) {
    console.error('[latexAutoPackages] Failed to load font file index config:', error);
    fontFileIndexCache = {};
  }

  return fontFileIndexCache;
}

function resolvePackageViaFontFileIndex(filename: string): { package: string; downloadUrl?: string } | null {
  const normalized = normalizeFileToken(filename);
  if (!normalized) {
    return null;
  }

  const fontFileIndex = loadFontFileIndex();
  const ctanPaths = fontFileIndex[normalized] || [];
  for (const ctanPath of ctanPaths) {
    const normalizedPath = String(ctanPath || '').trim().replace(/^\/+/, '');
    if (!normalizedPath) {
      continue;
    }
    const [container] = normalizedPath.split('/').filter(Boolean);
    const normalizedPackage = sanitizePackageName(container || '');
    if (!normalizedPackage) {
      continue;
    }
    return {
      package: normalizedPackage,
      downloadUrl: `https://mirrors.ctan.org/fonts/${normalizedPackage}.zip`,
    };
  }

  return null;
}

function sanitizePackageName(name: string): string {
  return name.trim().replace(/^["']|["']$/g, '').replace(/[^\w.+-]/g, '');
}

function sanitizeIncludePath(name: string): string {
  return name.trim().replace(/^["']|["']$/g, '').replace(/[\\]/g, '/').replace(/[^/\w.+-]/g, '');
}

function extractLastOpenedFilePath(logPrefix: string): string | null {
  const pathMatches = logPrefix.matchAll(/\((\.?\/?[^\s()]+?\.(?:tex|sty|cls|cfg|def|fd|ldf|clo|bst|bib|bbx|cbx|lbx))/g);
  let lastPath: string | null = null;
  for (const match of pathMatches) {
    lastPath = match[1] || null;
  }
  return lastPath;
}

function isLocalLatexSourcePath(filePath: string): boolean {
  const normalized = sanitizeIncludePath(filePath);
  if (!normalized || extname(normalized).toLowerCase() !== '.tex') {
    return false;
  }

  if (normalized.startsWith('/texlive/')) {
    return false;
  }

  return true;
}

function isLikelySourceIncludeFromContext(log: string, matchIndex: number | undefined, filename: string): boolean {
  const normalized = sanitizeIncludePath(filename);
  if (!normalized || extname(normalized).toLowerCase() !== '.tex') {
    return false;
  }

  const start = Math.max(0, (matchIndex || 0) - 2000);
  const prefix = log.slice(start, matchIndex || 0);
  const referencingFile = extractLastOpenedFilePath(prefix);
  if (!referencingFile) {
    return false;
  }

  return isLocalLatexSourcePath(referencingFile);
}

function stripComments(line: string): string {
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') {
      escaped = !escaped;
      continue;
    }
    if (ch === '%' && !escaped) {
      return line.slice(0, i);
    }
    escaped = false;
  }
  return line;
}

function fileExistsCaseInsensitive(filename: string, index: Map<string, string>): boolean {
  return index.has(normalizeFileToken(filename));
}

function hasUsableDirectFontMapping(filename: string, index: Map<string, string>): boolean {
  const texPath = index.get(normalizeFileToken(filename));
  if (!texPath) {
    return false;
  }
  return texPath.startsWith('/texlive/texmf-dist/fonts/');
}

function loadManifestIndexFromFile(manifestPath: string): Map<string, string> {
  const index = new Map<string, string>();

  if (!existsSync(manifestPath)) {
    return index;
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, { localPath: string }>;
    for (const texPath of Object.keys(manifest)) {
      index.set(normalizeFileToken(texPath), texPath);
    }
  } catch (error) {
    console.error(`[latexAutoPackages] Failed to load manifest ${manifestPath}:`, error);
  }

  return index;
}

function loadManifestIndex(): Map<string, string> {
  return loadManifestIndexFromFile(LOCAL_PACKAGES_MANIFEST);
}

function loadTemplateIndex(): Map<string, string> {
  return loadManifestIndexFromFile(TEMPLATES_MANIFEST);
}

function loadBundleIndex(): Map<string, string> {
  const index = new Map<string, string>();

  if (!existsSync(BUNDLE_FILE_MANIFEST)) {
    return index;
  }

  try {
    const manifest = JSON.parse(readFileSync(BUNDLE_FILE_MANIFEST, 'utf-8')) as Record<string, { bundle: string }>;
    for (const texPath of Object.keys(manifest)) {
      index.set(normalizeFileToken(texPath), texPath);
    }
  } catch (error) {
    console.error('[latexAutoPackages] Failed to load bundle manifest:', error);
  }

  return index;
}

function loadBundlePackageMap(): Map<string, string> {
  const index = new Map<string, string>();

  if (!existsSync(BUNDLES_MANIFEST)) {
    return index;
  }

  try {
    const bundles = JSON.parse(readFileSync(BUNDLES_MANIFEST, 'utf-8')) as { packages?: Record<string, string> };
    for (const pkgName of Object.keys(bundles.packages || {})) {
      const normalized = sanitizePackageName(pkgName).toLowerCase();
      if (normalized) {
        index.set(normalized, pkgName);
      }
    }
  } catch (error) {
    console.error('[latexAutoPackages] Failed to load bundles manifest:', error);
  }

  return index;
}

function resolveBundleHintPackageForFile(filename: string, bundlePackageMap: Map<string, string>): string | null {
  const normalized = normalizeFileToken(filename);
  if (extname(normalized) !== '.sty') {
    return null;
  }

  const stem = sanitizePackageName(basename(normalized, '.sty')).toLowerCase();
  if (!stem) {
    return null;
  }

  return bundlePackageMap.get(stem) || null;
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];

  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  };

  visit(dir);
  return results;
}

function rebuildManifestForExtractedDir(
  extractedDir: string,
  manifestPath: string,
  localBasePath: string
): { count: number; manifestUpdated: boolean } {
  mkdirSync(dirname(manifestPath), { recursive: true });
  mkdirSync(extractedDir, { recursive: true });
  const files = walkFiles(extractedDir);
  const manifest: Record<string, { localPath: string; size: number }> = {};

  for (const filePath of files) {
    const rel = relative(extractedDir, filePath).replace(/\\/g, '/');
    if (!rel) continue;
    const texPath = `/texlive/texmf-dist/${rel}`;
    manifest[texPath] = {
      localPath: `${localBasePath}/${rel}`,
      size: statSync(filePath).size,
    };
  }

  const next = JSON.stringify(manifest, null, 2);
  const prev = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf-8') : '';
  const manifestUpdated = prev !== next;
  if (manifestUpdated) {
    writeFileSync(manifestPath, next, 'utf-8');
  }

  return { count: Object.keys(manifest).length, manifestUpdated };
}

export function rebuildLocalPackageManifest(): { count: number; manifestUpdated: boolean } {
  ensureLocalPackagesDirs();
  return rebuildManifestForExtractedDir(LOCAL_PACKAGES_EXTRACTED_DIR, LOCAL_PACKAGES_MANIFEST, 'local-packages/extracted');
}

export function rebuildTemplateManifest(): { count: number; manifestUpdated: boolean } {
  ensureTemplateDirs();
  return rebuildManifestForExtractedDir(TEMPLATES_EXTRACTED_DIR, TEMPLATES_MANIFEST, 'templates/extracted');
}

function resolveLocalRuntimeFile(projectRoot: string, currentDir: string, fileName: string): string | null {
  const candidates = [
    join(currentDir, fileName),
    join(projectRoot, fileName),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function collectDependencies(
  texPath: string,
  projectRoot: string,
  visited = new Set<string>(),
  requiredFiles = new Set<string>()
): Set<string> {
  let resolved = texPath;
  if (!existsSync(resolved) && existsSync(`${resolved}.tex`)) {
    resolved = `${resolved}.tex`;
  }
  if (!existsSync(resolved)) return requiredFiles;

  const normalized = resolve(resolved);
  if (visited.has(normalized)) return requiredFiles;
  visited.add(normalized);

  const content = readFileSync(normalized, 'utf-8');
  const currentDir = dirname(normalized);

  for (const rawLine of content.split('\n')) {
    const line = stripComments(rawLine);
    if (!line.trim()) continue;

    const packageRegex = /\\(?:usepackage|RequirePackage)(?:\[[^\]]*])?\{([^}]*)\}/g;
    for (const match of line.matchAll(packageRegex)) {
      const items = (match[1] || '').split(',').map(item => sanitizePackageName(item)).filter(Boolean);
      for (const item of items) {
        const runtimeFile = item.endsWith('.sty') ? item : `${item}.sty`;
        requiredFiles.add(runtimeFile);
        const localRuntimeFile = resolveLocalRuntimeFile(projectRoot, currentDir, runtimeFile);
        if (localRuntimeFile) {
          collectDependencies(localRuntimeFile, projectRoot, visited, requiredFiles);
        }
      }
    }

    const classRegex = /\\documentclass(?:\[[^\]]*])?\{([^}]*)\}/g;
    for (const match of line.matchAll(classRegex)) {
      const item = sanitizePackageName(match[1] || '');
      if (item) {
        const runtimeFile = item.endsWith('.cls') ? item : `${item}.cls`;
        requiredFiles.add(runtimeFile);
        const localRuntimeFile = resolveLocalRuntimeFile(projectRoot, currentDir, runtimeFile);
        if (localRuntimeFile) {
          collectDependencies(localRuntimeFile, projectRoot, visited, requiredFiles);
        }
      }
    }

    const loadClassRegex = /\\(?:LoadClass|LoadClassWithOptions)(?:\[[^\]]*])?\{([^}]*)\}/g;
    for (const match of line.matchAll(loadClassRegex)) {
      const item = sanitizePackageName(match[1] || '');
      if (item) {
        const runtimeFile = item.endsWith('.cls') ? item : `${item}.cls`;
        requiredFiles.add(runtimeFile);
        const localRuntimeFile = resolveLocalRuntimeFile(projectRoot, currentDir, runtimeFile);
        if (localRuntimeFile) {
          collectDependencies(localRuntimeFile, projectRoot, visited, requiredFiles);
        }
      }
    }

    const bibStyleRegex = /\\bibliographystyle\{([^}]*)\}/g;
    for (const match of line.matchAll(bibStyleRegex)) {
      const item = sanitizePackageName(match[1] || '');
      if (item) requiredFiles.add(item.endsWith('.bst') ? item : `${item}.bst`);
    }

    const includeRegex = /\\(?:input|include)\{([^}]*)\}/g;
    for (const match of line.matchAll(includeRegex)) {
      const includePath = sanitizeIncludePath(match[1] || '');
      if (!includePath) continue;
      const candidate = includePath.endsWith('.tex') ? includePath : `${includePath}.tex`;
      collectDependencies(join(currentDir, candidate), projectRoot, visited, requiredFiles);
    }
  }

  return requiredFiles;
}

export function analyzeLatexRequiredFiles(mainTexPath: string): string[] {
  return Array.from(collectDependencies(mainTexPath, dirname(mainTexPath))).sort((a, b) => a.localeCompare(b));
}

function collectProjectRuntimeFiles(projectRoot: string): Set<string> {
  const found = new Set<string>();
  if (!existsSync(projectRoot)) {
    return found;
  }

  for (const file of walkFiles(projectRoot)) {
    const ext = extname(file).toLowerCase();
    if (!RUNTIME_FILE_EXTENSIONS.has(ext)) {
      continue;
    }
    const normalized = normalizeFileToken(basename(file));
    if (normalized) {
      found.add(normalized);
    }
  }

  return found;
}

export function extractMissingFilesFromCompileLog(log: string): string[] {
  const missing = new Set<string>();
  const patterns = [
    /LaTeX Error: File `([^']+)' not found\./g,
    /I can't find file `([^']+)'/g,
  ];

  for (const pattern of patterns) {
    for (const match of log.matchAll(pattern)) {
      const rawFile = (match[1] || '').trim();
      if (isLikelySourceIncludeFromContext(log, match.index, rawFile)) {
        continue;
      }
      const file = sanitizePackageName(rawFile);
      if (!file) continue;
      const ext = extname(file);
      if (ext && RUNTIME_FILE_EXTENSIONS.has(ext.toLowerCase())) {
        missing.add(file);
      }
    }
  }

  for (const match of log.matchAll(/kpathsea:\s+Running mktextfm\s+([^\s]+)/g)) {
    const fontStem = sanitizePackageName(match[1] || '');
    if (fontStem) {
      missing.add(fontStem.endsWith('.tfm') ? fontStem : `${fontStem}.tfm`);
    }
  }

  for (const match of log.matchAll(/Metric \(TFM\) file not found/g)) {
    const context = log.slice(Math.max(0, match.index - 160), Math.min(log.length, (match.index || 0) + 160));
    const fontMatch = context.match(/=([A-Za-z0-9_-]+)\s+at\s+[0-9.]+pt/);
    const fontStem = sanitizePackageName(fontMatch?.[1] || '');
    if (fontStem) {
      missing.add(`${fontStem}.tfm`);
    }
  }

  for (const match of log.matchAll(/pdfTeX error: .*?\(file\s+([A-Za-z0-9._-]+\.pfb)\):\s+cannot open Type 1 font file/gi)) {
    const file = sanitizePackageName(match[1] || '');
    if (file) {
      missing.add(file);
    }
  }

  for (const match of log.matchAll(/do not have .*?\(([A-Za-z0-9._-]+\.(?:sty|cls|bst|bib))\)\s+package installed/gi)) {
    const file = sanitizePackageName(match[1] || '');
    if (file) {
      missing.add(file);
    }
  }

  for (const match of log.matchAll(/The font\s+"([A-Za-z0-9._-]+)"\s+cannot be found/gi)) {
    const fontName = sanitizePackageName(match[1] || '');
    if (fontName) {
      missing.add(fontName.endsWith('.otf') || fontName.endsWith('.ttf') ? fontName : `${fontName}.otf`);
    }
  }

  for (const match of log.matchAll(/\(file\s+([A-Za-z0-9._-]+\.(?:pfb|tfm|vf|afm|map|enc|otf|ttf))\)/gi)) {
    const file = sanitizePackageName(match[1] || '');
    if (file) {
      missing.add(file);
    }
  }

  return Array.from(missing).sort((a, b) => a.localeCompare(b));
}

async function fetchCtanPackageInfo(packagePageName: string): Promise<{ package: string; downloadUrl?: string; pageHtml: string } | null> {
  const pageName = sanitizePackageName(packagePageName);
  if (!pageName) {
    return null;
  }

  const response = await fetch(`https://ctan.org/pkg/${encodeURIComponent(pageName)}?lang=en`, { redirect: 'follow' });
  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const bundleLinkMatch = html.match(/distributed as part of the\s+<a[^>]+href="\/pkg\/([^"\/?#]+)[^"]*"/i);
  const bundleTextMatch = html.match(/distributed as part of the\s+([A-Za-z0-9.+_-]+)\s+bundle/i);
  const downloadHrefMatch = html.match(/<a[^>]+href="(https:\/\/mirrors\.ctan\.org\/[^"]+)"[^>]*>\s*Download\s*<\/a>/i);
  const texLiveMatch = html.match(/Contained(?:&nbsp;|\s)+in.*?as\s+([A-Za-z0-9.+_-]+)/i);
  const downloadPath = downloadHrefMatch?.[1];
  const downloadContainer = downloadPath
    ? basename(new URL(downloadPath).pathname).replace(/(\.tds\.zip|\.tar\.xz|\.tar\.gz|\.tgz|\.zip|\.tar)$/i, '')
    : '';
  const resolvedPackage = sanitizePackageName(
    bundleLinkMatch?.[1]
    || bundleTextMatch?.[1]
    || downloadContainer
    || texLiveMatch?.[1]
    || pageName
  );

  if (!resolvedPackage) {
    return null;
  }

  return {
    package: resolvedPackage,
    downloadUrl: downloadPath,
    pageHtml: html,
  };
}

async function resolvePackageViaCtan(filename: string): Promise<string | null> {
  const normalized = normalizeFileToken(filename);
  if (isDirectFontAsset(normalized)) {
    return null;
  }
  const ext = extname(normalized);
  const stem = basename(normalized, ext);
  if (!stem) return null;

  const candidate = sanitizePackageName(stem);
  if (!candidate) return null;
  const fileTokenForMatch = normalized.toLowerCase();
  const stemTokenForMatch = stem.toLowerCase();

  try {
    const fileSearchResponse = await fetch(`https://ctan.org/search?phrase=${encodeURIComponent(normalized)}&ext=false&FILES=on`, {
      redirect: 'follow',
    });

    if (fileSearchResponse.ok) {
      const searchHtml = await fileSearchResponse.text();
      const pkgHrefMatch = searchHtml.match(/href="\/pkg\/([^"\/?#]+)"/i);
      if (pkgHrefMatch?.[1]) {
        const pkgInfo = await fetchCtanPackageInfo(pkgHrefMatch[1]);
        if (pkgInfo) {
          return pkgInfo.package;
        }
      }
    }

    const fallbackCandidates = [candidate];
    const stemWithoutExt = basename(normalized, ext).toLowerCase();
    const parts = stemWithoutExt.split('-').filter(Boolean);
    for (let len = parts.length - 1; len >= 1; len--) {
      const fallback = sanitizePackageName(parts.slice(0, len).join('-'));
      if (fallback && !fallbackCandidates.includes(fallback)) {
        fallbackCandidates.push(fallback);
      }
    }

    for (const fallback of fallbackCandidates) {
      const pkgInfo = await fetchCtanPackageInfo(fallback);
      if (!pkgInfo) {
        continue;
      }
      const isPrefixFallback = fallback !== candidate;
      const pageHtml = pkgInfo.pageHtml.toLowerCase();
      if (isPrefixFallback && !pageHtml.includes(fileTokenForMatch) && !pageHtml.includes(stemTokenForMatch)) {
        continue;
      }

      return pkgInfo.package;
    }

    return null;
  } catch {
    return null;
  }
}

async function resolvePackageForFile(filename: string): Promise<string | null> {
  const normalized = normalizeFileToken(filename);
  if (isDirectFontAsset(normalized)) {
    return null;
  }

  const packageAliases = loadPackageAliases();
  if (packageAliases[normalized]) {
    return packageAliases[normalized].package;
  }

  const fontIndexed = resolvePackageViaFontFileIndex(normalized);
  if (fontIndexed) {
    return fontIndexed.package;
  }

  const ext = extname(normalized);
  const stem = basename(normalized, ext);
  if (!stem) return null;

  const ctanResolved = await resolvePackageViaCtan(normalized);
  if (ctanResolved) {
    return ctanResolved;
  }

  return sanitizePackageName(stem);
}

async function fetchArchive(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) return null;
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

async function fetchArchiveWithUrl(url: string): Promise<{ data: Uint8Array; finalUrl: string } | null> {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) return null;
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length === 0) return null;
    return { data, finalUrl: response.url || url };
  } catch {
    return null;
  }
}

async function fetchArchiveWithDiagnostics(url: string): Promise<
  | { ok: true; data: Uint8Array; finalUrl: string }
  | { ok: false; url: string; error: string }
> {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      return { ok: false, url, error: `HTTP ${response.status}` };
    }
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length === 0) {
      return { ok: false, url, error: 'empty response body' };
    }
    return { ok: true, data, finalUrl: response.url || url };
  } catch (error) {
    return {
      ok: false,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getOfficialTemplateCandidates(pkg: string, requestedFiles: string[]): OfficialTemplateSource[] {
  const normalizedPkg = sanitizePackageName(pkg).toLowerCase();
  const normalizedFiles = new Set(requestedFiles.map(file => normalizeFileToken(file)));

  return OFFICIAL_TEMPLATE_SOURCES.filter(source => {
    const packageMatch = source.packages.some(candidate => sanitizePackageName(candidate).toLowerCase() === normalizedPkg);
    if (packageMatch) {
      return true;
    }

    return source.matchFiles.some(file => normalizedFiles.has(normalizeFileToken(file)));
  });
}

async function downloadOfficialTemplateArchive(
  pkg: string,
  requestedFiles: string[]
): Promise<{ archivePath: string; downloadedUrl: string; sourceDescription: string } | null> {
  ensureTemplateDirs();

  const candidates = getOfficialTemplateCandidates(pkg, requestedFiles);
  for (const source of candidates) {
    if (!source.archiveUrls?.length) {
      continue;
    }
    for (const url of source.archiveUrls) {
      const fetched = await fetchArchiveWithUrl(url);
      if (!fetched) continue;

      const filename = basename(new URL(fetched.finalUrl).pathname) || `${source.id}.zip`;
      const archivePath = join(TEMPLATES_DOWNLOADS_DIR, filename);
      writeDownloadedFile(archivePath, fetched.data);
      return {
        archivePath,
        downloadedUrl: fetched.finalUrl,
        sourceDescription: source.description,
      };
    }
  }

  return null;
}

async function downloadOfficialTemplateFiles(
  pkg: string,
  requestedFiles: string[]
): Promise<{ pkg: string; addedFiles: string[] } | PackageInstallErrorInfo | null> {
  ensureTemplateDirs();

  const candidates = getOfficialTemplateCandidates(pkg, requestedFiles);
  let sawDirectFileCandidate = false;
  for (const source of candidates) {
    if (!source.templateFiles?.length) {
      continue;
    }
    sawDirectFileCandidate = true;

    const addedFiles: string[] = [];
    let downloadedAny = false;

    for (const file of source.templateFiles) {
      const fetched = await fetchArchiveWithUrl(file.url);
      if (!fetched) {
        continue;
      }

      const tempPath = join(TEMPLATES_DOWNLOADS_DIR, basename(new URL(fetched.finalUrl).pathname) || basename(file.targetPath));
      writeDownloadedFile(tempPath, fetched.data);

      const dest = copyWithParentsToRoot(TEMPLATES_EXTRACTED_DIR, tempPath, file.targetPath);
      addedFiles.push(dest);
      downloadedAny = true;
    }

    if (!downloadedAny) {
      continue;
    }

    rebuildTemplateManifest();
    console.log(
      `[latexAutoPackages] Successfully installed official template ${pkg} ` +
      `(requested: ${requestedFiles.join(', ') || 'n/a'}, added files: ${addedFiles.length})`
    );
    return { pkg, addedFiles };
  }

  if (sawDirectFileCandidate) {
    const error = 'failed to download official template files';
    console.error(`[latexAutoPackages] Failed to download official template files for ${pkg}`);
    return { pkg, requestedFiles, error, errorCode: 'download_failed' };
  }

  return null;
}

async function downloadPackageArchive(
  pkg: string,
  requestedFiles: string[]
): Promise<DownloadedArchiveInfo | null> {
  ensureLocalPackagesDirs();
  const sanitizedRequestedFiles = requestedFiles.map(file => sanitizePackageName(file)).filter(Boolean);
  const wantsOnlyFontAssets =
    sanitizedRequestedFiles.length > 0 &&
    sanitizedRequestedFiles.every(isDirectFontAsset);

  const packageAliases = loadPackageAliases();
  const hintedDownloadUrl = requestedFiles
    .map(file => packageAliases[normalizeFileToken(file)]?.downloadUrl)
    .find((url): url is string => Boolean(url));

  if (hintedDownloadUrl) {
    console.log(`[latexAutoPackages] Trying package download for ${pkg}: ${hintedDownloadUrl}`);
    const fetched = await fetchArchiveWithUrl(hintedDownloadUrl);
    if (fetched) {
      const filename = basename(new URL(fetched.finalUrl).pathname);
      const archivePath = join(LOCAL_PACKAGES_DOWNLOADS_DIR, filename);
      writeDownloadedFile(archivePath, fetched.data);
      console.log(
        `[latexAutoPackages] Downloaded package archive for ${pkg} from ${fetched.finalUrl} ` +
        `-> ${archivePath}`
      );
      return { archivePath, downloadedUrl: fetched.finalUrl, sourceDescription: 'CTAN package download link' };
    }
    console.warn(`\x1b[33m[latexAutoPackages] Failed package download for ${pkg}: ${hintedDownloadUrl}\x1b[0m`);
  }

  const ctanPackageInfo = await fetchCtanPackageInfo(pkg);
  const ctanDownloadUrl = ctanPackageInfo?.downloadUrl?.trim();
  if (ctanDownloadUrl) {
    console.log(`[latexAutoPackages] Trying package download for ${pkg}: ${ctanDownloadUrl}`);
    const fetched = await fetchArchiveWithUrl(ctanDownloadUrl);
    if (fetched) {
      const filename = basename(new URL(fetched.finalUrl).pathname);
      const archivePath = join(LOCAL_PACKAGES_DOWNLOADS_DIR, filename);
      writeDownloadedFile(archivePath, fetched.data);
      console.log(
        `[latexAutoPackages] Downloaded package archive for ${pkg} from ${fetched.finalUrl} ` +
        `-> ${archivePath}`
      );
      return { archivePath, downloadedUrl: fetched.finalUrl, sourceDescription: 'CTAN package page download link' };
    }
    console.warn(`\x1b[33m[latexAutoPackages] Failed package download for ${pkg}: ${ctanDownloadUrl}\x1b[0m`);
  }

  const builders = wantsOnlyFontAssets
    ? FONT_PACKAGE_URL_BUILDERS
    : [...GENERAL_PACKAGE_URL_BUILDERS, ...FONT_PACKAGE_URL_BUILDERS];

  for (const buildUrl of builders) {
    const url = buildUrl(pkg);
    console.log(`[latexAutoPackages] Trying package download for ${pkg}: ${url}`);
    const fetched = await fetchArchiveWithUrl(url);
    if (!fetched) continue;

    const filename = basename(new URL(fetched.finalUrl).pathname);
    const archivePath = join(LOCAL_PACKAGES_DOWNLOADS_DIR, filename);
    writeDownloadedFile(archivePath, fetched.data);
    console.log(
      `[latexAutoPackages] Downloaded package archive for ${pkg} from ${fetched.finalUrl} ` +
      `-> ${archivePath}`
    );
    return { archivePath, downloadedUrl: fetched.finalUrl, sourceDescription: 'CTAN mirror' };
  }

  return null;
}

async function prefetchPackageArchives(
  packages: Array<{ pkg: string; requestedFiles: string[] }>
): Promise<Map<string, DownloadedArchiveInfo | null>> {
  const results = new Map<string, DownloadedArchiveInfo | null>();
  if (packages.length === 0) {
    return results;
  }

  let cursor = 0;
  const workerCount = Math.min(PACKAGE_DOWNLOAD_CONCURRENCY, packages.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < packages.length) {
      const current = packages[cursor++];
      if (!current) continue;
      const requested = current.requestedFiles
        .map(file => sanitizePackageName(file))
        .filter(Boolean);
      const wantsOnlyFontAssets = requested.length > 0 && requested.every(isDirectFontAsset);
      if (wantsOnlyFontAssets) {
        results.set(current.pkg, null);
        continue;
      }
      results.set(current.pkg, await downloadPackageArchive(current.pkg, current.requestedFiles));
    }
  });

  await Promise.all(workers);
  return results;
}

async function installDirectFontAssets(
  pkg: string,
  requestedFiles: string[],
  bundleIndex: Map<string, string>
): Promise<{ pkg: string; addedFiles: string[] } | PackageInstallErrorInfo | null> {
  const fontFiles = requestedFiles
    .map(file => sanitizePackageName(file))
    .filter(Boolean)
    .filter(isDirectFontAsset);

  if (fontFiles.length === 0 || fontFiles.length !== requestedFiles.length) {
    return null;
  }

  ensureLocalPackagesDirs();

  const addedFiles: string[] = [];
  const failedFiles: string[] = [];
  for (const fontFile of fontFiles) {
    const candidates = buildDirectFontFileCandidates(fontFile);
    if (candidates.length === 0) {
      console.warn(`\x1b[33m[latexAutoPackages] No direct font download candidates for ${fontFile}\x1b[0m`);
      failedFiles.push(fontFile);
      continue;
    }
    let installed = false;
    const attemptErrors: string[] = [];

    for (const candidate of candidates) {
      console.log(`[latexAutoPackages] Trying direct font download for ${fontFile}: ${candidate.url}`);
      const fetched = await fetchArchiveWithDiagnostics(candidate.url);
      if (!fetched.ok) {
        const failedFetch = fetched;
        attemptErrors.push(`${candidate.url} -> ${failedFetch.error}`);
        continue;
      }

      const filename = basename(new URL(fetched.finalUrl).pathname) || basename(candidate.targetPath);
      const tempPath = join(LOCAL_PACKAGES_DOWNLOADS_DIR, filename);
      writeDownloadedFile(tempPath, fetched.data);
      addedFiles.push(copyWithParentsToRoot(LOCAL_PACKAGES_EXTRACTED_DIR, tempPath, candidate.targetPath));
      console.log(`[latexAutoPackages] Downloaded direct font asset ${fontFile} from ${fetched.finalUrl} -> ${candidate.targetPath}`);
      installed = true;
      break;
    }

    if (!installed) {
      console.warn(
        `\x1b[33m[latexAutoPackages] Failed direct font download for ${fontFile}: ${attemptErrors.join(' | ')}\x1b[0m`
      );
      failedFiles.push(fontFile);
    }
  }

  if (addedFiles.length === 0) {
    if (failedFiles.length > 0) {
      return {
        pkg,
        requestedFiles,
        error: `failed to download direct font file(s): ${failedFiles.join(', ')}`,
        errorCode: 'download_failed',
      };
    }
    return null;
  }

  rebuildLocalPackageManifest();

  const nextLocalIndex = loadManifestIndex();
  const integrity = validateInstalledPackage(pkg, requestedFiles, nextLocalIndex, bundleIndex);
  if (!integrity.ok) {
    const error = `package failed integrity check: ${integrity.problems.join('; ')}`;
    return { pkg, requestedFiles, error, errorCode: 'integrity_check_failed' };
  }

  if (failedFiles.length > 0) {
    const error = `failed to download direct font file(s): ${failedFiles.join(', ')}`;
    return { pkg, requestedFiles, error, errorCode: 'download_failed' };
  }

  console.log(
    `[latexAutoPackages] Successfully installed package ${pkg} ` +
    `(requested: ${requestedFiles.join(', ') || 'n/a'}, added files: ${addedFiles.length})`
  );
  return { pkg, addedFiles };
}

function extractArchive(archivePath: string, outputDir: string) {
  mkdirSync(outputDir, { recursive: true });

  if (archivePath.endsWith('.zip')) {
    execSync(`unzip -oq "${archivePath}" -d "${outputDir}"`, { stdio: 'pipe' });
    return;
  }

  execSync(`tar -xf "${archivePath}" -C "${outputDir}"`, { stdio: 'pipe' });
}

function isSupportedArchive(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.xz')
  );
}

function extractNestedArchives(outputDir: string) {
  const processed = new Set<string>();
  let extractedAny = true;

  while (extractedAny) {
    extractedAny = false;

    for (const file of walkFiles(outputDir)) {
      if (!isSupportedArchive(file) || processed.has(file)) {
        continue;
      }

      processed.add(file);
      const nestedBase = join(dirname(file), basename(file, extname(file)));
      mkdirSync(nestedBase, { recursive: true });

      try {
        extractArchive(file, nestedBase);
        extractedAny = true;
      } catch {
        // Ignore nested archives we cannot extract; outer package handling continues.
      }
    }
  }
}

function extractArchiveSafe(archivePath: string, outputDir: string): string | null {
  try {
    extractArchive(archivePath, outputDir);
    extractNestedArchives(outputDir);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function validateArchiveReadable(archivePath: string): boolean {
  try {
    if (archivePath.endsWith('.zip')) {
      execSync(`unzip -tq "${archivePath}"`, { stdio: 'pipe' });
      return true;
    }
    execSync(`tar -tf "${archivePath}" >/dev/null`, { stdio: 'pipe', shell: '/bin/zsh' });
    return true;
  } catch (error) {
    console.error(
      `[latexAutoPackages] Archive validation failed for ${archivePath}:`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

function writeDownloadedFile(destPath: string, data: Uint8Array | Buffer) {
  if (existsSync(destPath)) {
    rmSync(destPath, { force: true, recursive: true });
  }
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, data);
}

function copyWithParents(src: string, relativeTarget: string): string {
  const dest = join(LOCAL_PACKAGES_EXTRACTED_DIR, relativeTarget);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return dest;
}

function copyWithParentsToRoot(baseDir: string, src: string, relativeTarget: string): string {
  const dest = join(baseDir, relativeTarget);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return dest;
}

function inferFallbackTarget(pkg: string, src: string): string | null {
  const file = basename(src);
  const ext = extname(file).toLowerCase();
  if (!RUNTIME_FILE_EXTENSIONS.has(ext)) {
    return null;
  }

  if (ext === '.bst') {
    return join('bibtex', 'bst', pkg, file);
  }

  return join('tex', 'latex', pkg, file);
}

function remapTexmfRuntimePath(texmfRel: string, pkg: string): string {
  const normalized = texmfRel.replace(/\\/g, '/');
  const ext = extname(normalized).toLowerCase();
  const file = basename(normalized);
  const parts = normalized.split('/');

  if (parts.length >= 3 && parts[0] === 'tex' && parts[1] === 'latex' && FONT_FILE_EXTENSIONS.has(ext)) {
    const packageDir = parts[2] || pkg;
    switch (ext) {
      case '.otf':
        return join('fonts', 'opentype', 'public', packageDir, file);
      case '.ttf':
        return join('fonts', 'truetype', 'public', packageDir, file);
      case '.tfm':
        return join('fonts', 'tfm', 'public', packageDir, file);
      case '.vf':
        return join('fonts', 'vf', 'public', packageDir, file);
      case '.pfb':
        return join('fonts', 'type1', 'public', packageDir, file);
      case '.afm':
        return join('fonts', 'afm', 'public', packageDir, file);
      case '.map':
        return join('fonts', 'map', 'dvips', packageDir, file);
      case '.enc':
        return join('fonts', 'enc', 'dvips', packageDir, file);
      default:
        break;
    }
  }

  return normalized;
}

function isPrimaryRuntimeCandidate(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.tex') {
    const name = basename(filePath).toLowerCase();
    return name !== 'readme.tex' && !name.endsWith('.drv.tex') && !name.endsWith('-rus.tex');
  }
  return RUNTIME_FILE_EXTENSIONS.has(ext);
}

function findAvailableLatexCommand(): string | null {
  const candidates = [
    '/Library/TeX/texbin/latex',
    '/Library/TeX/texbin/pdflatex',
    'latex',
    'pdflatex',
  ];

  for (const candidate of candidates) {
    try {
      if (candidate.includes('/')) {
        if (existsSync(candidate)) return candidate;
      } else {
        const resolved = execSync(`which ${candidate}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (resolved) return resolved;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function generateRuntimeFilesFromIns(extractedDir: string) {
  const latexCmd = findAvailableLatexCommand();
  if (!latexCmd) {
    console.warn(`\x1b[33m[latexAutoPackages] No latex command available for .ins generation in ${extractedDir}\x1b[0m`);
    return;
  }

  const insFiles = walkFiles(extractedDir).filter(file => file.toLowerCase().endsWith('.ins'));
  if (insFiles.length > 0) {
    console.log(
      `[latexAutoPackages] Found ${insFiles.length} .ins file(s) for generation in ${extractedDir}: ` +
      `${insFiles.map(file => basename(file)).join(', ')}`
    );
  }

  for (const insFile of insFiles) {
    const workDir = dirname(insFile);
    const insName = basename(insFile);
    const beforeFiles = new Set(findUsableRuntimeFiles(workDir).map(file => basename(file)));
    console.log(`[latexAutoPackages] Running .ins generation: ${insFile}`);
    try {
      execSync(`cd "${workDir}" && "${latexCmd}" -interaction=nonstopmode "${insName}"`, {
        stdio: 'pipe',
        timeout: 10000,
      });
      const afterFiles = findUsableRuntimeFiles(workDir).map(file => basename(file));
      const generatedFiles = afterFiles.filter(file => !beforeFiles.has(file));
      console.log(
        `[latexAutoPackages] .ins generation succeeded: ${insFile}` +
        (generatedFiles.length > 0 ? ` -> generated ${generatedFiles.join(', ')}` : ' -> no new runtime files detected')
      );
    } catch {
      const afterFiles = findUsableRuntimeFiles(workDir).map(file => basename(file));
      const generatedFiles = afterFiles.filter(file => !beforeFiles.has(file));
      console.warn(
        `\x1b[33m[latexAutoPackages] .ins generation returned non-zero exit: ${insFile}` +
        (generatedFiles.length > 0 ? ` -> generated ${generatedFiles.join(', ')}` : ' -> no new runtime files detected') +
        `\x1b[0m`
      );
      // Some packages still generate files despite non-zero exit; continue and rescan.
    }
  }
}

function extractBalancedBraceBlock(content: string, startIndex: number): string | null {
  const openBraceIndex = content.indexOf('{', startIndex);
  if (openBraceIndex < 0) {
    return null;
  }

  let depth = 0;
  for (let i = openBraceIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function buildInsFromDtxContent(content: string): string | null {
  const installBlockMatch = content.match(/%<\*install>([\s\S]*?)%<\/install>/);
  if (installBlockMatch?.[1]?.trim()) {
    return installBlockMatch[1].trim();
  }

  const batchfileMatch = content.match(/%<\*batchfile>([\s\S]*?)%<\/batchfile>/);
  if (batchfileMatch?.[1]?.trim()) {
    return batchfileMatch[1].trim();
  }

  const generateIndex = content.search(/\\generate\s*\{/);
  if (generateIndex < 0) {
    return null;
  }

  const generateBlock = extractBalancedBraceBlock(content, generateIndex);
  if (!generateBlock) {
    return null;
  }

  return [
    '\\input docstrip.tex',
    '\\keepsilent',
    '\\askforoverwritefalse',
    generateBlock,
    '\\endbatchfile',
  ].join('\n');
}

function hasDtxGenerationRule(dtxFile: string): boolean {
  try {
    const content = readFileSync(dtxFile, 'utf-8');
    return buildInsFromDtxContent(content) !== null;
  } catch {
    return false;
  }
}

function inspectSourceGenerationState(extractedDir: string): {
  hasInsFiles: boolean;
  hasDtxFiles: boolean;
  hasGenerationRule: boolean;
} {
  const files = walkFiles(extractedDir);
  const insFiles = files.filter(file => file.toLowerCase().endsWith('.ins'));
  const dtxFiles = files.filter(file => file.toLowerCase().endsWith('.dtx'));

  return {
    hasInsFiles: insFiles.length > 0,
    hasDtxFiles: dtxFiles.length > 0,
    hasGenerationRule: dtxFiles.some(hasDtxGenerationRule),
  };
}

function hasOnlyFontRuntimeFiles(files: string[]): boolean {
  return files.length > 0 && files.every(file => FONT_FILE_EXTENSIONS.has(extname(file).toLowerCase()));
}

function inspectExtractedArchiveForRequest(
  extractedDir: string,
  requestedFiles: string[],
  contextLabel: string
): ArchiveInspectionResult {
  let usableFiles = findUsableRuntimeFiles(extractedDir);
  let primaryRuntimeFiles = findPrimaryRuntimeFiles(extractedDir);
  let attemptedGeneration = false;

  const generationState = inspectSourceGenerationState(extractedDir);
  const initialMissingTypes = missingRequestedRuntimeTypes(requestedFiles, usableFiles);
  const shouldPreferGeneration =
    (generationState.hasInsFiles || generationState.hasDtxFiles) &&
    (primaryRuntimeFiles.length === 0 || initialMissingTypes.length > 0);

  if (usableFiles.length === 0 || shouldPreferGeneration) {
    if (generationState.hasInsFiles) {
      attemptedGeneration = true;
      if (!findAvailableLatexCommand()) {
        return {
          ok: false,
          mode: 'unsupported-for-request',
          usableFiles,
          primaryRuntimeFiles,
          attemptedGeneration,
          error: `latex command is missing for ${contextLabel} .ins generation`,
          errorCode: 'latex_command_missing',
        };
      }
      generateRuntimeFilesFromIns(extractedDir);
    } else if (generationState.hasDtxFiles) {
      if (!generationState.hasGenerationRule) {
        return {
          ok: false,
          mode: 'unsupported-for-request',
          usableFiles,
          primaryRuntimeFiles,
          attemptedGeneration,
          error: `${contextLabel} dtx-only package has no .ins file and no detectable docstrip generation rule`,
          errorCode: 'no_generation_rule',
        };
      }
      attemptedGeneration = true;
      const dtxGeneration = generateRuntimeFilesFromDtx(extractedDir);
      if (dtxGeneration.latexMissing) {
        return {
          ok: false,
          mode: 'unsupported-for-request',
          usableFiles,
          primaryRuntimeFiles,
          attemptedGeneration,
          error: `latex command is missing for ${contextLabel} .dtx generation`,
          errorCode: 'latex_command_missing',
        };
      }
    }

    usableFiles = findUsableRuntimeFiles(extractedDir);
    primaryRuntimeFiles = findPrimaryRuntimeFiles(extractedDir);
  }

  if (usableFiles.length === 0 || primaryRuntimeFiles.length === 0) {
    const isSourceOnlyPackage = generationState.hasInsFiles || generationState.hasDtxFiles;
    return {
      ok: false,
      mode: 'unsupported-for-request',
      usableFiles,
      primaryRuntimeFiles,
      attemptedGeneration,
      error: `${contextLabel} does not contain usable runtime files`,
      errorCode: attemptedGeneration
        ? 'generation_failed'
        : (isSourceOnlyPackage ? 'target_not_generated' : 'runtime_files_missing'),
    };
  }

  const missingTypes = missingRequestedRuntimeTypes(requestedFiles, usableFiles);
  if (missingTypes.length > 0) {
    return {
      ok: false,
      mode: 'unsupported-for-request',
      usableFiles,
      primaryRuntimeFiles,
      attemptedGeneration,
      error: `${contextLabel} does not contain requested runtime file type(s): ${missingTypes.join(', ')}`,
      errorCode: 'runtime_files_missing',
    };
  }

  const requestedExts = collectRequestedRuntimeExtensions(requestedFiles);
  const mode: ArchiveInstallMode = attemptedGeneration
    ? 'generated-runtime'
    : (
        requestedExts.size > 0 &&
        Array.from(requestedExts).every(ext => FONT_FILE_EXTENSIONS.has(ext)) &&
        hasOnlyFontRuntimeFiles(usableFiles)
      )
      ? 'font-assets-only'
      : 'direct-runtime';

  return {
    ok: true,
    mode,
    usableFiles,
    primaryRuntimeFiles,
    attemptedGeneration,
  };
}

function generateRuntimeFilesFromDtx(extractedDir: string): { generated: boolean; latexMissing: boolean } {
  const latexCmd = findAvailableLatexCommand();
  if (!latexCmd) {
    return { generated: false, latexMissing: true };
  }

  let generated = false;
  const dtxFiles = walkFiles(extractedDir).filter(file => file.toLowerCase().endsWith('.dtx'));
  for (const dtxFile of dtxFiles) {
    try {
      const content = readFileSync(dtxFile, 'utf-8');
      const insContent = buildInsFromDtxContent(content);
      if (!insContent) {
        continue;
      }

      const workDir = dirname(dtxFile);
      const generatedInsPath = join(workDir, `${basename(dtxFile, '.dtx')}.autogen.ins`);
      writeFileSync(generatedInsPath, `${insContent}\n`, 'utf-8');
      generated = true;

      try {
        execSync(`cd "${workDir}" && "${latexCmd}" -interaction=nonstopmode "${basename(generatedInsPath)}"`, {
          stdio: 'pipe',
          timeout: 10000,
        });
      } catch {
        // Some packages still generate runtime files despite non-zero exit.
      }
    } catch {
      // Ignore unreadable dtx files.
    }
  }

  return { generated, latexMissing: false };
}

function installFromExtractedTree(pkg: string, extractedDir: string): string[] {
  return installFromExtractedTreeToRoot(pkg, extractedDir, LOCAL_PACKAGES_EXTRACTED_DIR);
}

function pruneMisplacedRuntimeFiles(baseDir: string) {
  for (const file of walkFiles(baseDir)) {
    const rel = relative(baseDir, file).replace(/\\/g, '/');
    const root = rel.split('/')[0];
    const ext = extname(file).toLowerCase();

    if (!NON_RUNTIME_TEXMF_ROOTS.includes(root)) {
      continue;
    }

    if (!RUNTIME_FILE_EXTENSIONS.has(ext)) {
      continue;
    }

    try {
      rmSync(file, { force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

function installFromExtractedTreeToRoot(pkg: string, extractedDir: string, targetRoot: string): string[] {
  const added: string[] = [];
  const files = walkFiles(extractedDir);

  for (const file of files) {
    const rel = relative(extractedDir, file).replace(/\\/g, '/');
    const parts = rel.split('/');
    const runtimeRootIndex = parts.findIndex(part => PRESERVED_RUNTIME_ROOTS.includes(part));

    if (runtimeRootIndex >= 0) {
      const texmfRel = remapTexmfRuntimePath(parts.slice(runtimeRootIndex).join('/'), pkg);
      added.push(copyWithParentsToRoot(targetRoot, file, texmfRel));
      continue;
    }

    const fallbackTarget = inferFallbackTarget(pkg, file);
    if (fallbackTarget) {
      added.push(copyWithParentsToRoot(targetRoot, file, fallbackTarget));
    }
  }

  return added;
}

function findUsableRuntimeFiles(extractedDir: string): string[] {
  const files = walkFiles(extractedDir);
  return files.filter(file => {
    const ext = extname(file).toLowerCase();
    const name = basename(file).toLowerCase();

    if (!RUNTIME_FILE_EXTENSIONS.has(ext)) {
      return false;
    }

    // Exclude obvious documentation/example sources from being treated as installable runtime files.
    if (name.includes('-rus.') || name.endsWith('.pdf') || name === 'readme') {
      return false;
    }

    return true;
  });
}

function findPrimaryRuntimeFiles(extractedDir: string): string[] {
  return findUsableRuntimeFiles(extractedDir).filter(isPrimaryRuntimeCandidate);
}

function collectRuntimeExtensions(files: string[]): Set<string> {
  const exts = new Set<string>();
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext) {
      exts.add(ext);
    }
  }
  return exts;
}

function collectRequestedRuntimeExtensions(requestedFiles: string[]): Set<string> {
  const exts = new Set<string>();
  for (const file of requestedFiles.map(item => sanitizePackageName(item)).filter(Boolean)) {
    const ext = extname(file).toLowerCase();
    if (ext && RUNTIME_FILE_EXTENSIONS.has(ext)) {
      exts.add(ext);
    }
  }
  return exts;
}

function missingRequestedRuntimeTypes(requestedFiles: string[], candidateFiles: string[]): string[] {
  const requestedExts = collectRequestedRuntimeExtensions(requestedFiles);
  const availableExts = collectRuntimeExtensions(candidateFiles);
  return Array.from(requestedExts)
    .filter(ext => !availableExts.has(ext))
    .sort((a, b) => a.localeCompare(b));
}

function stripTexComments(content: string): string {
  return content
    .split('\n')
    .map(line => stripComments(line))
    .join('\n');
}

function resolveInstalledLocalFile(name: string, index: Map<string, string>): string | null {
  const texPath = index.get(normalizeFileToken(name));
  if (!texPath) return null;

  const manifest = existsSync(LOCAL_PACKAGES_MANIFEST)
    ? JSON.parse(readFileSync(LOCAL_PACKAGES_MANIFEST, 'utf-8')) as Record<string, { localPath: string }>
    : {};
  const entry = manifest[texPath];
  if (!entry?.localPath) return null;

  const localPath = join(WEB_PUBLIC_DIR, entry.localPath);
  return existsSync(localPath) ? localPath : null;
}

function collectRuntimeReferences(content: string): { localFiles: Set<string>; packageFiles: Set<string> } {
  const localFiles = new Set<string>();
  const packageFiles = new Set<string>();
  const sanitized = stripTexComments(content);

  for (const match of sanitized.matchAll(/\\input\{([^}]+)\}/g)) {
    const value = sanitizeIncludePath(match[1] || '');
    if (!value) continue;
    const file = basename(value);
    localFiles.add(extname(file) ? file : `${file}.tex`);
  }

  for (const match of sanitized.matchAll(/\\InputIfFileExists\{([^}]+)\}/g)) {
    const value = sanitizeIncludePath(match[1] || '');
    if (!value) continue;
    const file = basename(value);
    localFiles.add(file);
  }

  for (const match of sanitized.matchAll(/\\RequirePackage(?:\[[^\]]*])?\{([^}]*)\}/g)) {
    const packages = (match[1] || '').split(',').map(item => sanitizePackageName(item)).filter(Boolean);
    for (const pkg of packages) {
      packageFiles.add(`${pkg}.sty`);
    }
  }

  return { localFiles, packageFiles };
}

function validateInstalledPackage(pkg: string, requestedFiles: string[], localIndex: Map<string, string>, bundleIndex: Map<string, string>): { ok: boolean; problems: string[] } {
  const problems: string[] = [];

  const pending = requestedFiles.map(file => sanitizePackageName(file)).filter(Boolean);
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    const normalized = normalizeFileToken(current);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    const localPath = resolveInstalledLocalFile(current, localIndex);
    if (!localPath) {
      if (!fileExistsCaseInsensitive(current, localIndex) && !fileExistsCaseInsensitive(current, bundleIndex)) {
        problems.push(`missing requested runtime file: ${current}`);
      }
      continue;
    }

    const ext = extname(current).toLowerCase();
    if (!RUNTIME_FILE_EXTENSIONS.has(ext)) {
      continue;
    }

    try {
      const content = readFileSync(localPath, 'utf-8');
      const { localFiles, packageFiles } = collectRuntimeReferences(content);

      for (const file of localFiles) {
        const samePkgFile = resolveInstalledLocalFile(file, localIndex);
        if (samePkgFile) {
          pending.push(file);
        }
      }

      for (const file of packageFiles) {
        if (!fileExistsCaseInsensitive(file, localIndex) && !fileExistsCaseInsensitive(file, bundleIndex)) {
          problems.push(`missing external package dependency: ${file}`);
        }
      }
    } catch {
      // Ignore non-text or unreadable files in the integrity scan.
    }
  }

  return { ok: problems.length === 0, problems };
}

function extractMissingExternalDependencies(problems: string[]): string[] {
  const missing = new Set<string>();

  for (const problem of problems) {
    const match = problem.match(/missing external package dependency:\s+(.+)$/i);
    if (match?.[1]) {
      const file = sanitizePackageName(match[1]);
      if (file) {
        missing.add(file);
      }
    }
  }

  return Array.from(missing).sort((a, b) => a.localeCompare(b));
}

function validateInstalledTemplate(
  requestedFiles: string[],
  templateIndex: Map<string, string>,
  localIndex: Map<string, string>,
  bundleIndex: Map<string, string>
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];

  for (const file of requestedFiles.map(item => sanitizePackageName(item)).filter(Boolean)) {
    if (
      !fileExistsCaseInsensitive(file, templateIndex) &&
      !fileExistsCaseInsensitive(file, localIndex) &&
      !fileExistsCaseInsensitive(file, bundleIndex)
    ) {
      problems.push(`missing requested template/runtime file: ${file}`);
    }
  }

  return { ok: problems.length === 0, problems };
}

async function installPackage(
  pkg: string,
  requestedFiles: string[],
  localIndex: Map<string, string>,
  bundleIndex: Map<string, string>,
  predownloaded?: DownloadedArchiveInfo | null
): Promise<{ pkg: string; addedFiles: string[] } | PackageInstallErrorInfo> {
  const packageAliases = loadPackageAliases();
  const hasAliasedRequestedFile = requestedFiles.some(file => Boolean(packageAliases[normalizeFileToken(file)]));
  const wantsOnlyDirectFontAssets = requestedFiles.length > 0 && requestedFiles.every(isDirectFontAsset);

  if (wantsOnlyDirectFontAssets && !hasAliasedRequestedFile) {
    const directFontInstall = await installDirectFontAssets(pkg, requestedFiles, bundleIndex);
    if (directFontInstall) {
      return directFontInstall;
    }
  }

  const downloaded = predownloaded ?? await downloadPackageArchive(pkg, requestedFiles);
  if (!downloaded) {
    const error = `failed to download package archive from CTAN`;
    console.error(`[latexAutoPackages] Failed to download package archive for ${pkg}`);
    return { pkg, requestedFiles, error, errorCode: 'download_failed' };
  }

  if (!validateArchiveReadable(downloaded.archivePath)) {
    const error = `downloaded archive is unreadable: ${downloaded.archivePath}`;
    console.error(`[latexAutoPackages] Downloaded archive for ${pkg} is unreadable: ${downloaded.archivePath}`);
    return { pkg, requestedFiles, error, errorCode: 'archive_invalid' };
  }

  const tempRoot = join(tmpdir(), `fastwrite-ctan-${pkg}-${Date.now()}`);
  mkdirSync(tempRoot, { recursive: true });

  try {
    const extractError = extractArchiveSafe(downloaded.archivePath, tempRoot);
    if (extractError) {
      const error = `failed to extract archive: ${extractError}`;
      console.error(`[latexAutoPackages] Failed to extract archive for ${pkg}: ${extractError}`);
      return { pkg, requestedFiles, error, errorCode: 'extract_failed' };
    }
    const inspection = inspectExtractedArchiveForRequest(
      tempRoot,
      requestedFiles,
      'package'
    );
    if (!inspection.ok) {
      const error =
        `downloaded package from ${downloaded.sourceDescription} (${downloaded.downloadedUrl}) ${inspection.error}`;
      console.error(
        `[latexAutoPackages] Package ${pkg} was downloaded and extracted from ${downloaded.sourceDescription} ` +
        `(${downloaded.downloadedUrl}), but ${inspection.error} in ${tempRoot}`
      );
      return { pkg, requestedFiles, error, errorCode: inspection.errorCode || 'runtime_files_missing' };
    }

    let addedFiles = installFromExtractedTree(pkg, tempRoot);
    if (addedFiles.length === 0) {
      addedFiles = installFromExtractedTree(pkg, tempRoot);
    }
    if (addedFiles.length === 0) {
      const error = 'package contains candidate runtime files, but none were copied into local-packages/extracted';
      console.error(
        `[latexAutoPackages] Package ${pkg} contains candidate runtime files, ` +
        `but none were copied into local-packages/extracted`
      );
      return { pkg, requestedFiles, error, errorCode: 'install_failed' };
    }

    rebuildLocalPackageManifest();
    const nextLocalIndex = loadManifestIndex();
    const integrity = validateInstalledPackage(pkg, requestedFiles, nextLocalIndex, bundleIndex);
    if (!integrity.ok) {
      const error = `package failed integrity check: ${integrity.problems.join('; ')}`;
      const onlyMissingExternalDeps = integrity.problems.length > 0 && integrity.problems.every(problem =>
        /^missing external package dependency:/i.test(problem)
      );
      const missingExternalDeps = integrity.problems
        .map(problem => problem.match(/^missing external package dependency:\s+(.+)$/i)?.[1]?.trim() || '')
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      const logMessage = onlyMissingExternalDeps
        ? `\x1b[33m[latexAutoPackages] Installed package ${pkg} missing dependency: ${missingExternalDeps.join(', ')}\x1b[0m`
        : `[latexAutoPackages] Installed package ${pkg} failed integrity check after download/extraction. ` +
          `Problems: ${integrity.problems.join('; ')}`;
      if (onlyMissingExternalDeps) {
        console.warn(logMessage);
      } else {
        console.error(logMessage);
      }
      return { pkg, requestedFiles, error, errorCode: 'integrity_check_failed' };
    }

    console.log(
      `[latexAutoPackages] Successfully installed package ${pkg} [mode=${inspection.mode}] ` +
      `(requested: ${requestedFiles.join(', ') || 'n/a'}, added files: ${addedFiles.length})`
    );

    return { pkg, addedFiles };
  } finally {
    try {
      execSync(`rm -rf "${tempRoot}"`, { stdio: 'ignore' });
    } catch { /* ignore cleanup failures */ }
  }
}

async function installOfficialTemplate(
  pkg: string,
  requestedFiles: string[],
  localIndex: Map<string, string>,
  bundleIndex: Map<string, string>
): Promise<{ pkg: string; addedFiles: string[] } | PackageInstallErrorInfo | null> {
  const directFileTemplate = await downloadOfficialTemplateFiles(pkg, requestedFiles);
  if (directFileTemplate) {
    if ('error' in directFileTemplate) {
      return directFileTemplate;
    }
    const templateIndex = loadTemplateIndex();
    const integrity = validateInstalledTemplate(requestedFiles, templateIndex, localIndex, bundleIndex);
    if (!integrity.ok) {
      const error = `template failed integrity check: ${integrity.problems.join('; ')}`;
      console.error(
        `[latexAutoPackages] Installed official template ${pkg} failed integrity check. ` +
        `Problems: ${integrity.problems.join('; ')}`
      );
      return { pkg, requestedFiles, error, errorCode: 'integrity_check_failed' };
    }
    return directFileTemplate;
  }

  const downloaded = await downloadOfficialTemplateArchive(pkg, requestedFiles);
  if (!downloaded) {
    return null;
  }

  if (!validateArchiveReadable(downloaded.archivePath)) {
    const error = `downloaded official template archive is unreadable: ${downloaded.archivePath}`;
    console.error(`[latexAutoPackages] Downloaded official template archive for ${pkg} is unreadable: ${downloaded.archivePath}`);
    return { pkg, requestedFiles, error, errorCode: 'archive_invalid' };
  }

  const tempRoot = join(tmpdir(), `fastwrite-template-${pkg}-${Date.now()}`);
  mkdirSync(tempRoot, { recursive: true });

  try {
    const extractError = extractArchiveSafe(downloaded.archivePath, tempRoot);
    if (extractError) {
      const error = `failed to extract official template archive: ${extractError}`;
      console.error(`[latexAutoPackages] Failed to extract official template archive for ${pkg}: ${extractError}`);
      return { pkg, requestedFiles, error, errorCode: 'extract_failed' };
    }
    const inspection = inspectExtractedArchiveForRequest(
      tempRoot,
      requestedFiles,
      'template'
    );
    if (!inspection.ok) {
      const error =
        `downloaded template from ${downloaded.sourceDescription} (${downloaded.downloadedUrl}) ${inspection.error}`;
      console.error(
        `[latexAutoPackages] Template ${pkg} was downloaded and extracted from ${downloaded.sourceDescription} ` +
        `(${downloaded.downloadedUrl}), but ${inspection.error} in ${tempRoot}`
      );
      return { pkg, requestedFiles, error, errorCode: inspection.errorCode || 'runtime_files_missing' };
    }

    const addedFiles = installFromExtractedTreeToRoot(pkg, tempRoot, TEMPLATES_EXTRACTED_DIR);
    if (addedFiles.length === 0) {
      const error = 'official template contains candidate runtime files, but none were copied into templates/extracted';
      console.error(
        `[latexAutoPackages] Official template ${pkg} contains candidate runtime files, ` +
        `but none were copied into templates/extracted`
      );
      return { pkg, requestedFiles, error, errorCode: 'install_failed' };
    }

    rebuildTemplateManifest();
    const templateIndex = loadTemplateIndex();
    const integrity = validateInstalledTemplate(requestedFiles, templateIndex, localIndex, bundleIndex);
    if (!integrity.ok) {
      const error = `template failed integrity check: ${integrity.problems.join('; ')}`;
      console.error(
        `[latexAutoPackages] Installed official template ${pkg} failed integrity check. ` +
        `Problems: ${integrity.problems.join('; ')}`
      );
      return { pkg, requestedFiles, error, errorCode: 'integrity_check_failed' };
    }

    console.log(
      `[latexAutoPackages] Successfully installed official template ${pkg} [mode=${inspection.mode}] ` +
      `(requested: ${requestedFiles.join(', ') || 'n/a'}, added files: ${addedFiles.length})`
    );

    return { pkg, addedFiles };
  } finally {
    try {
      execSync(`rm -rf "${tempRoot}"`, { stdio: 'ignore' });
    } catch { /* ignore cleanup failures */ }
  }
}

function migrateLatexFontFilesToFontTrees(baseDir: string) {
  for (const file of walkFiles(baseDir)) {
    const rel = relative(baseDir, file).replace(/\\/g, '/');
    const parts = rel.split('/');
    if (parts.length < 4 || parts[0] !== 'tex' || parts[1] !== 'latex') {
      continue;
    }

    const ext = extname(file).toLowerCase();
    if (!FONT_FILE_EXTENSIONS.has(ext)) {
      continue;
    }

    const pkg = parts[2];
    const remapped = remapTexmfRuntimePath(rel, pkg);
    if (!remapped || remapped === rel) {
      continue;
    }

    const dest = join(baseDir, remapped);
    try {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(file, dest);
      rmSync(file, { force: true });
    } catch {
      // ignore migration failures
    }
  }
}

async function installForMissingFiles(
  missingFiles: string[],
  projectRuntimeFiles: Set<string> = new Set<string>(),
  onProgress?: (progress: PackageInstallProgress) => void
): Promise<PackageInstallSummary> {
  initializeLocalPackagesIfEmpty();
  ensureLocalPackagesDirs();
  pruneMisplacedRuntimeFiles(LOCAL_PACKAGES_EXTRACTED_DIR);
  migrateLatexFontFilesToFontTrees(LOCAL_PACKAGES_EXTRACTED_DIR);
  rebuildLocalPackageManifest();
  const localIndex = loadManifestIndex();
  const bundleIndex = loadBundleIndex();
  const bundlePackageMap = loadBundlePackageMap();
  const packageAliases = loadPackageAliases();
  const unresolvedFiles: string[] = [];
  const resolvedPackages: Record<string, string> = {};
  const installedPackages = new Set<string>();
  const addedFiles = new Set<string>();
  const bundleHintPackages = new Set<string>();
  const packageErrors: Array<{ packageName: string; requestedFiles: string[]; errorCode: PackageInstallErrorCode; reason: string }> = [];
  const emitProgress = (stage: PackageInstallProgress['stage'], currentPackage: string | null = null) => {
    const queuedPackages = Array.from(new Set(
      pendingFiles
        .map(file => packageToFiles.get(resolvedPackages[file] || '') ? resolvedPackages[file] : null)
        .filter((value): value is string => Boolean(value))
    ));
    const knownPackages = Array.from(new Set([
      ...Array.from(packageToFiles.keys()),
      ...queuedPackages,
      ...Array.from(installedPackages),
    ]));
    onProgress?.({
      stage,
      pendingPackages: knownPackages.filter(pkg => !installedPackages.has(pkg) && pkg !== currentPackage),
      currentPackage,
      installedPackages: Array.from(installedPackages).sort((a, b) => a.localeCompare(b)),
      totalPackages: knownPackages.length,
      completedPackages: installedPackages.size,
    });
  };

  for (const rawFile of missingFiles) {
    const file = sanitizePackageName(rawFile);
    if (!file) continue;
    if (!fileExistsCaseInsensitive(file, bundleIndex)) continue;

    const hintPackage = resolveBundleHintPackageForFile(file, bundlePackageMap);
    if (hintPackage) {
      bundleHintPackages.add(hintPackage);
    }
  }

  const filteredMissing = missingFiles
    .map(file => sanitizePackageName(file))
    .filter(Boolean)
    .filter(file => !projectRuntimeFiles.has(normalizeFileToken(file)))
    .filter(file => {
      if (isDirectFontAsset(file)) {
        return !hasUsableDirectFontMapping(file, localIndex);
      }
      return !fileExistsCaseInsensitive(file, localIndex);
    })
    .filter(file => !fileExistsCaseInsensitive(file, bundleIndex));

  const packageToFiles = new Map<string, string[]>();
  const pendingFiles = [...filteredMissing];
  const seenPendingFiles = new Set<string>(filteredMissing);
  const processedPackages = new Set<string>();

  emitProgress('resolving');

  while (pendingFiles.length > 0) {
    const currentBatch = pendingFiles.splice(0, pendingFiles.length);
    const packagesToInstall: string[] = [];

    for (const file of currentBatch) {
      if (!file) continue;

      const aliasedPackage = packageAliases[normalizeFileToken(file)]?.package;
      if (aliasedPackage) {
        resolvedPackages[file] = aliasedPackage;
        const list = packageToFiles.get(aliasedPackage) || [];
        if (!list.includes(file)) {
          list.push(file);
        }
        packageToFiles.set(aliasedPackage, list);

        if (!processedPackages.has(aliasedPackage) && !packagesToInstall.includes(aliasedPackage)) {
          packagesToInstall.push(aliasedPackage);
        }
        continue;
      }

      if (isDirectFontAsset(file)) {
        const pseudoPkg = `font:${basename(file, extname(file))}`;
        resolvedPackages[file] = pseudoPkg;
        const directFontResult = await installDirectFontAssets(pseudoPkg, [file], bundleIndex);

        if (!directFontResult || 'error' in directFontResult) {
          const errorInfo = directFontResult && 'error' in directFontResult
            ? directFontResult
            : {
                pkg: pseudoPkg,
                requestedFiles: [file],
                error: `failed to download direct font file: ${file}`,
                errorCode: 'download_failed' as PackageInstallErrorCode,
              };
          packageErrors.push({
            packageName: pseudoPkg,
            requestedFiles: [file],
            errorCode: errorInfo.errorCode,
            reason: errorInfo.error,
          });
          unresolvedFiles.push(file);
        } else {
          installedPackages.add(pseudoPkg);
          for (const addedFile of directFontResult.addedFiles) {
            addedFiles.add(addedFile);
          }
          emitProgress('installing', pseudoPkg);
        }
        continue;
      }

      const pkg = await resolvePackageForFile(file);
      if (!pkg) {
        unresolvedFiles.push(file);
        continue;
      }
      resolvedPackages[file] = pkg;
      const list = packageToFiles.get(pkg) || [];
      if (!list.includes(file)) {
        list.push(file);
      }
      packageToFiles.set(pkg, list);

      if (!processedPackages.has(pkg) && !packagesToInstall.includes(pkg)) {
        packagesToInstall.push(pkg);
      }
    }

    const archiveBatch = packagesToInstall.map((pkg) => ({
      pkg,
      requestedFiles: packageToFiles.get(pkg) || [],
    }));
    for (const pkg of packagesToInstall) {
      emitProgress('downloading', pkg);
    }
    const prefetchedArchives = await prefetchPackageArchives(archiveBatch);

    for (const pkg of packagesToInstall) {
      const filesForPkg = packageToFiles.get(pkg) || [];
      const result = await installPackage(
        pkg,
        filesForPkg,
        localIndex,
        bundleIndex,
        prefetchedArchives.get(pkg)
      );

      if ('error' in result) {
        if (result.errorCode === 'integrity_check_failed') {
          const missingExternalDeps = extractMissingExternalDependencies(result.error.split('; '));
          const unresolvedRequestedFiles = filesForPkg.filter(requestedFile => {
            const normalized = normalizeFileToken(requestedFile);
            return !missingExternalDeps.some(dep => normalizeFileToken(dep) === normalized);
          });

          if (missingExternalDeps.length > 0) {
            let queuedDependency = false;
            for (const dep of missingExternalDeps) {
              if (seenPendingFiles.has(dep)) continue;
              if (projectRuntimeFiles.has(normalizeFileToken(dep))) {
                continue;
              }
              if (fileExistsCaseInsensitive(dep, localIndex) || fileExistsCaseInsensitive(dep, bundleIndex)) {
                continue;
              }
              pendingFiles.push(dep);
              seenPendingFiles.add(dep);
              queuedDependency = true;
            }

            if (queuedDependency) {
              for (const unresolvedFile of unresolvedRequestedFiles) {
                pendingFiles.push(unresolvedFile);
              }
              continue;
            }
          }
        }

        packageErrors.push({
          packageName: pkg,
          requestedFiles: filesForPkg,
          errorCode: result.errorCode,
          reason: result.error,
        });
        for (const file of filesForPkg) {
          unresolvedFiles.push(file);
        }
        processedPackages.add(pkg);
        continue;
      }

      installedPackages.add(result.pkg);
      for (const file of result.addedFiles) {
        addedFiles.add(file);
      }
      processedPackages.add(pkg);
      emitProgress('installing', pkg);
    }
  }

  const rebuiltPackages = rebuildLocalPackageManifest();
  const summary = {
    requestedFiles: missingFiles,
    missingFiles: filteredMissing,
    resolvedPackages,
    unresolvedFiles: Array.from(new Set(unresolvedFiles)).sort((a, b) => a.localeCompare(b)),
    installedPackages: Array.from(installedPackages).sort((a, b) => a.localeCompare(b)),
    addedFiles: Array.from(addedFiles).sort((a, b) => a.localeCompare(b)),
    bundleHintPackages: Array.from(bundleHintPackages).sort((a, b) => a.localeCompare(b)),
    packageErrors,
    manifestUpdated: rebuiltPackages.manifestUpdated,
    logRetryInstallEnabled: ENABLE_LOG_BASED_RETRY_INSTALL,
  };

  onProgress?.({
    stage: 'completed',
    pendingPackages: [],
    currentPackage: null,
    installedPackages: summary.installedPackages,
    totalPackages: summary.installedPackages.length + Object.keys(summary.resolvedPackages).length - summary.unresolvedFiles.length,
    completedPackages: summary.installedPackages.length,
  });

  return summary;
}

export async function preparePackagesForSource(
  mainTexPath: string,
  onProgress?: (progress: PackageInstallProgress) => void
): Promise<PackageInstallSummary & { analyzedFiles: string[] }> {
  onProgress?.({
    stage: 'analyzing',
    pendingPackages: [],
    currentPackage: null,
    installedPackages: [],
    totalPackages: 0,
    completedPackages: 0,
  });
  const analyzedFiles = analyzeLatexRequiredFiles(mainTexPath);
  const projectRuntimeFiles = collectProjectRuntimeFiles(dirname(mainTexPath));
  const result = await installForMissingFiles(analyzedFiles, projectRuntimeFiles, onProgress);
  return { ...result, analyzedFiles };
}

export async function installPackagesFromCompileLog(
  log: string,
  mainTexPath?: string,
  onProgress?: (progress: PackageInstallProgress) => void
): Promise<PackageInstallSummary & { extractedMissingFiles: string[] }> {
  if (!ENABLE_LOG_BASED_RETRY_INSTALL) {
    return {
      requestedFiles: [],
      missingFiles: [],
      resolvedPackages: {},
      unresolvedFiles: [],
      installedPackages: [],
      addedFiles: [],
      bundleHintPackages: [],
      packageErrors: [],
      manifestUpdated: false,
      logRetryInstallEnabled: false,
      extractedMissingFiles: [],
    };
  }
  onProgress?.({
    stage: 'analyzing',
    pendingPackages: [],
    currentPackage: null,
    installedPackages: [],
    totalPackages: 0,
    completedPackages: 0,
  });
  const extractedMissingFiles = extractMissingFilesFromCompileLog(log);
  const projectRuntimeFiles = mainTexPath ? collectProjectRuntimeFiles(dirname(mainTexPath)) : new Set<string>();
  const result = await installForMissingFiles(extractedMissingFiles, projectRuntimeFiles, onProgress);
  return { ...result, extractedMissingFiles };
}

async function ensureAliasedPackagesInstalled(): Promise<void> {
  const aliasFiles = Object.keys(loadPackageAliases())
    .map(file => sanitizePackageName(file))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  if (aliasFiles.length === 0) {
    return;
  }

  try {
    const result = await installForMissingFiles(aliasFiles, new Set<string>());
    if (result.installedPackages.length > 0) {
      console.log(
        `[latexAutoPackages] Warmed aliased packages on startup: ${result.installedPackages.join(', ')}`
      );
    }
    if (result.packageErrors.length > 0) {
      for (const error of result.packageErrors) {
        console.warn(
          `[latexAutoPackages] Startup alias install failed for ${error.packageName} ` +
          `(${error.requestedFiles.join(', ')}): ${error.reason}`
        );
      }
    }
  } catch (error) {
    console.warn(
      '[latexAutoPackages] Failed during startup alias warmup:',
      error instanceof Error ? error.message : String(error)
    );
  }
}

function warmAliasedPackagesOnModuleLoad() {
  if (aliasWarmupPromise) {
    return;
  }
  aliasWarmupPromise = ensureAliasedPackagesInstalled()
    .catch(() => {
      // already logged inside ensureAliasedPackagesInstalled
    })
    .finally(() => {
      aliasWarmupPromise = null;
    });
}

warmAliasedPackagesOnModuleLoad();
