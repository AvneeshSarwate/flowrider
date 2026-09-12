import vscode from '../vscode';
import { useState } from 'react';

export interface ReviewFile { path: string; status: string; basePath?: string }
interface Folder { folders: Map<string, Folder>; files: ReviewFile[] }
const folder = (): Folder => ({ folders: new Map(), files: [] });
const statuses: Record<string, string> = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed' };

export default function ReviewFileTree({ files }: { files: ReviewFile[] }) {
  const [expanded, setExpanded] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState('');
  const matching = files.filter(file => file.path.toLowerCase().includes(filter.toLowerCase()));
  const expandAll = (value: boolean) => { setExpanded(value); setOverrides({}); };
  const root = folder();
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
        }}>{name}</summary>
        <div className="review-tree-children">{render(child, prefix + name + '/')}</div>
      </details>)}
    {node.files.map(file => <button className="review-file" key={file.path}
      aria-pressed={selected === file.path}
      title={`${statuses[file.status] ?? file.status}: ${file.basePath ? file.basePath + ' → ' : ''}${file.path}`}
      onClick={() => { setSelected(file.path); vscode?.postMessage({ type: 'openReviewFile', filePath: file.path }); }}>
      <span>{file.path.split('/').pop()}</span><span className={`file-status status-${file.status}`} aria-label={statuses[file.status] ?? file.status}>{file.status}</span>
    </button>)}
  </>;
  return <section className="review-tree" aria-label="Changed files">
    <div className="review-tree-title">Changed files <span>{files.length}</span>
      <div className="review-actions tree-actions">
        <button title="Expand all folders" aria-label="Expand all folders" onClick={() => expandAll(true)}>Expand all</button>
        <button title="Collapse all folders" aria-label="Collapse all folders" onClick={() => expandAll(false)}>Collapse all</button>
      </div>
    </div>
    <input className="review-file-filter" aria-label="Filter changed files" placeholder="Filter files…" value={filter}
      onChange={event => { setFilter(event.target.value); expandAll(true); }} />
    <div className="review-tree-scroll" tabIndex={0} aria-label="Changed file list">
      {matching.length ? render(root) : <p className="review-label">{files.length ? 'No matching files.' : 'No changed files in this comparison.'}</p>}
    </div>
  </section>;
}
