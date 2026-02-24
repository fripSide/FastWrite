import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const PROJS_DIR = join(process.cwd(), 'projs');
const GITHUB_SETTINGS_FILE = join(PROJS_DIR, 'github-settings.json');

export interface GitHubSettings {
    token: string;
}

export function loadGitHubSettings(): GitHubSettings {
    if (!existsSync(GITHUB_SETTINGS_FILE)) {
        return { token: '' };
    }
    try {
        return JSON.parse(readFileSync(GITHUB_SETTINGS_FILE, 'utf-8'));
    } catch {
        return { token: '' };
    }
}

export function saveGitHubSettings(settings: GitHubSettings): boolean {
    try {
        if (!existsSync(PROJS_DIR)) {
            mkdirSync(PROJS_DIR, { recursive: true });
        }
        writeFileSync(GITHUB_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
        return true;
    } catch {
        return false;
    }
}

/**
 * Build a clone URL with optional token for authentication.
 * Supports both HTTPS and SSH-style GitHub URLs.
 */
function buildAuthUrl(url: string, token?: string): string {
    if (!token) return url;

    // Convert SSH to HTTPS if needed
    const sshMatch = url.match(/^git@github\.com:(.+)$/);
    if (sshMatch) {
        url = `https://github.com/${sshMatch[1]}`;
    }

    // Inject token into HTTPS URL
    return url.replace('https://github.com/', `https://${token}@github.com/`);
}

/**
 * Clone a GitHub repository into the target directory.
 */
export function cloneRepo(
    url: string,
    branch: string,
    targetDir: string,
    token?: string
): { success: boolean; error?: string } {
    try {
        const authUrl = buildAuthUrl(url, token);
        const branchArg = branch ? `--branch ${branch}` : '';

        // Ensure parent directory exists
        const parentDir = join(targetDir, '..');
        if (!existsSync(parentDir)) {
            mkdirSync(parentDir, { recursive: true });
        }

        execSync(
            `git clone ${branchArg} "${authUrl}" "${targetDir}"`,
            { stdio: 'pipe', timeout: 120000 }
        );

        return { success: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Sanitize token from error messages
        const sanitized = token ? message.replace(new RegExp(token, 'g'), '***') : message;
        return { success: false, error: sanitized };
    }
}

/**
 * Get git status for a project directory.
 * Returns a summary of changed files.
 */
export function getGitStatus(
    projectDir: string
): { isGitRepo: boolean; changes: string[]; branch: string; ahead: number } {
    const result = { isGitRepo: false, changes: [] as string[], branch: '', ahead: 0 };

    if (!existsSync(join(projectDir, '.git'))) {
        return result;
    }

    result.isGitRepo = true;

    try {
        // Get current branch
        result.branch = execSync('git branch --show-current', {
            cwd: projectDir,
            encoding: 'utf-8',
            timeout: 5000
        }).trim();

        // Get status
        const status = execSync('git status --porcelain', {
            cwd: projectDir,
            encoding: 'utf-8',
            timeout: 5000
        }).trim();

        if (status) {
            result.changes = status.split('\n').filter(Boolean);
        }

        // Get ahead count
        try {
            const ahead = execSync('git rev-list --count @{u}..HEAD', {
                cwd: projectDir,
                encoding: 'utf-8',
                timeout: 5000
            }).trim();
            result.ahead = parseInt(ahead, 10) || 0;
        } catch {
            // No upstream configured
        }
    } catch {
        // Git command failed
    }

    return result;
}

/**
 * Stage all changes, commit, and push to remote.
 */
export function pushChanges(
    projectDir: string,
    message: string,
    token?: string
): { success: boolean; error?: string } {
    try {
        if (!existsSync(join(projectDir, '.git'))) {
            return { success: false, error: 'Not a git repository' };
        }

        // Configure git user if not set
        try {
            execSync('git config user.email', { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe' });
        } catch {
            execSync('git config user.email "fastwrite@local"', { cwd: projectDir, stdio: 'pipe' });
            execSync('git config user.name "FastWrite"', { cwd: projectDir, stdio: 'pipe' });
        }

        // Stage all changes
        execSync('git add -A', { cwd: projectDir, stdio: 'pipe', timeout: 10000 });

        // Check if there are changes to commit
        const status = execSync('git status --porcelain', {
            cwd: projectDir,
            encoding: 'utf-8',
            timeout: 5000
        }).trim();

        if (!status) {
            return { success: true }; // Nothing to commit
        }

        // Commit
        const sanitizedMessage = message.replace(/"/g, '\\"');
        execSync(`git commit -m "${sanitizedMessage}"`, {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 10000
        });

        // If token provided, update remote URL to use it
        if (token) {
            try {
                const remoteUrl = execSync('git remote get-url origin', {
                    cwd: projectDir,
                    encoding: 'utf-8',
                    timeout: 5000
                }).trim();
                const authUrl = buildAuthUrl(remoteUrl, token);
                execSync(`git remote set-url origin "${authUrl}"`, {
                    cwd: projectDir,
                    stdio: 'pipe',
                    timeout: 5000
                });
            } catch {
                // Could not update remote URL
            }
        }

        // Push
        execSync('git push', { cwd: projectDir, stdio: 'pipe', timeout: 60000 });

        // Restore remote URL without token for safety
        if (token) {
            try {
                const remoteUrl = execSync('git remote get-url origin', {
                    cwd: projectDir,
                    encoding: 'utf-8',
                    timeout: 5000
                }).trim();
                // Remove token from URL
                const cleanUrl = remoteUrl.replace(/https:\/\/[^@]+@github\.com\//, 'https://github.com/');
                execSync(`git remote set-url origin "${cleanUrl}"`, {
                    cwd: projectDir,
                    stdio: 'pipe',
                    timeout: 5000
                });
            } catch {
                // Best effort cleanup
            }
        }

        return { success: true };
    } catch (error) {
        const message_str = error instanceof Error ? error.message : String(error);
        const sanitized = token ? message_str.replace(new RegExp(token, 'g'), '***') : message_str;
        return { success: false, error: sanitized };
    }
}
