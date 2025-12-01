import type { FlowGraph } from '../types';
import { useFlowStore } from '../store';
import FlowDiagram from './FlowDiagram';

interface Props {
  flows: FlowGraph[];
}

const FlowList: React.FC<Props> = ({ flows }) => {
  const expanded = useFlowStore((state) => state.expandedFlows);
  const toggleFlow = useFlowStore((state) => state.toggleFlow);
  const selectNode = useFlowStore((state) => state.selectNode);

  if (flows.length === 0) {
    return null;
  }

  return (
    <div className="flow-list">
      {flows.map((flow) => {
        const isOpen = expanded.has(flow.name);
        return (
          <div className="flow-card" key={flow.name}>
            <button className="flow-header" onClick={() => toggleFlow(flow.name)}>
              <div className="flow-meta">
                <div className="flow-name">{flow.name}</div>
                <div className="flow-subtitle">
                  {flow.nodes.length} nodes · {flow.edges.length} edges
                </div>
              </div>
              <div className="chevron" aria-hidden>
                {isOpen ? '▾' : '▸'}
              </div>
            </button>
            {isOpen && (
              <div className="flow-body">
                <FlowDiagram
                  flow={flow}
                  onNodeClick={(nodeName) => selectNode({ flowName: flow.name, nodeName })}
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
