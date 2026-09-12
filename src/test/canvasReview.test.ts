import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { FlowWebviewManager } from '../webviewUtils';
import { parseReview } from '../diffReview';

suite('Canvas review', () => {
  test('real webview zoom, pan, fit, preserved viewport and canvas validation', async function () {
    this.timeout(20000);
    const extensionUri = vscode.Uri.file(path.resolve(__dirname, '../..'));
    const subscriptions: vscode.Disposable[] = [];
    const manager = new FlowWebviewManager({ extensionUri, extensionPath: extensionUri.fsPath, subscriptions,
      extensionMode: vscode.ExtensionMode.Production } as vscode.ExtensionContext, 'canvas-test');
    const panel = vscode.window.createWebviewPanel('canvas-test', 'Canvas UI test', vscode.ViewColumn.One, {
      enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    });
    try {
      const html = await fs.readFile(path.join(extensionUri.fsPath, 'design_docs/test_reviews/canvas-large.html'), 'utf8');
      const invalid = await fs.readFile(path.join(extensionUri.fsPath, 'design_docs/test_reviews/canvas-invalid.html'), 'utf8');
      let navigations = 0;
      const finished = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Canvas UI test timed out')), 15000);
        subscriptions.push({ dispose: () => clearTimeout(timeout) });
        subscriptions.push(panel.webview.onDidReceiveMessage(message => {
          if (message.type === 'requestReview') { void panel.webview.postMessage({ type: 'reviewUpdated', html, metadata: parseReview(html) }); }
          if (message.type === 'openReviewLink') { navigations++; }
          if (message.type === 'testInvalid') { void panel.webview.postMessage({ type: 'reviewUpdated', html: invalid, metadata: parseReview(invalid) }); }
          if (message.type === 'canvasTestDone') { clearTimeout(timeout); resolve(); }
          if (message.type === 'canvasTestError') { clearTimeout(timeout); reject(new Error(message.error)); }
        }));
      });
      const probe = `<script nonce="canvas-probe">
        const api = acquireVsCodeApi(); window.acquireVsCodeApi = () => api;
        let phase = 0, initial = 0, previous = '', fitted = '';
        const poll = setInterval(() => {
          try {
            const tab = [...document.querySelectorAll('button')].find(b => b.textContent === 'Diff Review'); if (tab) tab.click();
            const frame = document.querySelector('iframe[title="Review diagram"]');
            const doc = frame?.contentDocument, svg = doc?.querySelector('svg[data-flowrider-canvas]');
            if (!svg || !document.querySelector('[aria-label="Canvas zoom"]')) return;
            const scale = () => Number(svg.style.transform.match(/scale\\(([^)]+)\\)/)?.[1]);
            const check = (ok, message) => { if (!ok) throw new Error(message); };
            if (phase === 0) {
              if (!svg.style.transform) return;
              initial = scale(); check(initial > 0 && initial <= 1, 'Initial fit missing');
              document.querySelector('[aria-label="Zoom in"]').click();
            } else if (phase === 1) {
              check(scale() > initial, 'Zoom button failed'); previous = svg.style.transform;
              doc.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -25, clientX: 100, clientY: 100, cancelable: true }));
            } else if (phase === 2) {
              check(svg.style.transform !== previous, 'Pinch-style wheel zoom failed'); previous = svg.style.transform;
              doc.dispatchEvent(new WheelEvent('wheel', { deltaX: 60, deltaY: 30, cancelable: true }));
            } else if (phase === 3) {
              check(svg.style.transform !== previous, 'Wheel pan failed'); previous = svg.style.transform;
              document.querySelector('[role="separator"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
            } else if (phase === 4) {
              check(svg.style.transform === previous, 'Manual viewport reset during pane resize');
              doc.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 }));
              doc.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 180, clientY: 140, cancelable: true }));
              doc.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch' }));
              svg.querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            } else if (phase === 5) {
              check(svg.style.transform !== previous, 'Touch pan failed');
              svg.querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
            } else if (phase === 6) {
              fitted = svg.style.transform; check(scale() <= 1, 'Fit shortcut failed');
              doc.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
            } else if (phase === 7) {
              check(scale() === 1 && svg.style.transform !== fitted, 'Actual-size reset failed');
              api.postMessage({ type: 'testInvalid' });
            } else {
              const error = document.querySelector('[role="alert"]');
              if (!error?.textContent.includes('viewBox')) return;
              clearInterval(poll); api.postMessage({ type: 'canvasTestDone' });
            }
            phase++;
          } catch (error) { clearInterval(poll); api.postMessage({ type: 'canvasTestError', error: String(error) }); }
        }, 120);
      </script>`;
      panel.webview.html = manager.getHtml(panel.webview).replace('script-src ', "script-src 'nonce-canvas-probe' ").replace('<body>', '<body>' + probe);
      await finished;
      assert.strictEqual(navigations, 1, 'Pan gesture must not navigate; ordinary click must navigate');
    } finally { panel.dispose(); subscriptions.forEach(s => s.dispose()); }
  });
});
