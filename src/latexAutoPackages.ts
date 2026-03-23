import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const PROJECT_ROOT = process.cwd();
const WEB_PUBLIC_DIR = join(PROJECT_ROOT, 'web', 'public');
const LOCAL_PACKAGES_DIR = join(WEB_PUBLIC_DIR, 'local-packages');
const LOCAL_PACKAGES_EXTRACTED_DIR = join(LOCAL_PACKAGES_DIR, 'extracted');
const LOCAL_PACKAGES_MANIFEST = join(LOCAL_PACKAGES_DIR, 'manifest.json');
const BUNDLE_FILE_MANIFEST = join(WEB_PUBLIC_DIR, 'bundles', 'file-manifest.json');
const BUNDLES_MANIFEST = join(WEB_PUBLIC_DIR, 'bundles', 'bundles.json');

const TEXMF_ROOTS = [
  'tex',
  'bibtex',
  'fonts',
  'dvips',
  'metafont',
  'scripts',
  'makeindex',
  'context',
  'source',
  'doc',
  'tlpkg',
];

const RUNTIME_FILE_EXTENSIONS = new Set([
  '.sty', '.cls', '.tex', '.cfg', '.def', '.fd', '.ldf', '.clo',
  '.bst', '.bib', '.bbx', '.cbx', '.lbx',
  '.map', '.enc', '.pfb', '.tfm', '.vf', '.afm', '.otf', '.ttf',
]);

const FILE_TO_PACKAGE_ALIASES: Record<string, string> = {
  'ieeetran.cls': 'IEEEtran',
  'acmart.cls': 'acmart',
  'elsarticle.cls': 'elsarticle',
  'llncs.cls': 'llncs',
  'cleveref.sty': 'cleveref',
  'algorithm.sty': 'algorithms',
  'algorithmic.sty': 'algorithms',
  'algorithmicx.sty': 'algorithmicx',
  'algpseudocode.sty': 'algorithmicx',
  'xcolor.sty': 'xcolor',
  'xspace.sty': 'tools',
  'varioref.sty': 'tools',
  'xr.sty': 'tools',
  'longtable.sty': 'tools',
  'tabularx.sty': 'tools',
  'booktabs.sty': 'booktabs',
  'listings.sty': 'listings',
  'float.sty': 'float',
  'natbib.sty': 'natbib',
  'hyperref.sty': 'hyperref',
  'geometry.sty': 'geometry',
  'graphicx.sty': 'graphics',
  'keyval.sty': 'graphics',
  'keyval.tex': 'xkeyval',
  'xkeyval.sty': 'xkeyval',
  'xkeyval.tex': 'xkeyval',
  'ifthen.sty': 'base',
};

const PACKAGE_URL_BUILDERS = [
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
    reason: string;
  }>;
  manifestUpdated: boolean;
}

function ensureLocalPackagesDirs() {
  mkdirSync(LOCAL_PACKAGES_DIR, { recursive: true });
  mkdirSync(LOCAL_PACKAGES_EXTRACTED_DIR, { recursive: true });
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

function normalizeFileToken(token: string): string {
  return basename(token.trim()).toLowerCase();
}

function sanitizePackageName(name: string): string {
  return name.trim().replace(/^["']|["']$/g, '').replace(/[^\w.+-]/g, '');
}

function sanitizeIncludePath(name: string): string {
  return name.trim().replace(/^["']|["']$/g, '').replace(/[\\]/g, '/').replace(/[^/\w.+-]/g, '');
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

function loadManifestIndex(): Map<string, string> {
  const index = new Map<string, string>();

  if (!existsSync(LOCAL_PACKAGES_MANIFEST)) {
    return index;
  }

  try {
    const manifest = JSON.parse(readFileSync(LOCAL_PACKAGES_MANIFEST, 'utf-8')) as Record<string, { localPath: string }>;
    for (const texPath of Object.keys(manifest)) {
      index.set(normalizeFileToken(texPath), texPath);
    }
  } catch (error) {
    console.error('[latexAutoPackages] Failed to load local manifest:', error);
  }

  return index;
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

export function rebuildLocalPackageManifest(): { count: number; manifestUpdated: boolean } {
  ensureLocalPackagesDirs();
  const files = walkFiles(LOCAL_PACKAGES_EXTRACTED_DIR);
  const manifest: Record<string, { localPath: string; size: number }> = {};

  for (const filePath of files) {
    const rel = relative(LOCAL_PACKAGES_EXTRACTED_DIR, filePath).replace(/\\/g, '/');
    if (!rel) continue;
    const texPath = `/texlive/texmf-dist/${rel}`;
    manifest[texPath] = {
      localPath: `local-packages/extracted/${rel}`,
      size: statSync(filePath).size,
    };
  }

  const next = JSON.stringify(manifest, null, 2);
  const prev = existsSync(LOCAL_PACKAGES_MANIFEST) ? readFileSync(LOCAL_PACKAGES_MANIFEST, 'utf-8') : '';
  const manifestUpdated = prev !== next;
  if (manifestUpdated) {
    writeFileSync(LOCAL_PACKAGES_MANIFEST, next, 'utf-8');
  }

  return { count: Object.keys(manifest).length, manifestUpdated };
}

function collectDependencies(texPath: string, visited = new Set<string>(), requiredFiles = new Set<string>()): Set<string> {
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
        requiredFiles.add(item.endsWith('.sty') ? item : `${item}.sty`);
      }
    }

    const classRegex = /\\documentclass(?:\[[^\]]*])?\{([^}]*)\}/g;
    for (const match of line.matchAll(classRegex)) {
      const item = sanitizePackageName(match[1] || '');
      if (item) requiredFiles.add(item.endsWith('.cls') ? item : `${item}.cls`);
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
      collectDependencies(join(currentDir, candidate), visited, requiredFiles);
    }
  }

  return requiredFiles;
}

export function analyzeLatexRequiredFiles(mainTexPath: string): string[] {
  return Array.from(collectDependencies(mainTexPath)).sort((a, b) => a.localeCompare(b));
}

export function extractMissingFilesFromCompileLog(log: string): string[] {
  const missing = new Set<string>();
  const patterns = [
    /LaTeX Error: File `([^']+)' not found\./g,
    /I can't find file `([^']+)'/g,
  ];

  for (const pattern of patterns) {
    for (const match of log.matchAll(pattern)) {
      const file = sanitizePackageName(match[1] || '');
      if (!file) continue;
      const ext = extname(file);
      if (ext && RUNTIME_FILE_EXTENSIONS.has(ext.toLowerCase())) {
        missing.add(file);
      }
    }
  }

  return Array.from(missing).sort((a, b) => a.localeCompare(b));
}

function resolvePackageForFile(filename: string): string | null {
  const normalized = normalizeFileToken(filename);
  if (FILE_TO_PACKAGE_ALIASES[normalized]) {
    return FILE_TO_PACKAGE_ALIASES[normalized];
  }

  const ext = extname(normalized);
  const stem = basename(normalized, ext);
  if (!stem) return null;
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

async function downloadPackageArchive(pkg: string): Promise<{ archivePath: string; downloadedUrl: string } | null> {
  ensureLocalPackagesDirs();

  for (const buildUrl of PACKAGE_URL_BUILDERS) {
    const url = buildUrl(pkg);
    const fetched = await fetchArchiveWithUrl(url);
    if (!fetched) continue;

    const filename = basename(new URL(fetched.finalUrl).pathname);
    const archivePath = join(LOCAL_PACKAGES_DIR, filename);
    writeFileSync(archivePath, fetched.data);
    return { archivePath, downloadedUrl: fetched.finalUrl };
  }

  return null;
}

function extractArchive(archivePath: string, outputDir: string) {
  mkdirSync(outputDir, { recursive: true });

  if (archivePath.endsWith('.zip')) {
    execSync(`unzip -oq "${archivePath}" -d "${outputDir}"`, { stdio: 'pipe' });
    return;
  }

  execSync(`tar -xf "${archivePath}" -C "${outputDir}"`, { stdio: 'pipe' });
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

function copyWithParents(src: string, relativeTarget: string): string {
  const dest = join(LOCAL_PACKAGES_EXTRACTED_DIR, relativeTarget);
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
  if (!latexCmd) return;

  const insFiles = walkFiles(extractedDir).filter(file => file.toLowerCase().endsWith('.ins'));
  for (const insFile of insFiles) {
    const workDir = dirname(insFile);
    const insName = basename(insFile);
    try {
      execSync(`cd "${workDir}" && "${latexCmd}" -interaction=nonstopmode "${insName}"`, {
        stdio: 'pipe',
        timeout: 60000,
      });
    } catch {
      // Some packages still generate files despite non-zero exit; continue and rescan.
    }
  }
}

function installFromExtractedTree(pkg: string, extractedDir: string): string[] {
  const added: string[] = [];
  const files = walkFiles(extractedDir);

  for (const file of files) {
    const rel = relative(extractedDir, file).replace(/\\/g, '/');
    const parts = rel.split('/');
    const rootIndex = parts.findIndex(part => TEXMF_ROOTS.includes(part));

    if (rootIndex >= 0) {
      const texmfRel = parts.slice(rootIndex).join('/');
      added.push(copyWithParents(file, texmfRel));
      continue;
    }

    const fallbackTarget = inferFallbackTarget(pkg, file);
    if (fallbackTarget) {
      added.push(copyWithParents(file, fallbackTarget));
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

function stripTexComments(content: string): string {
  return content
    .split('\n')
    .map(line => stripComments(line))
    .join('\n');
}

function packageDirectory(pkg: string): string {
  return join(LOCAL_PACKAGES_EXTRACTED_DIR, 'tex', 'latex', pkg);
}

function resolveLocalPackageFile(pkgDir: string, name: string): string | null {
  const direct = join(pkgDir, name);
  if (existsSync(direct)) return direct;
  return null;
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
  const pkgDir = packageDirectory(pkg);
  const problems: string[] = [];

  if (!existsSync(pkgDir)) {
    return { ok: false, problems: [`package directory missing: ${pkgDir}`] };
  }

  const pending = requestedFiles.map(file => sanitizePackageName(file)).filter(Boolean);
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    const normalized = normalizeFileToken(current);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    const localPath = resolveLocalPackageFile(pkgDir, current);
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
        const samePkgFile = resolveLocalPackageFile(pkgDir, file);
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

async function installPackage(
  pkg: string,
  requestedFiles: string[],
  localIndex: Map<string, string>,
  bundleIndex: Map<string, string>
): Promise<{ pkg: string; addedFiles: string[] } | { pkg: string; requestedFiles: string[]; error: string }> {
  const downloaded = await downloadPackageArchive(pkg);
  if (!downloaded) {
    const error = `failed to download package archive`;
    console.error(`[latexAutoPackages] Failed to download package archive for ${pkg}`);
    return { pkg, requestedFiles, error };
  }

  if (!validateArchiveReadable(downloaded.archivePath)) {
    const error = `downloaded archive is unreadable: ${downloaded.archivePath}`;
    console.error(`[latexAutoPackages] Downloaded archive for ${pkg} is unreadable: ${downloaded.archivePath}`);
    return { pkg, requestedFiles, error };
  }

  const tempRoot = join(tmpdir(), `fastwrite-ctan-${pkg}-${Date.now()}`);
  mkdirSync(tempRoot, { recursive: true });

  try {
    extractArchive(downloaded.archivePath, tempRoot);
    let usableFiles = findUsableRuntimeFiles(tempRoot);

    if (usableFiles.length === 0) {
      generateRuntimeFilesFromIns(tempRoot);
      usableFiles = findUsableRuntimeFiles(tempRoot);
    }

    if (usableFiles.length === 0) {
      const error =
        `downloaded package from ${downloaded.downloadedUrl} does not contain usable runtime files`;
      console.error(
        `[latexAutoPackages] Package ${pkg} was downloaded and extracted from ${downloaded.downloadedUrl}, ` +
        `but no usable runtime files were found in ${tempRoot}`
      );
      return { pkg, requestedFiles, error };
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
      return { pkg, requestedFiles, error };
    }

    rebuildLocalPackageManifest();
    const nextLocalIndex = loadManifestIndex();
    const integrity = validateInstalledPackage(pkg, requestedFiles, nextLocalIndex, bundleIndex);
    if (!integrity.ok) {
      const error = `package failed integrity check: ${integrity.problems.join('; ')}`;
      console.error(
        `[latexAutoPackages] Installed package ${pkg} failed integrity check after download/extraction. ` +
        `Problems: ${integrity.problems.join('; ')}`
      );
      return { pkg, requestedFiles, error };
    }

    return { pkg, addedFiles };
  } finally {
    try {
      execSync(`rm -rf "${tempRoot}"`, { stdio: 'ignore' });
    } catch { /* ignore cleanup failures */ }
  }
}

async function installForMissingFiles(missingFiles: string[]): Promise<PackageInstallSummary> {
  initializeLocalPackagesIfEmpty();
  ensureLocalPackagesDirs();
  const localIndex = loadManifestIndex();
  const bundleIndex = loadBundleIndex();
  const bundlePackageMap = loadBundlePackageMap();
  const unresolvedFiles: string[] = [];
  const resolvedPackages: Record<string, string> = {};
  const installedPackages = new Set<string>();
  const addedFiles = new Set<string>();
  const bundleHintPackages = new Set<string>();
  const packageErrors: Array<{ packageName: string; requestedFiles: string[]; reason: string }> = [];

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
    .filter(file => !fileExistsCaseInsensitive(file, localIndex))
    .filter(file => !fileExistsCaseInsensitive(file, bundleIndex));

  const packageToFiles = new Map<string, string[]>();
  for (const file of filteredMissing) {
    const pkg = resolvePackageForFile(file);
    if (!pkg) {
      unresolvedFiles.push(file);
      continue;
    }
    resolvedPackages[file] = pkg;
    const list = packageToFiles.get(pkg) || [];
    list.push(file);
    packageToFiles.set(pkg, list);
  }

  for (const [pkg, files] of packageToFiles.entries()) {
    const result = await installPackage(pkg, files, localIndex, bundleIndex);
    if ('error' in result) {
      packageErrors.push({
        packageName: pkg,
        requestedFiles: files,
        reason: result.error,
      });
      for (const file of files) {
        unresolvedFiles.push(file);
      }
      continue;
    }

    installedPackages.add(result.pkg);
    for (const file of result.addedFiles) {
      addedFiles.add(file);
    }
  }

  const rebuilt = rebuildLocalPackageManifest();

  return {
    requestedFiles: missingFiles,
    missingFiles: filteredMissing,
    resolvedPackages,
    unresolvedFiles: Array.from(new Set(unresolvedFiles)).sort((a, b) => a.localeCompare(b)),
    installedPackages: Array.from(installedPackages).sort((a, b) => a.localeCompare(b)),
    addedFiles: Array.from(addedFiles).sort((a, b) => a.localeCompare(b)),
    bundleHintPackages: Array.from(bundleHintPackages).sort((a, b) => a.localeCompare(b)),
    packageErrors,
    manifestUpdated: rebuilt.manifestUpdated,
  };
}

export async function preparePackagesForSource(mainTexPath: string): Promise<PackageInstallSummary & { analyzedFiles: string[] }> {
  const analyzedFiles = analyzeLatexRequiredFiles(mainTexPath);
  const result = await installForMissingFiles(analyzedFiles);
  return { ...result, analyzedFiles };
}

export async function installPackagesFromCompileLog(log: string): Promise<PackageInstallSummary & { extractedMissingFiles: string[] }> {
  const extractedMissingFiles = extractMissingFilesFromCompileLog(log);
  const result = await installForMissingFiles(extractedMissingFiles);
  return { ...result, extractedMissingFiles };
}
