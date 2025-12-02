import { useState } from 'react';
import type { MovedEdge, MatchCandidate, MovedEdgeCandidates } from '../types';
import CodeViewer from './CodeViewer';

interface Props {
  flowName: string;
  moved: MovedEdge[];
  movedCandidates: Map<string, MovedEdgeCandidates>;
  onOpenLocation: (filePath: string, line: number) => void;
  onFindCandidates: (edge: MovedEdge) => void;
}

interface MovedEdgeItemProps {
  edge: MovedEdge;
  candidates?: MatchCandidate[];
  onOpenLocation: (filePath: string, line: number) => void;
  onFindCandidates: (edge: MovedEdge) => void;
}

const MovedEdgeItem: React.FC<MovedEdgeItemProps> = ({
  edge,
  candidates,
  onOpenLocation,
  onFindCandidates,
}) => {
  const [open, setOpen] = useState(false);
  const [showDbContext, setShowDbContext] = useState(false);

  const contextCode = [
    ...edge.dbLocation.contextBefore,
    edge.dbLocation.contextLine,
    ...edge.dbLocation.contextAfter,
  ].join('\n');

  const highlightLine = edge.dbLocation.contextBefore.length;

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
              <button
                type="button"
                className="ghost-button"
                onClick={() => setShowDbContext(!showDbContext)}
              >
                {showDbContext ? 'Hide' : 'Show'} Context
              </button>
            </div>
          </div>
          {showDbContext && (
            <div className="moved-edge-context">
              <CodeViewer
                code={contextCode}
                filePath={edge.dbLocation.filePath}
                highlightLine={highlightLine}
              />
            </div>
          )}
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
          <div className="moved-edge-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => onFindCandidates(edge)}
            >
              Find Context Candidates
            </button>
          </div>

          {candidates && candidates.length > 0 && (
            <div className="candidates-section">
              <div className="context-label">
                Context candidate locations ({candidates.length}):
              </div>
              <div className="candidate-list">
                {candidates.map((c) => (
                  <div className="candidate-row" key={c.line}>
                    <div className="candidate-meta">
                      line {c.line} · {(c.score * 100).toFixed(0)}% · {c.source}
                    </div>
                    <div className="candidate-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => onOpenLocation(edge.dbLocation.filePath, c.line)}
                      >
                        Open
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {candidates && candidates.length === 0 && (
            <div className="candidates-section">
              <div className="context-label">No candidates found</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const MovedNodesPanel: React.FC<Props> = ({
  flowName,
  moved,
  movedCandidates,
  onOpenLocation,
  onFindCandidates,
}) => {
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
          const edgeKey = `${edge.currentNode}|${edge.nextNode}`;
          const cacheKey = `${flowName}|${edgeKey}`;
          const candidateData = movedCandidates.get(cacheKey);
          return (
            <MovedEdgeItem
              key={edgeKey}
              edge={edge}
              candidates={candidateData?.candidates}
              onOpenLocation={onOpenLocation}
              onFindCandidates={onFindCandidates}
            />
          );
        })}
      </div>
    </div>
  );
};

export default MovedNodesPanel;
