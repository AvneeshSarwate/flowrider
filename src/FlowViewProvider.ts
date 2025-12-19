import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExtensionMessage, FlowSummary, MalformedComment, WebviewMessage } from './types';

// Must match webview-ui/vite.config.ts. Override with FLOWRIDER_DEV_PORT env var.
const DEV_SERVER_PORT = parseInt(process.env.FLOWRIDER_DEV_PORT || '5199', 10);
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

export class FlowViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'flowrider.flowsView';

  private view?: vscode.WebviewView;
  private flows: FlowSummary[] = [];
  private malformed: MalformedComment[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionId: string
  ) {}

  private get isDev(): boolean {
    // Only use dev server when explicitly enabled to avoid broken webview in normal debug runs.
    return (
      this.context.extensionMode === vscode.ExtensionMode.Development &&
      process.env.FLOWRIDER_DEV_SERVER === 'true'
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    if (this.isDev) {
      this.setupDevModeFileWatcher(webviewView);
    }

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      console.log('FlowViewProvider received message:', message);
      if (message.type === 'openLocation') {
        console.log('Opening file:', message.filePath, 'at line:', message.lineNumber);
        await this.openFileAtLine(message.filePath, message.lineNumber);
      }

      if (message.type === 'requestFlows') {
        this.pushFlows();
      }

      if (message.type === 'writeFlowToDb') {
        await vscode.commands.executeCommand('flowrider.writeFlowToDb', message.flowName);
      }

      if (message.type === 'findMissingEdgeCandidates') {
        await vscode.commands.executeCommand('flowrider.findMissingEdgeCandidates', message.flowName, message.edge);
      }

      if (message.type === 'insertMissingComment') {
        await vscode.commands.executeCommand('flowrider.insertMissingComment', message.flowName, message.edge);
      }

      if (message.type === 'insertAtCandidate') {
        await vscode.commands.executeCommand('flowrider.insertAtCandidate', message.flowName, message.edge, message.line);
      }

      if (message.type === 'findMovedEdgeCandidates') {
        await vscode.commands.executeCommand('flowrider.findMovedEdgeCandidates', message.flowName, message.edge);
      }
    });

    this.pushFlows();
  }

  update(flows: FlowSummary[], malformed: MalformedComment[]): void {
    this.flows = flows;
    this.malformed = malformed;
    this.pushFlows();
  }

  private pushFlows() {
    if (!this.view) {
      return;
    }

    const payload: ExtensionMessage = {
      type: 'flowsUpdated',
      sessionId: this.sessionId,
      flows: this.flows,
      malformed: this.malformed,
    };

    this.view.webview.postMessage(payload);
  }

  pushMissingCandidates(data: import('./types').MissingEdgeCandidates) {
    if (!this.view) return;
    const payload: ExtensionMessage = {
      type: 'missingEdgeCandidates',
      data,
    };
    this.view.webview.postMessage(payload);
  }

  pushMovedCandidates(data: import('./types').MovedEdgeCandidates) {
    if (!this.view) return;
    const payload: ExtensionMessage = {
      type: 'movedEdgeCandidates',
      data,
    };
    this.view.webview.postMessage(payload);
  }

  private async openFileAtLine(filePath: string, line: number) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const root = workspaceFolders && workspaceFolders[0]?.uri.fsPath;
    const resolved = path.isAbsolute(filePath) || !root ? filePath : path.join(root, filePath);
    const uri = vscode.Uri.file(resolved);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const position = new vscode.Position(line - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter
    );
  }

  private setupDevModeFileWatcher(webviewView: vscode.WebviewView) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.joinPath(this.context.extensionUri, 'out'),
        '**/*.js'
      )
    );

    const reload = () => {
      webviewView.webview.html = this.getHtml(webviewView.webview);
      this.pushFlows();
    };

    watcher.onDidChange(reload);
    webviewView.onDidDispose(() => watcher.dispose());
  }

  private getHtml(webview: vscode.Webview): string {
    if (this.isDev) {
      return this.getDevHtml(webview);
    }
    return this.getProdHtml(webview);
  }

  private getDevHtml(_webview: vscode.Webview): string {
    const csp = `
      default-src 'none';
      img-src data: ${DEV_SERVER_URL};
      style-src 'unsafe-inline' ${DEV_SERVER_URL};
      font-src data:;
      script-src 'unsafe-inline' ${DEV_SERVER_URL} http://localhost:8097;
      connect-src ${DEV_SERVER_URL} ws://localhost:${DEV_SERVER_PORT} http://localhost:8097 ws://localhost:8097;
    `;

    const reactRefresh = `
      <script type="module">
        import RefreshRuntime from "${DEV_SERVER_URL}/@react-refresh"
        RefreshRuntime.injectIntoGlobalHook(window)
        window.$RefreshReg$ = () => {}
        window.$RefreshSig$ = () => (type) => type
        window.__vite_plugin_react_preamble_installed__ = true
      </script>
    `;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp.replace(/\n/g, '')}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
  <div id="root"></div>
  ${reactRefresh}
  <script type="module" src="${DEV_SERVER_URL}/src/main.tsx"></script>
</body>
</html>`;
  }

  private getProdHtml(webview: vscode.Webview): string {
    const manifestPath = path.join(this.context.extensionPath, 'media', 'manifest.json');

    let scriptPath = 'index.js';
    let stylePath: string | undefined;

    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const entry = manifest['index.html'];
        scriptPath = entry.file ?? scriptPath;
        stylePath = entry.css?.[0];
      } catch (error) {
        console.error('Failed to read webview manifest', error);
      }
    }

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', scriptPath)
    );

    const styleUri = stylePath
      ? webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', stylePath))
      : undefined;

    const nonce = getNonce();

    const csp = `
      default-src 'none';
      img-src ${webview.cspSource} data:;
      style-src ${webview.cspSource} 'unsafe-inline';
      font-src ${webview.cspSource} data:;
      script-src ${webview.cspSource};
    `;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp.replace(/\n/g, '')}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${styleUri ? `<link rel="stylesheet" href="${styleUri}">` : ''}
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 16; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
