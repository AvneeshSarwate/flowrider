import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import vscode from '../vscode';
import ReviewFileTree, { type ReviewFile } from './ReviewFileTree';
import { attachCanvasNavigation, type CanvasNavigation } from '../canvasNavigation';
import { attachEmbeddedDiagrams } from '../embeddedDiagrams';

export default function DiffReview() {
  const frame = useRef<HTMLIFrameElement>(null);
  const navigation = useRef<CanvasNavigation | null>(null);
  const disposeEmbedded = useRef<(() => void) | null>(null);
  const [mode, setMode] = useState('document');
  const [zoom, setZoom] = useState(1);
  useEffect(() => () => { navigation.current?.dispose(); disposeEmbedded.current?.(); }, []);
  const split = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(55);
  const [dragging, setDragging] = useState(false);
  const resize = (value: number) => setRatio(Math.max(15, Math.min(85, value)));
  const [html, setHtml] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [revealFile, setRevealFile] = useState<{ path: string } | null>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      // VS Code masks window.parent, so it cannot identify the host sender.
      // Reject the imported child frame explicitly instead.
      if (frame.current && event.source === frame.current.contentWindow) return;
      const message = event.data;
      if (message?.type === 'reviewUpdated') {
        setHtml(message.html ?? ''); setError('');
        setFiles(message.files ?? []);
        setRevealFile(null);
        const m = message.metadata;
        setMode(m?.mode ?? 'document');
        setLabel(m ? `${m.title ?? 'Review'} · ${m.base.slice(0, 8)} → ${m.head.slice(0, 12)}` : '');
      }
      if (message?.type === 'reviewError') setError(message.error);
    };
    window.addEventListener('message', receive);
    vscode?.postMessage({ type: 'requestReview' });
    return () => window.removeEventListener('message', receive);
  }, []);
  const document = useMemo(() => {
    const clean = DOMPurify.sanitize(html, {
      WHOLE_DOCUMENT: true,
      ADD_URI_SAFE_ATTR: ['href', 'xlink:href'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link'],
    });
    return clean.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none';"><style>body{font-family:system-ui;margin:16px}a{cursor:pointer}</style>`);
  }, [html]);
  return <section className="diff-review">
    <div className="review-actions">
      <button onClick={() => vscode?.postMessage({ type: 'loadReview' })}>Load HTML</button>
      <button disabled={!html} onClick={() => vscode?.postMessage({ type: 'loadReview', reload: true })}>Reload</button>
      {html && mode === 'canvas' && <div className="canvas-controls" role="group" aria-label="Canvas navigation">
        <button aria-label="Zoom out" onClick={() => navigation.current?.zoomBy(1 / 1.2)}>−</button>
        <span aria-label="Canvas zoom">{Math.round(zoom * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => navigation.current?.zoomBy(1.2)}>+</button>
        <button title="Fit diagram (F)" onClick={() => navigation.current?.fit()}>Fit</button>
        <button title="Actual size (0)" onClick={() => navigation.current?.reset()}>100%</button>
      </div>}
    </div>
    {html && mode === 'canvas' && <div className="canvas-hint">Pinch to zoom · Scroll to pan · Space + drag</div>}
    {label && <p className="review-label">{label}</p>}
    {error && <p role="alert">{error}</p>}
    {!html ? <div className="empty-state">Load an HTML diagram with FlowRider review metadata. Click a diagram link to open its right-side line in a diff.</div> :
      <div ref={split} className={`review-split ${dragging ? 'is-dragging' : ''}`}>
      <div className="review-diagram-pane" style={{ flex: `0 0 calc(${ratio}% - 4px)` }}>
      <iframe key={mode} ref={frame} title="Review diagram" sandbox="allow-same-origin" srcDoc={document} onLoad={event => {
        const doc = event.currentTarget.contentDocument;
        navigation.current?.dispose(); navigation.current = null;
        disposeEmbedded.current?.(); disposeEmbedded.current = null;
        if (doc && mode === 'canvas') {
          try { navigation.current = attachCanvasNavigation(doc, setZoom); }
          catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        }
        if (doc && mode === 'document') disposeEmbedded.current = attachEmbeddedDiagrams(doc, setError);
        doc?.addEventListener('click', e => {
          const anchor = (e.target as Element).closest('a');
          const href = anchor?.getAttribute('href') ?? anchor?.getAttribute('xlink:href');
          if (!href) return;
          // Preserve native controls (especially details/summary). Only links
          // need interception to prevent navigation out of the review document.
          e.preventDefault();
          if (href?.startsWith('flowrider://')) {
            try {
              const url = new URL(href);
              const path = url.searchParams.get('path');
              if (url.hostname === 'diff' && path) setRevealFile({ path });
            } catch { /* The extension reports invalid link errors. */ }
            setError(''); vscode?.postMessage({ type: 'openReviewLink', href });
          } else if (href.startsWith('#')) {
            try { doc.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView(); }
            catch { /* Ignore malformed fragment identifiers. */ }
          }
        });
      }} />
      </div>
      <div className="review-splitter" role="separator" aria-label="Resize diagram and file tree" aria-orientation="horizontal"
        aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(ratio)} tabIndex={0}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !split.current) return;
          const bounds = split.current.getBoundingClientRect();
          resize((event.clientY - bounds.top) / bounds.height * 100);
        }}
        onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); }}
        onLostPointerCapture={() => setDragging(false)}
        onDoubleClick={() => setRatio(55)}
        onKeyDown={event => {
          if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            resize(event.key === 'Home' ? 15 : event.key === 'End' ? 85 : ratio + (event.key === 'ArrowUp' ? -5 : 5));
          }
        }} />
      <ReviewFileTree files={files} reveal={revealFile} />
      </div>}
  </section>;
}
