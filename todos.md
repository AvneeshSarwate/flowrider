is this ok in FlowViewProvider.ts?
```
from - script-src 'nonce-${nonce}';
to   - script-src ${webview.cspSource} 'unsafe-eval';
```