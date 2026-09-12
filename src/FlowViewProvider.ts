import * as vscode from 'vscode';
import { WebviewMessage } from './types';
import { FlowWebviewManager, WebviewHost } from './webviewUtils';

export class FlowViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'flowrider.flowsView';

  private view?: vscode.WebviewView;
  private host?: SidebarHost;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: FlowWebviewManager
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };

    webviewView.webview.html = this.manager.getHtml(webviewView.webview);

    if (this.manager.isDev) {
      this.setupDevModeFileWatcher(webviewView);
    }

    this.host = new SidebarHost(webviewView);

    webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.manager.handleMessage(message, this.host)
    );

    // When sidebar becomes visible, make it the active host (if no editor panel is open)
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this.manager.getActiveHostType() !== 'editor') {
        this.activate();
      }
    });

    webviewView.onDidDispose(() => {
      this.manager.clearHostIfMatches('sidebar');
      this.view = undefined;
      this.host = undefined;
    });

    // Set as active host if no editor panel is currently active
    if (this.manager.getActiveHostType() !== 'editor') {
      this.activate();
    }
  }

  activate(): void {
    if (this.host) {
      this.manager.setActiveHost(this.host, 'sidebar');
      this.manager.pushFlows();
    }
  }

  reveal(): void {
    if (this.view) {
      this.view.show?.(true);
    }
  }

  isVisible(): boolean {
    return this.view?.visible ?? false;
  }

  private setupDevModeFileWatcher(webviewView: vscode.WebviewView) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.joinPath(this.context.extensionUri, 'out'),
        '**/*.js'
      )
    );

    const reload = () => {
      webviewView.webview.html = this.manager.getHtml(webviewView.webview);
      this.manager.pushFlows();
    };

    watcher.onDidChange(reload);
    webviewView.onDidDispose(() => watcher.dispose());
  }
}

class SidebarHost implements WebviewHost {
  constructor(private readonly view: vscode.WebviewView) {}

  postMessage(message: unknown): void {
    this.view.webview.postMessage(message);
  }
}
