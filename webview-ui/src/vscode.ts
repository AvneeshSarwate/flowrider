declare global {
  interface VSCodeAPI {
    postMessage(message: unknown): void;
    getState<T = unknown>(): T | undefined;
    setState<T = unknown>(data: T): void;
  }

  interface Window {
    acquireVsCodeApi?: () => VSCodeAPI;
  }
}

const vscode: VSCodeAPI | undefined =
  typeof window !== 'undefined' && typeof window.acquireVsCodeApi === 'function'
    ? window.acquireVsCodeApi()
    : undefined;

export default vscode;
