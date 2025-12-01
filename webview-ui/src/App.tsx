import { useEffect } from 'react';
import FlowList from './components/FlowList';
import NodePopup from './components/NodePopup';
import { useFlowStore } from './store';
import type { ExtensionMessage } from './types';
import vscode from './vscode';
import './App.css';

const toFilename = (filePath: string) => filePath.split(/[\\/]/).pop() ?? filePath;

function App() {
  const flows = useFlowStore((state) => state.flows);
  const malformed = useFlowStore((state) => state.malformed);
  const setHydrated = useFlowStore((state) => state.setHydrated);
  const selectedNode = useFlowStore((state) => state.selectedNode);
  const setFlows = useFlowStore((state) => state.setFlows);
  const clearSelection = useFlowStore((state) => state.clearSelection);

  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      if (message?.type === 'flowsUpdated') {
        setFlows(message.flows, message.malformed ?? []);
      }
      if (message?.type === 'hydratedFlow') {
        setHydrated(message.flowName, message.hydrated);
      }
    };

    window.addEventListener('message', handler);
    vscode?.postMessage({ type: 'requestFlows' });

    return () => {
      window.removeEventListener('message', handler);
    };
  }, [setFlows]);

  const handleOpenLocation = (filePath: string, lineNumber: number) => {
    console.log('handleOpenLocation', filePath, lineNumber);
    vscode?.postMessage({ type: 'openLocation', filePath, lineNumber });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="title-block">
          <div className="title">Flow Rider</div>
          <div className="subtitle">Flow comments → Mermaid DAGs</div>
        </div>
        <button
          className="ghost-button"
          title="Request latest flows"
          onClick={() => vscode?.postMessage({ type: 'requestFlows' })}
        >
          ↻
        </button>
      </header>

      {flows.length === 0 && malformed.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No flow comments found</div>
          <div className="empty-body">
            Add comments like <code>#@#@#@ auth-flow : validate =&gt; authorize</code> and hit
            save to see them here.
          </div>
        </div>
      ) : (
        <FlowList flows={flows} />
      )}

      {malformed.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <span>Parsing errors ({malformed.length})</span>
          </div>
          <div className="malformed-list">
            {malformed.map((item) => (
              <button
                key={`${item.filePath}:${item.lineNumber}:${item.rawText}`}
                className="malformed-item"
                onClick={() => handleOpenLocation(item.filePath, item.lineNumber)}
              >
                <span className="path">
                  {toFilename(item.filePath)}:{item.lineNumber}
                </span>
                <span className="reason">{item.reason}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <NodePopup
        flows={flows}
        selection={selectedNode}
        onClose={clearSelection}
        onOpenLocation={handleOpenLocation}
      />
    </div>
  );
}

export default App;
