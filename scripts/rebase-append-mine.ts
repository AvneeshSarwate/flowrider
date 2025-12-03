#!/usr/bin/env npx ts-node
/**
 * Rebase with "accept theirs, append mine" conflict resolution
 *
 * Runs a normal git rebase, and when conflicts occur, resolves them by:
 *   1. Taking the incoming (theirs) version
 *   2. Appending lines we added (ours vs base)
 *
 * Usage:
 *   npx ts-node scripts/rebase-append-mine.ts <target-branch>
 *   npx ts-node scripts/rebase-append-mine.ts main
 *   npx ts-node scripts/rebase-append-mine.ts origin/main
 */

import { execSync, spawnSync } from 'child_process';

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return '';
  }
}

function runShow(cmd: string): boolean {
  const result = spawnSync('sh', ['-c', cmd], { stdio: 'inherit' });
  return result.status === 0;
}

/**
 * Get list of files with unresolved conflicts
 */
function getConflictedFiles(): string[] {
  const output = run('git diff --name-only --diff-filter=U');
  return output ? output.split('\n').filter(Boolean) : [];
}

/**
 * Resolve a single file using "accept theirs, append mine"
 * Uses git's staging area to get the three versions:
 *   :1:file = base (common ancestor)
 *   :2:file = ours (current branch)
 *   :3:file = theirs (incoming)
 */
function resolveFile(filePath: string): boolean {
  try {
    // Get the three versions from git's index
    const base = run(`git show ":1:${filePath}" 2>/dev/null`);
    const ours = run(`git show ":2:${filePath}" 2>/dev/null`);
    const theirs = run(`git show ":3:${filePath}" 2>/dev/null`);

    if (!theirs) {
      console.log(`  Skipping ${filePath} - cannot get theirs version`);
      return false;
    }

    // Start with theirs
    let result = theirs;

    // Find lines added in ours (lines in ours but not in base)
    if (ours && base) {
      const baseLines = new Set(base.split('\n'));
      const oursLines = ours.split('\n');
      const additions = oursLines.filter(line => !baseLines.has(line));

      if (additions.length > 0) {
        // Ensure trailing newline before appending
        if (!result.endsWith('\n')) {
          result += '\n';
        }
        result += additions.join('\n');
        if (!result.endsWith('\n')) {
          result += '\n';
        }
      }
    }

    // Write result and stage
    execSync(`cat > "${filePath}"`, {
      input: result,
      encoding: 'utf8',
    });
    execSync(`git add "${filePath}"`, { stdio: 'pipe' });

    console.log(`  Resolved: ${filePath}`);
    return true;
  } catch (e) {
    console.error(`  Failed: ${filePath} - ${e}`);
    return false;
  }
}

/**
 * Resolve all conflicted files
 */
function resolveAllConflicts(): number {
  const files = getConflictedFiles();
  if (files.length === 0) {
    return 0;
  }

  console.log(`\nResolving ${files.length} conflicted file(s)...`);
  let resolved = 0;

  for (const file of files) {
    if (resolveFile(file)) {
      resolved++;
    }
  }

  return resolved;
}

/**
 * Main rebase loop - continues until complete or unrecoverable error
 */
async function rebaseWithResolution(targetBranch: string): Promise<void> {
  console.log(`Rebasing onto ${targetBranch}...\n`);

  // Verify target exists
  if (!run(`git rev-parse --verify "${targetBranch}" 2>/dev/null`)) {
    console.error(`Error: Branch '${targetBranch}' not found`);
    process.exit(1);
  }

  // Start rebase
  let rebaseResult = spawnSync('git', ['rebase', targetBranch], {
    stdio: 'inherit',
  });

  // Loop: resolve conflicts and continue until done
  let iterations = 0;
  const maxIterations = 100; // Safety limit

  while (rebaseResult.status !== 0 && iterations < maxIterations) {
    iterations++;

    const conflicts = getConflictedFiles();
    if (conflicts.length === 0) {
      // No conflicts but rebase failed - might be other issue
      console.error('\nRebase failed but no conflicts found. Check git status.');
      process.exit(1);
    }

    const resolved = resolveAllConflicts();
    if (resolved === 0) {
      console.error('\nFailed to resolve any conflicts. Aborting.');
      runShow('git rebase --abort');
      process.exit(1);
    }

    console.log(`\nContinuing rebase (iteration ${iterations})...\n`);

    // Continue rebase
    rebaseResult = spawnSync('git', ['rebase', '--continue'], {
      stdio: 'inherit',
      env: { ...process.env, GIT_EDITOR: 'true' }, // Auto-accept commit messages
    });
  }

  if (iterations >= maxIterations) {
    console.error('\nMax iterations reached. Aborting rebase.');
    runShow('git rebase --abort');
    process.exit(1);
  }

  console.log('\nRebase completed successfully!');
}

// CLI
const targetBranch = process.argv[2];

if (!targetBranch) {
  console.log(`
Rebase with "accept theirs, append mine" conflict resolution

Usage:
  npx ts-node scripts/rebase-append-mine.ts <target-branch>

Examples:
  npx ts-node scripts/rebase-append-mine.ts main
  npx ts-node scripts/rebase-append-mine.ts origin/main

Strategy:
  When conflicts occur, this script resolves them by taking the incoming
  (theirs) version and appending any lines that were added in your branch.
`);
  process.exit(1);
}

rebaseWithResolution(targetBranch);
