import type { DuplicateEdge } from '../types';

interface Props {
  duplicates: DuplicateEdge[];
  onOpenLocation: (filePath: string, line: number) => void;
}

const DuplicatesPanel: React.FC<Props> = ({ duplicates, onOpenLocation }) => {
  if (duplicates.length === 0) {
    return null;
  }

  return (
    <div className="panel warning">
      <div className="panel-head">
        <span>Duplicate edges ({duplicates.length})</span>
      </div>
      <div className="panel-body">
        {duplicates.map((dup) => {
          const key = `${dup.currentNode}|${dup.nextNode}`;
          return (
            <div className="issue-card" key={key}>
              <div className="issue-title">
                {dup.currentNode} → {dup.nextNode}
              </div>
              <div className="issue-sub">
                {dup.locations.length} occurrences — remove duplicates to sync
              </div>
              <div className="candidate-list">
                {dup.locations.map((loc) => (
                  <div className="candidate-row" key={`${key}:${loc.filePath}:${loc.lineNumber}`}>
                    <div className="candidate-meta">
                      {loc.filePath}:{loc.lineNumber}
                    </div>
                    <div className="candidate-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => onOpenLocation(loc.filePath, loc.lineNumber)}
                      >
                        Open
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DuplicatesPanel;
