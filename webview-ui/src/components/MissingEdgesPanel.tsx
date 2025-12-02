import { useState } from 'react';
import type { MissingEdge, MissingEdgeCandidates, MatchCandidate } from '../types';
import CodeViewer from './CodeViewer';

interface Props {
  flowName: string;
  missing: MissingEdge[];
  missingCandidates: Map<string, MissingEdgeCandidates>;
  onOpenLocation: (filePath: string, line: number) => void;
  onFindCandidates: (edge: MissingEdge) => void;
  onInsertComment: (edge: MissingEdge) => void;
  onInsertAtCandidate: (edge: MissingEdge, line: number) => void;
}

interface MissingEdgeItemProps {
  flowName: string;
  edge: MissingEdge;
  candidates?: MatchCandidate[];
  onOpenLocation: (filePath: string, line: number) => void;
  onFindCandidates: (edge: MissingEdge) => void;
  onInsertComment: (edge: MissingEdge) => void;
  onInsertAtCandidate: (edge: MissingEdge, line: number) => void;
}

const MissingEdgeItem: React.FC<MissingEdgeItemProps> = ({
  edge,
  candidates,
  onOpenLocation,
  onFindCandidates,
  onInsertComment,
  onInsertAtCandidate,
}) => {
  const [open, setOpen] = useState(false);

  const contextCode = [
    ...edge.dbLocation.contextBefore,
    edge.dbLocation.contextLine,
    ...edge.dbLocation.contextAfter,
  ].join('\n');

  // Find the index of the context line within the snippet
  const highlightLine = edge.dbLocation.contextBefore.length;

  return (
    <div className="missing-edge-item">
      <button className="missing-edge-toggle" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'}</span>
        <span className="missing-edge-label">
          {edge.currentNode} → {edge.nextNode}
        </span>
        <span className="missing-edge-file">
          {edge.dbLocation.filePath}:{edge.dbLocation.lineNumber}
        </span>
      </button>
      {open && (
        <div className="missing-edge-details">
          <div className="missing-edge-context">
            <div className="context-label">DB Context (where it was):</div>
            <CodeViewer
              code={contextCode}
              filePath={edge.dbLocation.filePath}
              highlightLine={highlightLine}
            />
          </div>
          <div className="missing-edge-raw">
            <div className="context-label">Comment to insert:</div>
            <pre className="context-block mono">{edge.rawComment}</pre>
          </div>
          <div className="missing-edge-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => onOpenLocation(edge.dbLocation.filePath, edge.dbLocation.lineNumber)}
            >
              Open DB Location
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => onInsertComment(edge)}
            >
              Insert at DB Line
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => onFindCandidates(edge)}
            >
              Find Candidates
            </button>
          </div>

          {candidates && candidates.length > 0 && (
            <div className="candidates-section">
              <div className="context-label">
                Candidate locations ({candidates.length}):
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
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => onInsertAtCandidate(edge, c.line)}
                      >
                        Insert Here
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

const MissingEdgesPanel: React.FC<Props> = ({
  flowName,
  missing,
  missingCandidates,
  onOpenLocation,
  onFindCandidates,
  onInsertComment,
  onInsertAtCandidate,
}) => {
  if (missing.length === 0) {
    return null;
  }

  return (
    <div className="panel warning">
      <div className="panel-head">
        <span>Missing edges ({missing.length})</span>
      </div>
      <div className="panel-body missing-edges-list">
        {missing.map((edge) => {
          const edgeKey = `${edge.currentNode}|${edge.nextNode}`;
          const cacheKey = `${flowName}|${edgeKey}`;
          const candidateData = missingCandidates.get(cacheKey);
          return (
            <MissingEdgeItem
              key={edgeKey}
              flowName={flowName}
              edge={edge}
              candidates={candidateData?.candidates}
              onOpenLocation={onOpenLocation}
              onFindCandidates={onFindCandidates}
              onInsertComment={onInsertComment}
              onInsertAtCandidate={onInsertAtCandidate}
            />
          );
        })}
      </div>
    </div>
  );
};

export default MissingEdgesPanel;
