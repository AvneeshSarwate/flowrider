import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { FlowWebviewManager } from '../webviewUtils';
import { parseReview } from '../diffReview';

suite('Embedded diagrams', () => {
  test('mixed document has independent zoom, scroll and resizable viewers', async function () {
    this.timeout(20000);
    const extensionUri = vscode.Uri.file(path.resolve(__dirname, '../..'));
    const subscriptions: vscode.Disposable[] = [];
    const manager = new FlowWebviewManager({ extensionUri, extensionPath: extensionUri.fsPath, subscriptions,
      extensionMode: vscode.ExtensionMode.Production } as vscode.ExtensionContext, 'embedded-test');
    const panel = vscode.window.createWebviewPanel('embedded-test', 'Mixed review UI test', vscode.ViewColumn.One, {
      enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    });
    try {
      const html = await fs.readFile(path.join(extensionUri.fsPath, 'design_docs/test_reviews/mixed-prose-diagrams.html'), 'utf8');
      let links = 0;
      const finished = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Mixed document test timed out')), 15000);
        subscriptions.push({ dispose: () => clearTimeout(timeout) });
        subscriptions.push(panel.webview.onDidReceiveMessage(message => {
          if (message.type === 'requestReview') { void panel.webview.postMessage({ type: 'reviewUpdated', html, metadata: parseReview(html) }); }
          if (message.type === 'openReviewLink') { links++; }
          if (message.type === 'embeddedDone') { clearTimeout(timeout); resolve(); }
          if (message.type === 'embeddedError') { clearTimeout(timeout); reject(new Error(message.error)); }
        }));
      });
      const probe = `<script nonce="embedded-probe">
        const api = acquireVsCodeApi(); window.acquireVsCodeApi = () => api;
        let phase = 0, other = '', before = '', scroll = 0;
        const poll = setInterval(() => {
          try {
            const tab = [...document.querySelectorAll('button')].find(b => b.textContent === 'Diff Review'); if (tab) tab.click();
            const doc = document.querySelector('iframe')?.contentDocument;
            const viewers = doc?.querySelectorAll('.flowrider-embedded-diagram');
            if (!viewers?.length) return;
            const check = (ok, message) => { if (!ok) throw new Error(message); };
            const first = viewers[0], viewport = first.querySelector('.flowrider-diagram-viewport');
            const svg = first.querySelector('svg'), second = viewers[1].querySelector('svg');
            if (!svg.style.transform || !second.style.transform) return;
            if (phase === 0) {
              check(viewers.length === 6, 'Expected six in-place viewers');
              check(doc.scrollingElement.scrollHeight > doc.defaultView.innerHeight * 4, 'Long prose lost scrolling');
              first.scrollIntoView(); other = second.style.transform; before = svg.style.transform;
              first.querySelector('[aria-label="Zoom in"]').click();
            } else if (phase === 1) {
              check(svg.style.transform !== before && second.style.transform === other, 'Zoom is not independent');
              before = svg.style.transform;
              const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }); viewport.dispatchEvent(wheel);
              check(!wheel.defaultPrevented && svg.style.transform === before, 'Ordinary document scrolling was intercepted');
              const rect = viewport.getBoundingClientRect();
              viewport.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -30, clientX: rect.left + 50, clientY: rect.top + 50, bubbles: true, cancelable: true }));
            } else if (phase === 2) {
              check(svg.style.transform !== before && second.style.transform === other, 'Local pinch zoom failed');
              before = svg.style.transform; scroll = doc.scrollingElement.scrollTop;
              first.querySelector('[role="separator"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            } else if (phase === 3) {
              check(viewport.clientHeight === 360 && svg.style.transform === before, 'Resize lost manual viewport');
              check(doc.scrollingElement.scrollTop === scroll, 'Resize lost reading position');
              viewport.focus({ preventScroll: true });
              viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            } else if (phase === 4) {
              check(svg.style.transform !== before && second.style.transform === other, 'Keyboard pan affected another diagram');
              svg.querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              first.querySelector('[aria-label="Fit diagram"]').click();
            } else {
              check(doc.scrollingElement.scrollTop === scroll, 'Fit or navigation moved reading position');
              clearInterval(poll); api.postMessage({ type: 'embeddedDone' });
            }
            phase++;
          } catch (error) { clearInterval(poll); api.postMessage({ type: 'embeddedError', error: String(error) }); }
        }, 150);
      </script>`;
      panel.webview.html = manager.getHtml(panel.webview).replace('script-src ', "script-src 'nonce-embedded-probe' ").replace('<body>', '<body>' + probe);
      await finished;
      assert.strictEqual(links, 1);
    } finally { panel.dispose(); subscriptions.forEach(s => s.dispose()); }
  });
});
