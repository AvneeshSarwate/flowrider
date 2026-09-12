import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);
export interface ReviewMetadata { version: 1; base: string; head: string; repository?: string; title?: string; mode?: 'canvas' | 'document' }
export interface ReviewFile { path: string; status: string; basePath?: string; additions?: number; deletions?: number; significantAdditions?: number; significantDeletions?: number; binary?: boolean }

// A lightweight, language-aware approximation, not a parser-based code metric.
export function isSignificantLine(line: string, file: string): boolean {
  const text = line.trim();
  if (!text) { return false; }
  const ext = path.extname(file).toLowerCase();
  if (/^\.(js|jsx|ts|tsx|java|c|h|cpp|hpp|cs|go|rs|swift|kt|css|scss|less|php)$/.test(ext)) {
    if (text.startsWith('//')) { return false; }
    if (/^(\/\*|\*\/|\*(?:\s|$))/.test(text)) {
      const end = text.indexOf('*/');
      if (end < 0 || !text.slice(end + 2).trim()) { return false; }
    }
  }
  if (/^\.(py|rb|sh|bash|zsh|yml|yaml|toml|pl|r)$/.test(ext) && text.startsWith('#')) { return false; }
  if (ext === '.sql' && text.startsWith('--')) { return false; }
  if (/^\.(html|htm|xml|svg|md)$/.test(ext) && /^<!--.*-->$/.test(text)) { return false; }
  return true;
}

export function parseReview(html: string): ReviewMetadata {
  const block = html.match(/<script\b[^>]*\bid=["']flowrider-review["'][^>]*>([\s\S]*?)<\/script\s*>/i);
  if (!block) {throw new Error('Missing flowrider-review JSON metadata block.');}
  const data = JSON.parse(block[1]);
  if (data?.version !== 1 || typeof data.base !== 'string' || !data.base || typeof data.head !== 'string' || !data.head ||
      (data.repository !== undefined && typeof data.repository !== 'string') ||
      (data.title !== undefined && typeof data.title !== 'string') ||
      (data.mode !== undefined && data.mode !== 'canvas' && data.mode !== 'document')) {
    throw new Error('Review metadata requires version: 1, base and head.');
  }
  return data;
}

export function parseReviewLink(href: string) {
  const url = new URL(href);
  const file = url.searchParams.get('path');
  const line = Number(url.searchParams.get('line'));
  if (url.protocol !== 'flowrider:' || url.hostname !== 'diff' ||
      (url.searchParams.has('side') && url.searchParams.get('side') !== 'head') ||
      !file || file.includes('\\') || file.includes('\0') || path.posix.isAbsolute(file) ||
      file.split('/').some(p => p === '..' || p === '.' || !p) ||
      !Number.isSafeInteger(line) || line < 1) {throw new Error('Invalid diff link: use a relative path and a positive right-side line.');}
  return { file, line, basePath: url.searchParams.get('basePath') ?? file };
}

export class DiffReview implements vscode.Disposable {
  constructor(private readonly folders = () => vscode.workspace.workspaceFolders ?? []) {}
  private source?: vscode.Uri;
  private review?: { html: string; metadata: ReviewMetadata; root: string; files: ReviewFile[] };
  private documents = new Map<string, string>();
  private column?: vscode.ViewColumn;
  private registration = vscode.workspace.registerTextDocumentContentProvider('flowrider-review', {
    provideTextDocumentContent: uri => this.documents.get(uri.toString()) ?? '',
  });
  dispose() { this.registration.dispose(); this.documents.clear(); }
  private async git(root: string, args: string[]) {
    return (await exec('git', args, { cwd: root, maxBuffer: 20 * 1024 * 1024 })).stdout;
  }
  async load(reload = false) {
    const source = reload ? this.source : (await vscode.window.showOpenDialog({
      canSelectMany: false, filters: { 'Review HTML': ['html', 'htm'] },
    }))?.[0];
    if (!source) {return this.review;}
    return this.loadDocument(source);
  }
  async loadDocument(source: vscode.Uri) {
    const html = Buffer.from(await vscode.workspace.fs.readFile(source)).toString('utf8');
    const metadata = parseReview(html);
    const folders = this.folders();
    const folder = metadata.repository ? folders.find(f => f.name === metadata.repository) : folders.length === 1 ? folders[0] : undefined;
    if (!folder) {throw new Error('Set repository to an open workspace folder name (required for multi-root workspaces).');}
    const root = (await this.git(folder.uri.fsPath, ['rev-parse', '--show-toplevel'])).trim();
    metadata.base = (await this.git(root, ['rev-parse', '--verify', '--end-of-options', `${metadata.base}^{commit}`])).trim();
    if (metadata.head !== 'working-tree') {metadata.head = (await this.git(root, ['rev-parse', '--verify', '--end-of-options', `${metadata.head}^{commit}`])).trim();}
    const entries = (await this.git(root, ['diff', '--name-status', '-z', '--find-renames', metadata.base,
      ...(metadata.head === 'working-tree' ? [] : [metadata.head]), '--'])).split('\0');
    const files: ReviewFile[] = [];
    for (let i = 0; i < entries.length && entries[i];) {
      const status = entries[i++][0];
      const oldPath = entries[i++];
      files.push(status === 'R' || status === 'C'
        ? { path: entries[i++], basePath: oldPath, status }
        : { path: oldPath, status });
    }
    const stats = (await this.git(root, ['diff', '--numstat', '-z', '--find-renames', metadata.base,
      ...(metadata.head === 'working-tree' ? [] : [metadata.head]), '--'])).split('\0');
    for (let i = 0; i < stats.length && stats[i];) {
      const record = stats[i++];
      const first = record.indexOf('\t'), second = record.indexOf('\t', first + 1);
      const added = record.slice(0, first), removed = record.slice(first + 1, second);
      let filePath = record.slice(second + 1);
      if (!filePath) { i++; filePath = stats[i++]; }
      const file = files.find(entry => entry.path === filePath);
      if (file) {
        if (added === '-' || removed === '-') { file.binary = true; }
        else { file.additions = Number(added); file.deletions = Number(removed); }
      }
    }
    if (metadata.head === 'working-tree') {
      const untracked = (await this.git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
      for (const file of untracked) {
        if (!files.some(entry => entry.path === file)) {
          const target = path.join(root, file);
          const info = await fs.lstat(target);
          const content = info.isSymbolicLink() ? Buffer.from(await fs.readlink(target)) : await fs.readFile(target);
          const binary = content.subarray(0, 8000).includes(0);
          const additions = content.reduce((count, byte) => count + (byte === 10 ? 1 : 0), 0)
            + (content.length && content[content.length - 1] !== 10 ? 1 : 0);
          files.push({ path: file, status: 'A', ...(binary ? { binary: true } : { additions, deletions: 0,
            significantAdditions: content.toString('utf8').split('\n').filter(line => isSignificantLine(line, file)).length, significantDeletions: 0 }) });
        }
      }
    }
    for (const file of files) {
      if (file.binary || file.significantAdditions !== undefined) { continue; }
      file.significantAdditions = 0; file.significantDeletions = 0;
      if (!file.additions && !file.deletions) { continue; }
      const patch = await this.git(root, ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=0', '--find-renames', metadata.base,
        ...(metadata.head === 'working-tree' ? [] : [metadata.head]), '--', file.path, ...(file.basePath ? [file.basePath] : [])]);
      let inHunk = false;
      for (const line of patch.split('\n')) {
        if (line.startsWith('diff --git ')) { inHunk = false; }
        if (line.startsWith('@@ ')) { inHunk = true; continue; }
        if (!inHunk || !isSignificantLine(line.slice(1), file.path)) { continue; }
        if (line.startsWith('+')) { file.significantAdditions++; }
        if (line.startsWith('-')) { file.significantDeletions++; }
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    this.source = source;
    this.review = { html, metadata, root, files };
    return this.review;
  }
  get state() { return this.review; }
  async openFile(filePath: string) {
    const file = this.review?.files.find(entry => entry.path === filePath);
    if (!file) { throw new Error('File is not in the loaded comparison. Reload the review to refresh the file tree.'); }
    await this.open(`flowrider://diff?path=${encodeURIComponent(file.path)}&basePath=${encodeURIComponent(file.basePath ?? file.path)}&line=1`, file.status === 'D');
  }
  async open(href: string, deleted = false) {
    if (!this.review) {throw new Error('Load a review document first.');}
    const { file, line, basePath } = parseReviewLink(href);
    // Apply the same path validation to explicit pre-rename paths.
    parseReviewLink(`flowrider://diff?path=${encodeURIComponent(basePath)}&line=1`);
    const { metadata, root } = this.review;
    let right: string;
    if (deleted) { right = ''; }
    else if (metadata.head === 'working-tree') {
      const target = await fs.realpath(path.join(root, file));
      const relative = path.relative(await fs.realpath(root), target);
      if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {throw new Error('File resolves outside the repository.');}
      right = await fs.readFile(target, 'utf8');
    } else {right = await this.git(root, ['show', `${metadata.head}:${file}`]);}
    if (right.includes('\0')) {throw new Error('Binary files are not supported.');}
    if (line > right.split('\n').length) {throw new Error(`Line ${line} is beyond the end of ${file}. Regenerate the diagram to update links.`);}
    // A path absent from the base represents an added file. Other Git errors propagate.
    const exists = await this.git(root, ['ls-tree', '-z', metadata.base, '--', basePath]);
    const left = exists ? await this.git(root, ['show', `${metadata.base}:${basePath}`]) : '';
    const makeUri = (ref: string, name: string, text: string) => {
      const uri = vscode.Uri.from({ scheme: 'flowrider-review', path: '/' + name,
        query: new URLSearchParams({ root, ref, ...(ref === 'working-tree' ? { snapshot: String(Date.now()) } : {}) }).toString() });
      this.documents.set(uri.toString(), text);
      return uri;
    };
    if (!this.column || !vscode.window.tabGroups.all.some(g => g.viewColumn === this.column)) {
      this.column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
      if (vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview) {
        this.column = vscode.ViewColumn.Beside;
      }
    }
    await vscode.commands.executeCommand('vscode.diff', makeUri(metadata.base, basePath, left), makeUri(metadata.head, file, right),
      `${file} · ${metadata.base.slice(0, 8)} → ${metadata.head.slice(0, 12)}`, {
        viewColumn: this.column, preview: true, selection: new vscode.Range(line - 1, 0, line - 1, 0),
      });
    this.column = vscode.window.tabGroups.activeTabGroup.viewColumn;
  }
}
