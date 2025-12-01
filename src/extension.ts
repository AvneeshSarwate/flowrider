import * as vscode from 'vscode';
import { FlowViewProvider } from './FlowViewProvider';
import { getDebounceMs, getFlowTag } from './config';
import { FlowStore } from './flowStore';
import { parseWorkspace } from './flowParser';

export async function activate(context: vscode.ExtensionContext) {
  const store = new FlowStore();
  const viewProvider = new FlowViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(FlowViewProvider.viewId, viewProvider)
  );

  let debounceHandle: NodeJS.Timeout | undefined;
  let lastScanError: string | undefined;

  const runScan = async () => {
    const tag = getFlowTag();
    try {
      const result = await parseWorkspace(tag);
      store.set(result);
      viewProvider.update(result.flows, result.malformed);
      lastScanError = undefined;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error while scanning flows';
      console.error('[FlowRider] scan failed', error);
      if (message !== lastScanError) {
        vscode.window.showErrorMessage(
          `FlowRider failed to scan for flow comments: ${message}`
        );
        lastScanError = message;
      }
    }
  };

  const scheduleScan = () => {
    const debounceMs = getDebounceMs();
    if (debounceHandle) {
      clearTimeout(debounceHandle);
    }
    debounceHandle = setTimeout(() => {
      runScan();
    }, debounceMs);
  };

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      scheduleScan();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flowrider.refreshFlows', async () => {
      await runScan();
      vscode.window.showInformationMessage('Flow Rider flows refreshed.');
    })
  );

  await runScan();
}

export function deactivate() {
  // no-op
}
