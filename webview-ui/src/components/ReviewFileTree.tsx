import vscode from '../vscode';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export interface ReviewFile { path: string; status: string; basePath?: string; additions?: number; deletions?: number; significantAdditions?: number; significantDeletions?: number; binary?: boolean }
interface Folder { folders: Map<string, Folder>; files: ReviewFile[] }
const folder = (): Folder => ({ folders: new Map(), files: [] });
const lineCounts = (additions = 0, deletions = 0) => <span className="review-line-counts" aria-label={`${additions} added lines, ${deletions} removed lines`}>
  <span className="review-lines-added">+{additions}</span><span className="review-lines-removed">−{deletions}</span>
</span>;
const statuses: Record<string, string> = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed' };

export default function ReviewFileTree({ files, reveal }: { files: ReviewFile[]; reveal?: { path: string } | null }) {
  const [expanded, setExpanded] = useState(true);
  const [significant, setSignificant] = useState(false);
  const measuredFiles = files.map(file => significant ? { ...file, additions: file.significantAdditions ?? file.additions, deletions: file.significantDeletions ?? file.deletions } : file);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const selectedRow = useRef<HTMLButtonElement>(null);
  const pendingReveal = useRef(false);
  useEffect(() => {
    if (!reveal || !files.some(file => file.path === reveal.path)) return;
    pendingReveal.current = true;
    setFilter('');
    setSelected(reveal.path);
    const parents: Record<string, boolean> = {};
    const parts = reveal.path.split('/');
    for (let i = 1; i < parts.length; i++) parents[parts.slice(0, i).join('/')] = true;
    setOverrides(old => ({ ...old, ...parents }));
  }, [reveal, files]);
  useLayoutEffect(() => {
    const container = scroller.current, row = selectedRow.current;
    if (!pendingReveal.current || !container || !row || !reveal || selected !== reveal.path) return;
    pendingReveal.current = false;
    const outer = container.getBoundingClientRect(), inner = row.getBoundingClientRect();
    if (inner.top < outer.top || inner.bottom > outer.bottom) {
      container.scrollTop += inner.top - outer.top - (container.clientHeight - row.clientHeight) / 2;
    }
  }, [selected, overrides, filter, reveal]);
  const matching = measuredFiles.filter(file => file.path.toLowerCase().includes(filter.toLowerCase()));
  const expandAll = (value: boolean) => { setExpanded(value); setOverrides({}); };
  const root = folder();
  const totals = new Map<string, { additions: number; deletions: number }>();
  for (const file of measuredFiles) {
    const parts = file.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const key = parts.slice(0, i).join('/');
      const total = totals.get(key) ?? { additions: 0, deletions: 0 };
      total.additions += file.additions ?? 0;
      total.deletions += file.deletions ?? 0;
      totals.set(key, total);
    }
  }
  for (const file of matching) {
    let current = root;
    for (const part of file.path.split('/').slice(0, -1)) {
      if (!current.folders.has(part)) current.folders.set(part, folder());
      current = current.folders.get(part)!;
    }
    current.files.push(file);
  }
  const render = (node: Folder, prefix = '') => <>
    {[...node.folders].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) =>
      <details key={name} open={overrides[prefix + name] ?? expanded}>
        <summary onClick={event => {
          event.preventDefault();
          setOverrides(old => ({ ...old, [prefix + name]: !(old[prefix + name] ?? expanded) }));
        }}>{name}{lineCounts(totals.get(prefix + name)?.additions, totals.get(prefix + name)?.deletions)}</summary>
        <div className="review-tree-children">{render(child, prefix + name + '/')}</div>
      </details>)}
    {node.files.map(file => <button className="review-file" key={file.path}
      ref={selected === file.path ? selectedRow : undefined}
      aria-pressed={selected === file.path}
      title={`${statuses[file.status] ?? file.status}: ${file.basePath ? file.basePath + ' → ' : ''}${file.path}`}
      onClick={() => { setSelected(file.path); vscode?.postMessage({ type: 'openReviewFile', filePath: file.path }); }}>
      <span>{file.path.split('/').pop()}</span>{file.binary ? <span className="review-line-counts">Binary</span> : lineCounts(file.additions, file.deletions)}<span className={`file-status status-${file.status}`} aria-label={statuses[file.status] ?? file.status}>{file.status}</span>
    </button>)}
  </>;
  const countWidth = 1 + [...measuredFiles, ...totals.values()].reduce((width, item) =>
    Math.max(width, String(item.additions ?? 0).length, String(item.deletions ?? 0).length), 1);
  return <section className="review-tree" aria-label="Changed files" style={{ '--review-count-width': `${countWidth}ch` } as CSSProperties}>
    <div className="review-tree-title">Changed files <span>{files.length}</span>
      <div className="review-actions tree-actions">
        <button title="Expand all folders" aria-label="Expand all folders" onClick={() => expandAll(true)}>Expand all</button>
        <button title="Collapse all folders" aria-label="Collapse all folders" onClick={() => expandAll(false)}>Collapse all</button>
        <button aria-label="Show significant LOC" aria-pressed={significant}
          title="Toggle LOC / significant LOC. Significant LOC is approximate: excludes blank lines and common comment-only line patterns for recognized file types."
          onClick={() => setSignificant(value => !value)}>{significant ? 'Significant LOC' : 'LOC'}</button>
      </div>
    </div>
    <input className="review-file-filter" aria-label="Filter changed files" placeholder="Filter files…" value={filter}
      onChange={event => { setFilter(event.target.value); expandAll(true); }} />
    <div ref={scroller} className="review-tree-scroll" tabIndex={0} aria-label="Changed file list">
      {matching.length ? render(root) : <p className="review-label">{files.length ? 'No matching files.' : 'No changed files in this comparison.'}</p>}
    </div>
  </section>;
}
