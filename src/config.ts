import * as vscode from 'vscode';

const CONFIG_SECTION = 'flowrider';
const DEFAULT_TAG = '#@#@#@';
const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_DB_PATH = '.codeflows/flows.jsonc';
const DEFAULT_CONTEXT_LINES = 3;

export function getFlowTag(): string {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>('tag', DEFAULT_TAG);
}

export function getDebounceMs(): number {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>('debounceMs', DEFAULT_DEBOUNCE_MS);
}

export function getDbPath(): string {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>('dbPath', DEFAULT_DB_PATH);
}

export function getGlobalDbPath(): string | undefined {
  const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string | null>('globalDbPath');
  return value ?? undefined;
}

export function getContextLineCount(): number {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>('contextLines', DEFAULT_CONTEXT_LINES);
}
