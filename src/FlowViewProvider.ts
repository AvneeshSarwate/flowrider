import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExtensionMessage, FlowGraph, MalformedComment, WebviewMessage } from './types';

export class FlowViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'flowrider.flowsView';

  private view?: vscode.WebviewView;
  private flows: FlowGraph[] = [];
  private malformed: MalformedComment[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      console.log('FlowViewProvider received message:', message);
      if (message.type === 'openLocation') {
        console.log('Opening file:', message.filePath, 'at line:', message.lineNumber);
        await this.openFileAtLine(message.filePath, message.lineNumber);
      }

      if (message.type === 'requestFlows') {
        this.pushFlows();
      }
    });

    this.pushFlows();
  }

  update(flows: FlowGraph[], malformed: MalformedComment[]): void {
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
      flows: this.flows,
      malformed: this.malformed,
    };

    this.view.webview.postMessage(payload);
  }

  private async openFileAtLine(filePath: string, line: number) {
    const uri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const position = new vscode.Position(line - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter
    );
  }

  private getHtml(webview: vscode.Webview): string {
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
