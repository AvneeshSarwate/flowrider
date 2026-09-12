import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DiffReview } from './diffReview';
import { ExtensionMessage, FlowSummary, MalformedComment, MissingEdgeCandidates, MovedEdgeCandidates, WebviewMessage } from './types';

// Must match webview-ui/vite.config.ts. Override with FLOWRIDER_DEV_PORT env var.
const DEV_SERVER_PORT = parseInt(process.env.FLOWRIDER_DEV_PORT || '5199', 10);
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

export interface WebviewHost {
  postMessage(message: ExtensionMessage): void;
  dispose?(): void;
}

export class FlowWebviewManager {
  private readonly review = new DiffReview();
  private flows: FlowSummary[] = [];
  private malformed: MalformedComment[] = [];
  private activeHost: WebviewHost | null = null;
  private hostType: 'sidebar' | 'editor' | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionId: string
  ) { context.subscriptions.push(this.review); }

  get isDev(): boolean {
    return (
      this.context.extensionMode === vscode.ExtensionMode.Development &&
      process.env.FLOWRIDER_DEV_SERVER === 'true'
    );
  }

  setActiveHost(host: WebviewHost | null, type: 'sidebar' | 'editor' | null) {
    this.activeHost = host;
    this.hostType = type;
  }

  getActiveHostType(): 'sidebar' | 'editor' | null {
    return this.hostType;
  }

  clearHostIfMatches(type: 'sidebar' | 'editor') {
    if (this.hostType === type) {
      this.activeHost = null;
      this.hostType = null;
    }
  }

  update(flows: FlowSummary[], malformed: MalformedComment[]): void {
    this.flows = flows;
    this.malformed = malformed;
    this.pushFlows();
  }

  pushFlows(): void {
    if (!this.activeHost) return;

    const payload: ExtensionMessage = {
      type: 'flowsUpdated',
      sessionId: this.sessionId,
      flows: this.flows,
      malformed: this.malformed,
    };

    this.activeHost.postMessage(payload);
  }

  pushMissingCandidates(data: MissingEdgeCandidates): void {
    if (!this.activeHost) return;
    const payload: ExtensionMessage = {
      type: 'missingEdgeCandidates',
      data,
    };
    this.activeHost.postMessage(payload);
  }

  pushMovedCandidates(data: MovedEdgeCandidates): void {
    if (!this.activeHost) return;
    const payload: ExtensionMessage = {
      type: 'movedEdgeCandidates',
      data,
    };
    this.activeHost.postMessage(payload);
  }

  async handleMessage(message: WebviewMessage, sender: WebviewHost | null = this.activeHost): Promise<void> {
    if (message.type === 'loadReview' || message.type === 'requestReview' || message.type === 'openReviewLink' || message.type === 'openReviewFile') {
      try {
        if (message.type === 'openReviewLink') { await this.review.open(message.href); }
        else if (message.type === 'openReviewFile') { await this.review.openFile(message.filePath); }
        else {
          const state = message.type === 'loadReview' ? await this.review.load(message.reload) : this.review.state;
          sender?.postMessage({ type: 'reviewUpdated', html: state?.html, metadata: state?.metadata, files: state?.files });
        }
      } catch (error) {
        sender?.postMessage({ type: 'reviewError', error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    console.log('FlowWebviewManager received message:', message);

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
  }

  private async openFileAtLine(filePath: string, line: number): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const root = workspaceFolders && workspaceFolders[0]?.uri.fsPath;
    const resolved = path.isAbsolute(filePath) || !root ? filePath : path.join(root, filePath);

    // When in editor panel mode (separate window), use the CLI to open in the main window
    if (this.hostType === 'editor') {
      await this.openFileViaCli(resolved, line);
      return;
    }

    // In sidebar mode, use the normal API
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

  private async openFileViaCli(filePath: string, line: number): Promise<void> {
    // Try using vscode:// URI scheme first - this should route to the window
    // that has the workspace containing this file
    const vscodeUri = vscode.Uri.parse(
      `vscode://file${filePath}:${line}:1`
    );

    try {
      await vscode.env.openExternal(vscodeUri);
    } catch (error) {
      // Fallback to CLI approach
      console.warn('[FlowRider] vscode:// URI failed, trying CLI:', error);
      await this.openFileViaCliCommand(filePath, line);
    }
  }

  private async openFileViaCliCommand(filePath: string, line: number): Promise<void> {
    // Get the path to the code CLI
    const codePath = process.env.VSCODE_CLI_PATH || 'code';

    // Use -r (--reuse-window) to open in an existing window, -g for goto line
    const command = `"${codePath}" -r -g "${filePath}:${line}"`;

    return new Promise((resolve) => {
      exec(command, (error) => {
        if (error) {
          // Fallback to normal API if CLI fails
          console.warn('[FlowRider] CLI open failed, falling back to API:', error.message);
          vscode.workspace.openTextDocument(vscode.Uri.file(filePath)).then(doc => {
            vscode.window.showTextDocument(doc).then(editor => {
              const position = new vscode.Position(line - 1, 0);
              editor.selection = new vscode.Selection(position, position);
              editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
              );
              resolve();
            });
          });
        } else {
          resolve();
        }
      });
    });
  }

  getHtml(webview: vscode.Webview): string {
    if (this.isDev) {
      return this.getDevHtml();
    }
    return this.getProdHtml(webview);
  }

  private getDevHtml(): string {
    const csp = `
      default-src 'none';
      frame-src 'self';
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
      frame-src 'self';
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
