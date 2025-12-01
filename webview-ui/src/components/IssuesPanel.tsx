import { useState } from 'react';
import type { FlowSummary, HydratedFlow, HydratedAnnotation } from '../types';

interface Props {
  flow: FlowSummary;
  hydrated?: HydratedFlow;
  onOpenLocation: (filePath: string, line: number) => void;
  onAddComment: (annotationId: string, line: number) => void;
  onResolve: (annotationId: string, line: number) => void;
}

const Collapse: React.FC<{ title: string }> = ({ title, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="collapse">
      <button className="collapse-toggle" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {title}
      </button>
      {open && <div className="collapse-body">{children}</div>}
    </div>
  );
};

function renderMoreInfo(annotation: HydratedAnnotation) {
  return (
    <Collapse title="More info">
      <div className="mono">commit: {annotation.annotation.commitHash}</div>
      <pre className="context-block">
        {[...annotation.annotation.contextBefore, annotation.annotation.contextLine, ...annotation.annotation.contextAfter].join('\n')}
      </pre>
    </Collapse>
  );
}

function CandidatesList({
  items,
  onOpenLocation,
  onAddComment,
  onResolve,
}: {
  items: HydratedAnnotation[];
  onOpenLocation: (filePath: string, line: number) => void;
  onAddComment: (annotationId: string, line: number) => void;
  onResolve: (annotationId: string, line: number) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="panel">
      <div className="panel-head">
        <span>Potentially moved comments</span>
      </div>
      <div className="panel-body">
        {items.map((ann) => {
          if (ann.resolution.kind !== 'candidates') return null;
          return (
            <div className="issue-card" key={ann.annotation.id}>
              <div className="issue-title">
                {ann.annotation.currentNode} → {ann.annotation.nextNode}
              </div>
              <div className="issue-sub">
                {ann.annotation.filePath} — {ann.resolution.candidates.length} candidate
                {ann.resolution.candidates.length > 1 ? 's' : ''}
              </div>
              <div className="candidate-list">
                {ann.resolution.candidates.map((c) => (
                  <div className="candidate-row" key={`${ann.annotation.id}:${c.line}`}>
                    <div className="candidate-meta">
                      line {c.line} · score {(c.score * 100).toFixed(0)}% · {c.source}
                    </div>
                    <div className="candidate-actions">
                      <button
                        className="ghost-button"
                        onClick={() => onOpenLocation(ann.annotation.filePath, c.line)}
                      >
                        Open
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => onAddComment(ann.annotation.id, c.line)}
                      >
                        Add comment
                      </button>
                      <button
                        className="ghost-button danger"
                        onClick={() => {
                          const ok = window.confirm('Mark this candidate as resolved?');
                          if (ok) onResolve(ann.annotation.id, c.line);
                        }}
                      >
                        Resolve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {renderMoreInfo(ann)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeletedList({ items }: { items: HydratedAnnotation[] }) {
  if (items.length === 0) return null;
  return (
    <div className="panel">
      <div className="panel-head">
        <span>Deleted / Unmapped comments</span>
      </div>
      <div className="panel-body">
        {items.map((ann) => (
          <div className="issue-card" key={ann.annotation.id}>
            <div className="issue-title">
              {ann.annotation.currentNode} → {ann.annotation.nextNode}
            </div>
            <div className="issue-sub">{ann.annotation.filePath}</div>
            <pre className="context-block">{ann.annotation.rawComment}</pre>
            {renderMoreInfo(ann)}
          </div>
        ))}
      </div>
    </div>
  );
}

const IssuesPanel: React.FC<Props> = ({
  flow,
  hydrated,
  onOpenLocation,
  onAddComment,
  onResolve,
}) => {
  if (!hydrated) {
    return (
      <div className="panel info">
        <div className="panel-head">Issues</div>
        <div className="panel-body">Click “Hydrate” above to compute remapping issues.</div>
      </div>
    );
  }

  const candidates = hydrated.annotations.filter((a) => a.resolution.kind === 'candidates');
  const deleted = hydrated.annotations.filter((a) => a.resolution.kind === 'unmapped');

  if (candidates.length === 0 && deleted.length === 0) {
    return (
      <div className="panel success">
        <div className="panel-head">Issues</div>
        <div className="panel-body">No outstanding issues for this flow.</div>
      </div>
    );
  }

  return (
    <div className="issues-stack">
      <CandidatesList
        items={candidates}
        onOpenLocation={onOpenLocation}
        onAddComment={onAddComment}
        onResolve={onResolve}
      />
      <DeletedList items={deleted} />
    </div>
  );
};

export default IssuesPanel;
