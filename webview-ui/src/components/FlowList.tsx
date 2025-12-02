import type { FlowSummary } from '../types';
import { useFlowStore } from '../store';
import FlowDiagram from './FlowDiagram';
import vscode from '../vscode';
import IssuesPanel from './IssuesPanel';
import DuplicatesPanel from './DuplicatesPanel';
import MovedNodesPanel from './MovedNodesPanel';

interface Props {
  flows: FlowSummary[];
}

const FlowList: React.FC<Props> = ({ flows }) => {
  const expanded = useFlowStore((state) => state.expandedFlows);
  const toggleFlow = useFlowStore((state) => state.toggleFlow);
  const selectNode = useFlowStore((state) => state.selectNode);
  const hydrated = useFlowStore((state) => state.hydrated);

  if (flows.length === 0) {
    return null;
  }

  return (
    <div className="flow-list">
      {flows.map((flow) => {
        const isOpen = expanded.has(flow.name);
        return (
          <div className="flow-card" key={flow.name}>
            <div className="flow-header">
              <button className="flow-header-main" onClick={() => toggleFlow(flow.name)}>
                <div className="flow-meta">
                  <div className="flow-name">
                    {flow.name}
                    <span className={`badge status-${flow.status}`}>{flow.status}</span>
                    {flow.dirty && <span className="badge badge-dirty">unsaved</span>}
                    {flow.declaredCross && <span className="badge badge-cross">cross</span>}
                  </div>
                  <div className="flow-subtitle">
                    {flow.nodes.length} nodes · {flow.edges.length} edges · {flow.present}/
                    {flow.total} loaded{flow.extras > 0 ? ` · ${flow.extras} extra` : ''}
                  </div>
                </div>
                <div className="chevron" aria-hidden>
                  {isOpen ? '▾' : '▸'}
                </div>
              </button>
              <div className="flow-actions">
                <button
                  className="ghost-button"
                  title="Write this flow to DB (export only this flow)"
                  onClick={() => vscode?.postMessage({ type: 'writeFlowToDb', flowName: flow.name })}
                >
                  ⬇︎ DB
                </button>
                <button
                  className="ghost-button"
                  title="Hydrate this flow into source files"
                  onClick={() =>
                    vscode?.postMessage({ type: 'hydrateFlowFromDb', flowName: flow.name })
                  }
                >
                  ⬆︎ Code
                </button>
                <button
                  className="ghost-button"
                  title="Preview/hydrate this flow (compute remap, issues)"
                  onClick={() => vscode?.postMessage({ type: 'requestHydrateFlow', flowName: flow.name })}
                >
                  🔍 Hydrate
                </button>
              </div>
            </div>
            {isOpen && (
              <div className="flow-body">
                <FlowDiagram
                  flow={flow}
                  onNodeClick={(nodeName) => selectNode({ flowName: flow.name, nodeName })}
                />
                <DuplicatesPanel
                  duplicates={flow.duplicates}
                  onOpenLocation={(filePath, line) =>
                    vscode?.postMessage({ type: 'openLocation', filePath, lineNumber: line })
                  }
                />
                <MovedNodesPanel
                  moved={flow.moved}
                  onOpenLocation={(filePath, line) =>
                    vscode?.postMessage({ type: 'openLocation', filePath, lineNumber: line })
                  }
                />
                <IssuesPanel
                  flow={flow}
                  hydrated={hydrated.get(flow.name)}
                  onOpenLocation={(filePath, line) =>
                    vscode?.postMessage({ type: 'openLocation', filePath, lineNumber: line })
                  }
                  onAddComment={(annotationId, line) => {
                    console.log('FlowList addCandidateComment', flow.name, annotationId, line);
                    vscode?.postMessage({
                      type: 'addCandidateComment',
                      flowName: flow.name,
                      annotationId,
                      line,
                    });
                  }}
                  onResolve={(annotationId, line) => {
                    console.log('FlowList resolveCandidate', flow.name, annotationId, line);
                    vscode?.postMessage({
                      type: 'resolveCandidate',
                      flowName: flow.name,
                      annotationId,
                      line,
                    });
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default FlowList;
