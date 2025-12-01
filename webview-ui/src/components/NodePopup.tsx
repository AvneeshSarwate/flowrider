import type { FlowGraph } from '../types';
import type { Selection } from '../store';

interface Props {
  flows: FlowGraph[];
  selection: Selection | null;
  onClose: () => void;
  onOpenLocation: (filePath: string, lineNumber: number) => void;
}

const toFilename = (filePath: string) => filePath.split(/[\\/]/).pop() ?? filePath;

const NodePopup: React.FC<Props> = ({ flows, selection, onClose, onOpenLocation }) => {
  if (!selection) {
    return null;
  }

  const flow = flows.find((f) => f.name === selection.flowName);
  const occurrences = flow
    ? flow.edges.filter((edge) => edge.currentPos === selection.nodeName)
    : [];

  return (
    <div className="popup-backdrop" onClick={onClose}>
      <div className="popup" onClick={(e) => e.stopPropagation()}>
        <header className="popup-head">
          <div>
            <div className="popup-title">{selection.nodeName}</div>
            <div className="popup-subtitle">Flow: {selection.flowName}</div>
          </div>
          <button className="ghost-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="popup-body">
          {occurrences.length === 0 ? (
            <div className="empty-body">No flow comments found for this node.</div>
          ) : (
            <div className="location-list">
              {occurrences.map((edge) => (
                <button
                  key={`${edge.filePath}:${edge.lineNumber}:${edge.nextPos}`}
                  className="location-item"
                  onClick={() => onOpenLocation(edge.filePath, edge.lineNumber)}
                >
                  <div className="location-main">
                    <span className="dot" aria-hidden />
                    <span className="location-name">
                      {toFilename(edge.filePath)}:{edge.lineNumber}
                    </span>
                  </div>
                  <div className="location-sub">{edge.filePath}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NodePopup;
