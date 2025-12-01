import * as vscode from 'vscode';

const DEFAULT_TAG = '#@#@#@';
const CONFIG_SECTION = 'flowrider';

export function getFlowTag(): string {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>('tag', DEFAULT_TAG);
}

export function getDebounceMs(): number {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>('debounceMs', 100);
}
