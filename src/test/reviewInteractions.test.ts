import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { FlowWebviewManager } from '../webviewUtils';
import { parseReview } from '../diffReview';

suite('Review document interactions', () => {
  test('native disclosures toggle and repeated code links reveal filtered/collapsed tree files', async function () {
    this.timeout(20000);
    const extensionUri = vscode.Uri.file(path.resolve(__dirname, '../..'));
    const subscriptions: vscode.Disposable[] = [];
    const manager = new FlowWebviewManager({ extensionUri, extensionPath: extensionUri.fsPath, subscriptions,
      extensionMode: vscode.ExtensionMode.Production } as vscode.ExtensionContext, 'interaction-test');
    const panel = vscode.window.createWebviewPanel('interaction-test', 'Review interaction test', vscode.ViewColumn.One, {
      enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    });
    try {
      const html = await fs.readFile(path.join(extensionUri.fsPath, 'design_docs/test_reviews/details-and-links.html'), 'utf8');
      const target = 'webview-ui/src/components/DiffReview.tsx';
      let navigations = 0;
      const copies: string[] = [];
      const finished = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Interaction test timed out')), 15000);
        subscriptions.push({ dispose: () => clearTimeout(timer) });
        subscriptions.push(panel.webview.onDidReceiveMessage(message => {
          if (message.type === 'requestReview') {
            void panel.webview.postMessage({ type: 'reviewUpdated', html, metadata: parseReview(html), files: [
              ...Array.from({ length: 150 }, (_, i) => ({ path: `webview-ui/src/components/A${i}.tsx`, status: 'M', additions: 1, deletions: 2 })),
              { path: target, status: 'M', additions: 3, deletions: 4, significantAdditions: 1, significantDeletions: 2 },
            ] });
          }
          if (message.type === 'openReviewLink') { navigations++; }
          if (message.type === 'copyReviewText') { copies.push(message.text); }
          if (message.type === 'interactionDone') { clearTimeout(timer); resolve(); }
          if (message.type === 'interactionError') { clearTimeout(timer); reject(new Error(message.error)); }
        }));
      });
      const probe = `<script nonce="interaction-probe">
        const api=acquireVsCodeApi(); window.acquireVsCodeApi=()=>api;
        let phase=0, diagramTop=0;
        const poll=setInterval(()=>{
          try {
            const tab=[...document.querySelectorAll('button')].find(b=>b.textContent==='Diff Review'); if(tab)tab.click();
            const frame=document.querySelector('iframe'), doc=frame?.contentDocument;
            const details=doc?.querySelector('details'); if(!details)return;
            const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
            const filter=document.querySelector('[aria-label="Filter changed files"]');
            const collapse=()=>{
              document.querySelector('[aria-label="Collapse all folders"]').click();
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(filter,'not-found');
              filter.dispatchEvent(new Event('input',{bubbles:true}));
            };
            if(phase===0){collapse();details.querySelector('summary span').click();diagramTop=frame.getBoundingClientRect().top;}
            else if(phase===1){check(details.open,'Summary click did not expand details');check(filter.value==='not-found','Filter setup failed');details.querySelector('a').click();}
            else if(phase===2 || phase===4){
              const selected=document.querySelector('.review-file[aria-pressed="true"]');
              check(selected?.textContent.includes('DiffReview.tsx'),'Target not selected');
              check(selected.querySelector('.review-lines-added').textContent==='+3','File additions missing');
              check(selected.querySelector('.review-lines-removed').textContent==='−4','File deletions missing');
              const summaries=[...document.querySelectorAll('.review-tree summary')];
              check(summaries.length===3 && summaries.every(s=>s.querySelector('.review-lines-added').textContent==='+153' && s.querySelector('.review-lines-removed').textContent==='−304'),'Recursive folder totals incorrect');
              check(summaries.every(s=>getComputedStyle(s.querySelector('.review-line-counts')).visibility==='hidden'),'Expanded directory counts should be hidden');
              const countLeft=selected.querySelector('.review-line-counts').getBoundingClientRect().left;
              check(summaries.every(s=>Math.abs(s.querySelector('.review-line-counts').getBoundingClientRect().left-countLeft)<1),'Directory and file count columns are misaligned');
              check(filter.value==='','Filter not cleared');
              const scroller=document.querySelector('.review-tree-scroll');
              const row=selected.getBoundingClientRect(), bounds=scroller.getBoundingClientRect();
              check(row.top>=bounds.top-1 && row.bottom<=bounds.bottom+1,'Target not scrolled into view');
              check(frame.getBoundingClientRect().top===diagramTop,'Tree reveal moved diagram');
              if(phase===2)collapse();else details.querySelector('summary span').click();
            }else if(phase===3){details.querySelector('a').click();}
            else if(phase===5){
              check(!details.open,'Summary click did not collapse details');
              document.querySelector('[aria-label="Show significant LOC"]').click();
              document.querySelector('[aria-label="Collapse all folders"]').click();
            }else if(phase===6){
              const summary=document.querySelector('.review-tree summary');
              check(getComputedStyle(summary.querySelector('.review-line-counts')).visibility==='visible','Collapsed directory counts missing');
              check(summary.querySelector('.review-lines-added').textContent==='+151','Significant directory additions incorrect');
              check(summary.querySelector('.review-lines-removed').textContent==='−302','Significant directory deletions incorrect');
              document.querySelector('[aria-label="Expand all folders"]').click();
            }else if(phase===7){
              const selected=document.querySelector('.review-file[aria-pressed="true"]');
              check(selected.querySelector('.review-lines-added').textContent==='+1','Significant file additions incorrect');
              document.querySelector('[aria-label="Show significant LOC"]').click();
            }else{
              check(document.querySelector('.review-file[aria-pressed="true"] .review-lines-added').textContent==='+3','LOC toggle did not restore counts');
              const range=doc.createRange();range.selectNodeContents(details.querySelector('summary span'));
              doc.getSelection().removeAllRanges();doc.getSelection().addRange(range);
              doc.dispatchEvent(new KeyboardEvent('keydown',{key:'c',metaKey:true,bubbles:true,cancelable:true}));
              doc.dispatchEvent(new KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true,cancelable:true}));
              doc.dispatchEvent(new Event('copy',{bubbles:true,cancelable:true}));
              doc.getSelection().removeAllRanges();
              const emptyCopy=new KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true,cancelable:true});
              doc.dispatchEvent(emptyCopy);check(!emptyCopy.defaultPrevented,'Empty selection should preserve native copy');
              clearInterval(poll);api.postMessage({type:'interactionDone'});
            }
            phase++;
          }catch(error){clearInterval(poll);api.postMessage({type:'interactionError',error:String(error)});}
        },150);
      </script>`;
      panel.webview.html=manager.getHtml(panel.webview).replace('script-src ',"script-src 'nonce-interaction-probe' ").replace('<body>','<body>'+probe);
      await finished;
      assert.strictEqual(navigations,2);
      assert.deepStrictEqual(copies, Array(3).fill('Open this explanation'));
    } finally { panel.dispose(); subscriptions.forEach(s=>s.dispose()); }
  });
  test('review copy writes to the system clipboard', async () => {
    const original = await vscode.env.clipboard.readText();
    const subscriptions: vscode.Disposable[] = [];
    const manager = new FlowWebviewManager({ extensionUri: vscode.Uri.file(path.resolve(__dirname, '../..')),
      extensionPath: path.resolve(__dirname, '../..'), subscriptions, extensionMode: vscode.ExtensionMode.Production } as unknown as vscode.ExtensionContext, 'clipboard-test');
    try {
      await manager.handleMessage({ type: 'copyReviewText', text: 'Review selection\nUnicode: → ✓' });
      assert.strictEqual(await vscode.env.clipboard.readText(), 'Review selection\nUnicode: → ✓');
      await manager.handleMessage({ type: 'copyReviewText', text: '' });
      assert.strictEqual(await vscode.env.clipboard.readText(), 'Review selection\nUnicode: → ✓');
    } finally { subscriptions.forEach(subscription => subscription.dispose()); await vscode.env.clipboard.writeText(original); }
  });
});
