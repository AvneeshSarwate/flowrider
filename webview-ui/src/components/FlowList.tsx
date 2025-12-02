import type { FlowSummary } from '../types';
import { useFlowStore } from '../store';
import FlowDiagram from './FlowDiagram';
import vscode from '../vscode';
import DuplicatesPanel from './DuplicatesPanel';
import MovedNodesPanel from './MovedNodesPanel';
import MissingEdgesPanel from './MissingEdgesPanel';

interface Props {
  flows: FlowSummary[];
}

const FlowList: React.FC<Props> = ({ flows }) => {
  const expanded = useFlowStore((state) => state.expandedFlows);
  const toggleFlow = useFlowStore((state) => state.toggleFlow);
  const selectNode = useFlowStore((state) => state.selectNode);
  const missingCandidates = useFlowStore((state) => state.missingCandidates);
  const movedCandidates = useFlowStore((state) => state.movedCandidates);

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
                  flowName={flow.name}
                  moved={flow.moved}
                  movedCandidates={movedCandidates}
                  onOpenLocation={(filePath, line) =>
                    vscode?.postMessage({ type: 'openLocation', filePath, lineNumber: line })
                  }
                  onFindCandidates={(edge) => {
                    vscode?.postMessage({
                      type: 'findMovedEdgeCandidates',
                      flowName: flow.name,
                      edge,
                    });
                  }}
                />
                <MissingEdgesPanel
                  flowName={flow.name}
                  missing={flow.missing}
                  missingCandidates={missingCandidates}
                  onOpenLocation={(filePath, line) =>
                    vscode?.postMessage({ type: 'openLocation', filePath, lineNumber: line })
                  }
                  onFindCandidates={(edge) => {
                    vscode?.postMessage({
                      type: 'findMissingEdgeCandidates',
                      flowName: flow.name,
                      edge,
                    });
                  }}
                  onInsertComment={(edge) => {
                    vscode?.postMessage({
                      type: 'insertMissingComment',
                      flowName: flow.name,
                      edge,
                    });
                  }}
                  onInsertAtCandidate={(edge, line) => {
                    vscode?.postMessage({
                      type: 'insertAtCandidate',
                      flowName: flow.name,
                      edge,
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
