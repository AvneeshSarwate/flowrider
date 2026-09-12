import * as vscode from 'vscode';
import { WebviewMessage } from './types';
import { FlowWebviewManager, WebviewHost } from './webviewUtils';

export class FlowEditorPanel implements WebviewHost {
  public static readonly viewType = 'flowrider.editorPanel';

  private readonly panel: vscode.WebviewPanel;
  private disposed = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly manager: FlowWebviewManager,
    context: vscode.ExtensionContext
  ) {
    this.panel = panel;

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    };

    panel.webview.html = manager.getHtml(panel.webview);

    panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => manager.handleMessage(message, this),
      null,
      context.subscriptions
    );

    panel.onDidDispose(
      () => this.dispose(),
      null,
      context.subscriptions
    );

    // Set as active host
    manager.setActiveHost(this, 'editor');
    manager.pushFlows();
  }

  public static create(
    manager: FlowWebviewManager,
    context: vscode.ExtensionContext
  ): FlowEditorPanel {
    const panel = vscode.window.createWebviewPanel(
      FlowEditorPanel.viewType,
      'Flow Rider',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    return new FlowEditorPanel(panel, manager, context);
  }

  public postMessage(message: unknown): void {
    if (!this.disposed) {
      this.panel.webview.postMessage(message);
    }
  }

  public reveal(): void {
    if (!this.disposed) {
      this.panel.reveal();
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.manager.clearHostIfMatches('editor');
    this.panel.dispose();
  }

  public isDisposed(): boolean {
    return this.disposed;
  }
}
