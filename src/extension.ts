import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { FlowViewProvider } from './FlowViewProvider';
import { getContextLineCount, getDebounceMs, getFlowTag } from './config';
import { exportFlows } from './exporter';
import { computeFlowSummaries } from './flowState';
import { FlowStore } from './flowStore';
import { insertSingleComment } from './hydrateWriter';
import { RemapEngine } from './remapper';
import { MissingEdge, MissingEdgeCandidates, MovedEdge, MovedEdgeCandidates } from './types';

export async function activate(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('FlowRider needs an open workspace folder.');
    return;
  }

  // Generate a unique session ID for this activation - used to invalidate
  // persisted webview state on VS Code restart
  const sessionId = crypto.randomUUID();

  const workspaceFolder = workspaceFolders[0]; // monorepo v0
  const store = new FlowStore(workspaceFolder);
  const remapEngine = new RemapEngine(workspaceFolder.uri.fsPath);
  const viewProvider = new FlowViewProvider(context, sessionId);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(FlowViewProvider.viewId, viewProvider)
  );

  let debounceHandle: NodeJS.Timeout | undefined;
  let lastScanError: string | undefined;

  const runScan = async () => {
    const tag = getFlowTag();
    const contextLines = getContextLineCount();
    try {
      await store.load();
      const scan = await import('./flowParser.js').then((m) => m.scanWorkspace(tag, contextLines));
      const summaries = computeFlowSummaries(store.getAllFlows(), scan.parsed);
      viewProvider.update(summaries, scan.malformed);
      lastScanError = undefined;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error while scanning flows';
      console.error('[FlowRider] scan failed', error);
      if (message !== lastScanError) {
        vscode.window.showErrorMessage(`FlowRider failed to scan: ${message}`);
        lastScanError = message;
      }
    }
  };

  const runExport = async (showToast = false, targetFlows?: Set<string>) => {
    const tag = getFlowTag();
    const contextLines = getContextLineCount();
    try {
      const result = await exportFlows(store, tag, contextLines, targetFlows);
      const summaries = computeFlowSummaries(result.flows, result.parsed);
      viewProvider.update(summaries, store.getMalformed());
      lastScanError = undefined;
      if (showToast) {
        vscode.window.showInformationMessage('FlowRider flows exported to DB.');
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error while exporting flows';
      console.error('[FlowRider] export failed', error);
      if (message !== lastScanError) {
        vscode.window.showErrorMessage(
          `FlowRider failed to export flows: ${message}`
        );
        lastScanError = message;
      }
    }
  };

  const scheduleExport = () => {
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
      scheduleExport();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flowrider.refreshFlows', async () => {
      await runScan();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flowrider.writeFlowToDb', async (flowName?: string) => {
      if (!flowName) {
        flowName = await vscode.window.showInputBox({ prompt: 'Flow name to export to DB' });
      }
      if (!flowName) return;
      const target = new Set<string>([flowName]);
      await runExport(true, target);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'flowrider.insertMissingComment',
      async (flowName: string, edge: MissingEdge) => {
        const absPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!absPath) return;

        // Create a minimal annotation-like object for insertSingleComment
        const annotation = {
          id: '',
          filePath: edge.dbLocation.filePath,
          flowName,
          currentNode: edge.currentNode,
          nextNode: edge.nextNode,
          rawComment: edge.rawComment,
          contextBefore: edge.dbLocation.contextBefore,
          contextLine: edge.dbLocation.contextLine,
          contextAfter: edge.dbLocation.contextAfter,
          commitHash: '',
        };

        const success = await insertSingleComment(absPath, annotation as import('./types').Annotation, edge.dbLocation.lineNumber);
        if (!success) {
          vscode.window.showWarningMessage(
            `Could not insert missing comment for ${flowName}. Check file path/permissions.`
          );
          return;
        }
        vscode.window.showInformationMessage(
          `Inserted missing edge: ${edge.currentNode} → ${edge.nextNode}`
        );
        await runScan();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'flowrider.findMissingEdgeCandidates',
      async (flowName: string, edge: MissingEdge) => {
        const candidates = await remapEngine.findCandidatesForMissingEdge(
          edge.dbLocation.filePath,
          edge.dbLocation.contextBefore,
          edge.dbLocation.contextLine,
          edge.dbLocation.contextAfter
        );

        const edgeKey = `${edge.currentNode}|${edge.nextNode}`;
        const data: MissingEdgeCandidates = {
          flowName,
          edgeKey,
          candidates,
        };
        viewProvider.pushMissingCandidates(data);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'flowrider.insertAtCandidate',
      async (flowName: string, edge: MissingEdge, line: number) => {
        const absPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!absPath) return;

        const annotation = {
          id: '',
          filePath: edge.dbLocation.filePath,
          flowName,
          currentNode: edge.currentNode,
          nextNode: edge.nextNode,
          rawComment: edge.rawComment,
          contextBefore: edge.dbLocation.contextBefore,
          contextLine: edge.dbLocation.contextLine,
          contextAfter: edge.dbLocation.contextAfter,
          commitHash: '',
        };

        const success = await insertSingleComment(absPath, annotation as import('./types').Annotation, line);
        if (!success) {
          vscode.window.showWarningMessage(
            `Could not insert comment at line ${line}. Check file path/permissions.`
          );
          return;
        }
        vscode.window.showInformationMessage(
          `Inserted edge at line ${line}: ${edge.currentNode} → ${edge.nextNode}`
        );
        await runScan();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'flowrider.findMovedEdgeCandidates',
      async (flowName: string, edge: MovedEdge) => {
        const candidates = await remapEngine.findCandidatesForMissingEdge(
          edge.dbLocation.filePath,
          edge.dbLocation.contextBefore,
          edge.dbLocation.contextLine,
          edge.dbLocation.contextAfter
        );

        const edgeKey = `${edge.currentNode}|${edge.nextNode}`;
        const data: MovedEdgeCandidates = {
          flowName,
          edgeKey,
          candidates,
        };
        viewProvider.pushMovedCandidates(data);
      }
    )
  );

  await runScan();
}

export function deactivate() {
  // FlowHydrator disposed via subscription
}
