import * as vscode from 'vscode';
import { FlowViewProvider } from './FlowViewProvider';
import { getContextLineCount, getDebounceMs, getFlowTag } from './config';
import { exportFlows } from './exporter';
import { computeFlowSummaries } from './flowState';
import { FlowHydrator } from './hydrator';
import { FlowStore } from './flowStore';
import { applyFlowToSource, insertSingleComment } from './hydrateWriter';
import { HydratedFlow } from './types';

export async function activate(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('FlowRider needs an open workspace folder.');
    return;
  }

  const workspaceFolder = workspaceFolders[0]; // monorepo v0
  const store = new FlowStore(workspaceFolder);
  const hydrator = new FlowHydrator(workspaceFolder.uri.fsPath);
  const viewProvider = new FlowViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(FlowViewProvider.viewId, viewProvider),
    { dispose: () => hydrator.dispose() }
  );

  let debounceHandle: NodeJS.Timeout | undefined;
  let lastScanError: string | undefined;

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
      runExport();
    }, debounceMs);
  };

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      scheduleExport();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flowrider.refreshFlows', async () => {
      await runExport(true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flowrider.hydrateFlow', async () => {
      await store.load();
      const flows = store.getAllFlows();
      if (flows.length === 0) {
        vscode.window.showWarningMessage(
          'No flows found in the DB. Run "FlowRider: Refresh Flows" first.'
        );
        return;
      }
      const pick = await vscode.window.showQuickPick(
        flows.map((flow) => ({
          label: flow.name,
          description: flow.declaredCross ? 'cross' : 'local',
          flowId: flow.id,
        })),
        { placeHolder: 'Select a flow to hydrate' }
      );
      if (!pick) {
        return;
      }
      const flow = flows.find((f) => f.id === pick.flowId);
      if (!flow) {
        return;
      }

      const hydrated = await hydrator.hydrate(flow);
      const auto = hydrated.annotations.filter((a) => a.resolution.kind === 'auto').length;
      const candidates = hydrated.annotations.filter(
        (a) => a.resolution.kind === 'candidates'
      ).length;
      const unmapped = hydrated.annotations.filter(
        (a) => a.resolution.kind === 'unmapped'
      ).length;

      vscode.window.showInformationMessage(
        `Hydrated ${flow.name}: ${auto} auto, ${candidates} candidates, ${unmapped} unmapped`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flowrider.clearHydration', () => {
      hydrator.clear();
      vscode.window.showInformationMessage('FlowRider decorations cleared.');
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
    vscode.commands.registerCommand('flowrider.hydrateFlowByName', async (flowName?: string) => {
      await store.load();
      const flows = store.getAllFlows();
      if (!flowName) {
        const pick = await vscode.window.showQuickPick(
          flows.map((f) => ({ label: f.name, flowId: f.id })),
          { placeHolder: 'Select a flow to hydrate into source files' }
        );
        if (!pick) return;
        flowName = pick.label;
      }
      const flow = flows.find((f) => f.name === flowName);
      if (!flow) {
        vscode.window.showWarningMessage(`Flow ${flowName} not found in DB.`);
        return;
      }

      const filesChanged = await applyFlowToSource(workspaceFolder.uri.fsPath, flow);
      const hydrated = await hydrator.hydrate(flow);
      const auto = hydrated.annotations.filter((a) => a.resolution.kind === 'auto').length;
      vscode.window.showInformationMessage(
        `Hydrated ${flow.name}: wrote to ${filesChanged} file(s), ${auto} decorations placed`
      );

      // Refresh statuses after applying
      await runExport();
    })
  );

  const hydratedCache = new Map<string, HydratedFlow>();

  async function hydrateFlowByName(flowName: string, push = true): Promise<HydratedFlow | undefined> {
    await store.load();
    const flow = store.getAllFlows().find((f) => f.name === flowName);
    if (!flow) {
      vscode.window.showWarningMessage(`Flow ${flowName} not found in DB.`);
      return undefined;
    }
    const hydrated = await hydrator.hydrate(flow);
    hydratedCache.set(flowName, hydrated);
    if (push) {
      viewProvider.pushHydrated(flowName, hydrated);
    }
    return hydrated;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('flowrider.previewHydrateFlow', async (flowName?: string) => {
      if (!flowName) return;
      await hydrateFlowByName(flowName, true);
    })
  );

  async function rehydrateAndPush(flowName: string) {
    await hydrateFlowByName(flowName, true);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'flowrider.resolveCandidate',
      async (flowName: string, annotationId: string, line: number) => {
        await store.load();
        const cached = hydratedCache.get(flowName);
        if (!cached) {
          await hydrateFlowByName(flowName, true);
          return;
        }
        const updated: HydratedFlow = {
          ...cached,
          annotations: cached.annotations.map((ann) => {
            if (ann.annotation.id !== annotationId) return ann;
            if (ann.resolution.kind !== 'candidates') return ann;
            const remaining = ann.resolution.candidates.filter((c) => c.line !== line);
            if (remaining.length === 0) {
              return { ...ann, resolution: { kind: 'unmapped', reason: 'no-match' } };
            }
            return {
              ...ann,
              resolution: { ...ann.resolution, candidates: remaining },
            };
          }),
        };
        hydratedCache.set(flowName, updated);
        viewProvider.pushHydrated(flowName, updated);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'flowrider.addCandidateComment',
      async (flowName: string, annotationId: string, line: number) => {
        await store.load();
        const flow = store.getAllFlows().find((f) => f.name === flowName);
        if (!flow) {
          vscode.window.showWarningMessage(`Flow ${flowName} not found in DB.`);
          return;
        }
        const annotation = flow.annotations.find((a) => a.id === annotationId);
        if (!annotation) {
          vscode.window.showWarningMessage(`Annotation not found.`);
          return;
        }
        const absPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!absPath) return;
        const success = await insertSingleComment(absPath, annotation, line);
        if (success) {
          await rehydrateAndPush(flowName);
        }
      }
    )
  );

  await runExport();
}

export function deactivate() {
  // FlowHydrator disposed via subscription
}
