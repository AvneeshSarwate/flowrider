import { useState } from 'react';
import type { MovedEdge } from '../types';

interface Props {
  moved: MovedEdge[];
  onOpenLocation: (filePath: string, line: number) => void;
}

interface MovedEdgeItemProps {
  edge: MovedEdge;
  onOpenLocation: (filePath: string, line: number) => void;
}

const MovedEdgeItem: React.FC<MovedEdgeItemProps> = ({ edge, onOpenLocation }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="moved-edge-item">
      <button className="moved-edge-toggle" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'}</span>
        <span className="moved-edge-label">
          {edge.currentNode} → {edge.nextNode}
        </span>
      </button>
      {open && (
        <div className="moved-edge-details">
          <div className="candidate-row">
            <div className="candidate-meta">
              <strong>DB:</strong> {edge.dbLocation.filePath}:{edge.dbLocation.lineNumber}
            </div>
            <div className="candidate-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => onOpenLocation(edge.dbLocation.filePath, edge.dbLocation.lineNumber)}
              >
                Open
              </button>
            </div>
          </div>
          <div className="candidate-row">
            <div className="candidate-meta">
              <strong>Source:</strong> {edge.sourceLocation.filePath}:{edge.sourceLocation.lineNumber}
            </div>
            <div className="candidate-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => onOpenLocation(edge.sourceLocation.filePath, edge.sourceLocation.lineNumber)}
              >
                Open
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MovedNodesPanel: React.FC<Props> = ({ moved, onOpenLocation }) => {
  if (moved.length === 0) {
    return null;
  }

  return (
    <div className="panel info">
      <div className="panel-head">
        <span>Moved edges ({moved.length})</span>
      </div>
      <div className="panel-body moved-edges-list">
        {moved.map((edge) => {
          const key = `${edge.currentNode}|${edge.nextNode}`;
          return <MovedEdgeItem key={key} edge={edge} onOpenLocation={onOpenLocation} />;
        })}
      </div>
    </div>
  );
};

export default MovedNodesPanel;
