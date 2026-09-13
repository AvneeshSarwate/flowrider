import * as assert from 'assert';
import * as vscode from 'vscode';
import { DiffReview, parseReview, parseReviewLink, isSignificantLine } from '../diffReview';
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
        { path: 'added.ts', status: 'A', additions: 1, deletions: 0, significantAdditions: 1, significantDeletions: 0 }, { path: 'deleted.ts', status: 'D', additions: 0, deletions: 1, significantAdditions: 0, significantDeletions: 1 },
        { path: 'file.ts', status: 'M', additions: 2, deletions: 1, significantAdditions: 2, significantDeletions: 1 }, { path: 'new name.ts', basePath: 'old name.ts', status: 'R', additions: 0, deletions: 0, significantAdditions: 0, significantDeletions: 0 },
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
      await fs.writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 1, 2]));
      await fs.writeFile(path.join(root, 'comments.ts'), '// comment\n\nconst value = 1;\n');
      await fs.writeFile(path.join(root, 'file.ts'), 'one\n// comment\n\nnew\nthree\n');
      await writeReview('working-tree');
      const workingReview = await review.loadDocument(source);
      assert.strictEqual(workingReview.files.find(file => file.path === 'review.html')?.additions, 1);
      assert.strictEqual(workingReview.files.find(file => file.path === 'binary.dat')?.binary, true);
      assert.strictEqual(workingReview.files.find(file => file.path === 'comments.ts')?.additions, 3);
      assert.strictEqual(workingReview.files.find(file => file.path === 'comments.ts')?.significantAdditions, 1);
      assert.strictEqual(workingReview.files.find(file => file.path === 'file.ts')?.additions, 4);
      assert.strictEqual(workingReview.files.find(file => file.path === 'file.ts')?.significantAdditions, 2);
      assert.strictEqual(workingReview.files.find(file => file.path === 'file.ts')?.significantDeletions, 1);
      assert.ok(review.state?.files.some(file => file.path === 'review.html' && file.status === 'A'));
      await fs.writeFile(path.join(root, 'file.ts'), 'saved\nchanged\n');
      await review.open('flowrider://diff?path=file.ts&line=2');
      const working = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      assert.ok(working instanceof vscode.TabInputTextDiff);
      assert.strictEqual(working.modified.scheme, 'file');
      assert.strictEqual(await fs.realpath(working.modified.fsPath), await fs.realpath(path.join(root, 'file.ts')));
      assert.strictEqual(working.original.scheme, 'flowrider-review');
      assert.strictEqual((await vscode.workspace.openTextDocument(working.modified)).getText(), 'saved\nchanged\n');
      const live = await vscode.workspace.openTextDocument(working.modified);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(live.uri, new vscode.Position(2, 0), 'unsaved\nextra\n');
      assert.ok(await vscode.workspace.applyEdit(edit));
      try {
        await review.open('flowrider://diff?path=file.ts&line=4');
        assert.ok(live.isDirty);
        assert.strictEqual(await fs.readFile(path.join(root, 'file.ts'), 'utf8'), 'saved\nchanged\n');
        const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === live.uri.toString());
        assert.strictEqual(editor?.selection.active.line, 3);
        const definition = new vscode.Location(live.uri, new vscode.Position(0, 0));
        const provider = vscode.languages.registerDefinitionProvider({ scheme: 'file', pattern: '**/file.ts' }, {
          provideDefinition: () => [definition],
        });
        try {
          const definitions = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', live.uri, new vscode.Position(3, 0));
          assert.ok(definitions?.some(result => result.uri?.toString() === live.uri.toString()), 'File-scheme definition provider is available in the working-tree diff');
        } finally { provider.dispose(); }
      } finally {
        const undo = new vscode.WorkspaceEdit();
        undo.replace(live.uri, new vscode.Range(0, 0, live.lineCount, 0), 'saved\nchanged\n');
        await vscode.workspace.applyEdit(undo);
        await live.save();
      }
      await assert.rejects(review.open('flowrider://diff?path=file.ts&line=99'), /beyond the end/);
      await assert.rejects(review.open('flowrider://diff?path=missing.ts&line=1'));
    } finally { review.dispose(); await fs.rm(root, { recursive: true, force: true }); }
  });
  test('metadata and exact right-side links', () => {
    assert.strictEqual(isSignificantLine(' // explanation', 'code.ts'), false);
    assert.strictEqual(isSignificantLine('/* explanation */ const x = 1;', 'code.ts'), true);
    assert.strictEqual(isSignificantLine('  ', 'code.ts'), false);
    assert.strictEqual(isSignificantLine('const url = "https://example.com";', 'code.ts'), true);
    assert.strictEqual(isSignificantLine('# heading', 'readme.md'), true);
    assert.strictEqual(isSignificantLine('# comment', 'script.py'), false);
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
