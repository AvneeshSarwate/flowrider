import { execFile } from 'child_process';
import * as util from 'util';
import * as path from 'path';

const execFileAsync = util.promisify(execFile);

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

export async function getHeadCommit(workspaceFolder: string): Promise<string> {
  try {
    return await runGit(['rev-parse', 'HEAD'], workspaceFolder);
  } catch (error) {
    throw new Error('Unable to read current commit hash. Is this a git repository?');
  }
}

function normalizeRemote(url: string): string {
  let cleaned = url.trim();
  cleaned = cleaned.replace(/^git@/, '');
  cleaned = cleaned.replace(/^ssh:\/\//, '');
  cleaned = cleaned.replace(/^https?:\/\//, '');
  cleaned = cleaned.replace(/\.git$/, '');
  cleaned = cleaned.replace(/:/, '/');
  return cleaned;
}

export async function getRepoId(workspaceFolder: string): Promise<string> {
  try {
    const remote = await runGit(['remote', 'get-url', 'origin'], workspaceFolder);
    return normalizeRemote(remote);
  } catch (error) {
    // Fallback: use folder name if remote is missing
    const fallback = path.basename(workspaceFolder);
    return `local/${fallback}`;
  }
}

export async function getFileAtCommit(
  workspaceFolder: string,
  commit: string,
  relativePath: string
): Promise<string | undefined> {
  try {
    const target = `${commit}:${relativePath}`;
    const { stdout } = await execFileAsync('git', ['show', target], { cwd: workspaceFolder });
    return stdout;
  } catch (error) {
    return undefined;
  }
}
