import * as assert from 'assert';
import * as vscode from 'vscode';
import { DiffReview, parseReview, parseReviewLink } from '../diffReview';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FlowWebviewManager } from '../webviewUtils';

suite('Diff Review', () => {
  test('real webview receives a review and its SVG link sends navigation', async function () {
    this.timeout(20000);
    const extensionUri = vscode.Uri.file(path.resolve(__dirname, '../..'));
    const subscriptions: vscode.Disposable[] = [];
    const manager = new FlowWebviewManager({ extensionUri, extensionPath: extensionUri.fsPath, subscriptions,
      extensionMode: vscode.ExtensionMode.Production } as vscode.ExtensionContext, 'review-test');
    const panel = vscode.window.createWebviewPanel('review-test', 'Review UI test', vscode.ViewColumn.One, {
      enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    });
    try {
      const html = await fs.readFile(path.join(extensionUri.fsPath, 'design_docs/review-example.html'), 'utf8');
      const navigation = new Promise<string>((resolve, reject) => {
        let diagramHref = '';
        const timeout = setTimeout(() => reject(new Error('Review UI did not render and navigate within 15 seconds')), 15000);
        subscriptions.push({ dispose: () => clearTimeout(timeout) });
        subscriptions.push(panel.webview.onDidReceiveMessage(message => {
          if (message.type === 'requestReview') {
            void panel.webview.postMessage({ type: 'reviewUpdated', html, metadata: parseReview(html), files: [{ path: 'src/diffReview.ts', status: 'M' },
              ...Array.from({ length: 150 }, (_, i) => ({ path: `src/z-file-${i}.ts`, status: 'M' }))] });
          }
          if (message.type === 'probeError') { clearTimeout(timeout); reject(new Error(message.error)); }
          if (message.type === 'openReviewLink') { diagramHref = message.href; }
          if (message.type === 'openReviewFile') {
            clearTimeout(timeout);
            if (message.filePath !== 'src/diffReview.ts') { reject(new Error('Incorrect tree navigation')); }
            else { resolve(diagramHref); }
          }
        }));
      });
      // A test-only probe clicks the rendered SVG. Messages still travel through
      // VS Code's real host bridge, not window.postMessage in a browser mock.
      const probe = `<script nonce="review-probe">
        const api = acquireVsCodeApi();
        window.acquireVsCodeApi = () => api;
        let phase = 0;
        let diagramTop = 0;
        const poll = setInterval(() => {
          const tab = [...document.querySelectorAll('button')].find(b => b.textContent === 'Diff Review');
          if (tab) tab.click();
          const frame = document.querySelector('iframe[title="Review diagram"]');
          const anchor = frame?.contentDocument?.querySelector('svg a');
          const file = document.querySelector('.review-file');
          if (anchor && file && tab.closest('header')) {
            const fail = error => { clearInterval(poll); api.postMessage({ type: 'probeError', error }); };
            if (phase === 0) {
              document.querySelector('[aria-label="Collapse all folders"]').click(); phase++; return;
            }
            if (phase === 1) {
              if (document.querySelector('.review-tree details[open]')) return fail('Collapse all failed');
              document.querySelector('[aria-label="Expand all folders"]').click(); phase++; return;
            }
            if (phase === 2) {
              if (!document.querySelector('.review-tree details[open]')) return fail('Expand all failed');
              document.querySelector('[role="separator"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
              phase++; return;
            }
            if (phase === 3) {
              if (document.querySelector('[role="separator"]').getAttribute('aria-valuenow') !== '50') return fail('Splitter resize failed');
              const scroll = document.querySelector('.review-tree-scroll');
              if (scroll.scrollHeight <= scroll.clientHeight) return fail('Tree has no independent overflow');
              diagramTop = frame.getBoundingClientRect().top;
              scroll.scrollTop = 300;
              phase++; return;
            }
            if (document.querySelector('.review-tree-scroll').scrollTop === 0 || frame.getBoundingClientRect().top !== diagramTop) return fail('Tree scroll moved diagram');
            clearInterval(poll);
            anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            file.click();
          }
        }, 100);
      </script>`;
      panel.webview.html = manager.getHtml(panel.webview)
        .replace('script-src ', "script-src 'nonce-review-probe' ")
        .replace('<body>', '<body>' + probe);
      const expectedHref = html.match(/href="(flowrider:\/\/[^\"]+)"/)?.[1].replace(/&amp;/g, '&');
      assert.ok(expectedHref, 'Example contains a diagram link');
      assert.strictEqual(await navigation, expectedHref);
    } finally { panel.dispose(); subscriptions.forEach(s => s.dispose()); }
  });
  test('Git snapshots, added files and fresh saved working-tree content', async function () {
    this.timeout(15000);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrider-review-test-'));
    const git = async (...args: string[]) => (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
    const review = new DiffReview(() => [{ name: 'fixture', index: 0, uri: vscode.Uri.file(root) }]);
    try {
      await git('init'); await git('config', 'user.name', 'Review test'); await git('config', 'user.email', 'test@example.invalid');
      await fs.writeFile(path.join(root, 'file.ts'), 'one\nold\n');
      await fs.writeFile(path.join(root, 'deleted.ts'), 'deleted content\n');
      await fs.writeFile(path.join(root, 'old name.ts'), 'rename content\n');
      await git('add', '.'); await git('commit', '-m', 'base');
      const base = await git('rev-parse', 'HEAD');
      await fs.writeFile(path.join(root, 'file.ts'), 'one\nnew\nthree\n');
      await fs.writeFile(path.join(root, 'added.ts'), 'added\n');
      await fs.unlink(path.join(root, 'deleted.ts'));
      await fs.rename(path.join(root, 'old name.ts'), path.join(root, 'new name.ts'));
      await git('add', '.'); await git('commit', '-m', 'head');
      const source = vscode.Uri.file(path.join(root, 'review.html'));
      const writeReview = async (head: string) => fs.writeFile(source.fsPath, `<script id="flowrider-review">${JSON.stringify({ version: 1, base, head })}</script>`);
      await writeReview('HEAD'); await review.loadDocument(source);
      assert.deepStrictEqual(review.state?.files, [
        { path: 'added.ts', status: 'A' }, { path: 'deleted.ts', status: 'D' },
        { path: 'file.ts', status: 'M' }, { path: 'new name.ts', basePath: 'old name.ts', status: 'R' },
      ]);
      await review.openFile('deleted.ts');
      const deleted = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      assert.ok(deleted instanceof vscode.TabInputTextDiff);
      assert.strictEqual((await vscode.workspace.openTextDocument(deleted.modified)).getText(), '');
      assert.strictEqual((await vscode.workspace.openTextDocument(deleted.original)).getText(), 'deleted content\n');
      await review.openFile('new name.ts');
      const renamed = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      assert.ok(renamed instanceof vscode.TabInputTextDiff);
      assert.strictEqual((await vscode.workspace.openTextDocument(renamed.original)).getText(), 'rename content\n');
      await review.open('flowrider://diff?path=file.ts&line=2');
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      assert.ok(input instanceof vscode.TabInputTextDiff);
      assert.strictEqual((await vscode.workspace.openTextDocument(input.original)).getText(), 'one\nold\n');
      assert.strictEqual((await vscode.workspace.openTextDocument(input.modified)).getText(), 'one\nnew\nthree\n');
      const column = vscode.window.tabGroups.activeTabGroup.viewColumn;
      await review.open('flowrider://diff?path=added.ts&line=1');
      assert.strictEqual(vscode.window.tabGroups.activeTabGroup.viewColumn, column);
      const added = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      assert.ok(added instanceof vscode.TabInputTextDiff);
      assert.strictEqual((await vscode.workspace.openTextDocument(added.original)).getText(), '');
      await writeReview('working-tree'); await review.loadDocument(source);
      assert.ok(review.state?.files.some(file => file.path === 'review.html' && file.status === 'A'));
      await fs.writeFile(path.join(root, 'file.ts'), 'saved\nchanged\n');
      await review.open('flowrider://diff?path=file.ts&line=2');
      const working = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      assert.ok(working instanceof vscode.TabInputTextDiff);
      assert.strictEqual((await vscode.workspace.openTextDocument(working.modified)).getText(), 'saved\nchanged\n');
      await assert.rejects(review.open('flowrider://diff?path=file.ts&line=99'), /beyond the end/);
      await assert.rejects(review.open('flowrider://diff?path=missing.ts&line=1'));
    } finally { review.dispose(); await fs.rm(root, { recursive: true, force: true }); }
  });
  test('metadata and exact right-side links', () => {
    assert.strictEqual(parseReview('<script type="application/json" id="flowrider-review">{"version":1,"base":"HEAD","head":"working-tree"}</script>').head, 'working-tree');
    assert.deepStrictEqual(parseReviewLink('flowrider://diff?path=src%2Fa.ts&line=87'), { file: 'src/a.ts', basePath: 'src/a.ts', line: 87 });
    for (const href of ['flowrider://diff?path=../secret&line=1', 'flowrider://diff?path=a&line=0', 'flowrider://diff?path=a&line=2&side=base']) {assert.throws(() => parseReviewLink(href));}
    assert.throws(() => parseReview('<html></html>'));
  });
  test('native diff selects the requested modified-document line', async () => {
    const review = new DiffReview();
    const provider = vscode.workspace.registerTextDocumentContentProvider('review-test', {
      provideTextDocumentContent: uri => uri.path === '/base.ts' ? 'one\nold\nthree\n' : 'one\nnew\nthree\n',
    });
    try {
      const right = vscode.Uri.parse('review-test:/head.ts');
      await vscode.commands.executeCommand('vscode.diff', vscode.Uri.parse('review-test:/base.ts'), right, 'Review test', {
        selection: new vscode.Range(1, 0, 1, 0), preview: true,
      });
      assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff);
      const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === right.toString());
      assert.ok(editor, 'Modified editor is visible');
      assert.strictEqual(editor.selection.active.line, 1);
    } finally { provider.dispose(); review.dispose(); }
  });
});
