export interface CanvasNavigation {
  fit(): void;
  reset(): void;
  zoomBy(factor: number): void;
  dispose(): void;
}

/** Trusted host code controls a script-free document inside the review iframe. */
export function attachCanvasNavigation(doc: Document, changed: (scale: number) => void,
  embedded?: { svg: SVGSVGElement; viewport: HTMLElement }): CanvasNavigation {
  const roots = embedded ? [embedded.svg] : doc.querySelectorAll('svg[data-flowrider-canvas]');
  if (roots.length !== 1) throw new Error('Canvas mode requires exactly one svg[data-flowrider-canvas] with a positive viewBox.');
  const svg = roots[0] as SVGSVGElement;
  const bounds = svg.viewBox.baseVal;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('Canvas SVG requires a finite viewBox with positive width and height.');
  }
  const win = doc.defaultView!;
  const target = embedded?.viewport ?? doc;
  const size = () => ({ width: embedded?.viewport.clientWidth ?? win.innerWidth, height: embedded?.viewport.clientHeight ?? win.innerHeight });
  const point = (px: number, py: number) => {
    const rect = embedded?.viewport.getBoundingClientRect();
    return { x: px - (rect?.left ?? 0), y: py - (rect?.top ?? 0) };
  };
  const width = bounds.width, height = bounds.height;
  let x = 0, y = 0, scale = 1, fitting = true, space = false, suppressClick = false;
  let gesture = false;
  const pointers = new Map<number, { x: number; y: number }>();
  const cleanup: (() => void)[] = [];
  const listen = (target: EventTarget, name: string, handler: (event: Event) => void, options?: AddEventListenerOptions) => {
    target.addEventListener(name, handler, options);
    cleanup.push(() => target.removeEventListener(name, handler, options));
  };
  if (!embedded) {
    doc.documentElement.style.cssText = 'height:100%;overflow:hidden;overscroll-behavior:none;touch-action:none';
    doc.body.style.cssText = 'margin:0;height:100%;overflow:hidden;overscroll-behavior:none';
  }
  svg.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;max-width:none;max-height:none;transform-origin:0 0;touch-action:none;`;
  if (embedded) svg.style.touchAction = 'pan-y';
  const paint = () => {
    svg.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    svg.style.cursor = space || gesture ? 'grab' : '';
    changed(scale);
  };
  const zoomAt = (next: number, px: number, py: number) => {
    next = Math.max(.02, Math.min(8, next));
    const factor = next / scale;
    x = px - (px - x) * factor;
    y = py - (py - y) * factor;
    scale = next; fitting = false; paint();
  };
  const fit = () => {
    const viewport = size();
    if (!viewport.width || !viewport.height) return;
    scale = Math.max(.02, Math.min(1, (viewport.width - 24) / width, (viewport.height - 24) / height));
    x = (viewport.width - width * scale) / 2;
    y = (viewport.height - height * scale) / 2;
    fitting = true; paint();
  };
  const reset = () => {
    scale = 1; x = (size().width - width) / 2; y = (size().height - height) / 2;
    fitting = false; paint();
  };
  const zoomBy = (factor: number) => zoomAt(scale * factor, size().width / 2, size().height / 2);
  listen(target, 'wheel', raw => {
    const e = raw as WheelEvent;
    if (embedded && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? win.innerHeight : 1;
    const p = point(e.clientX, e.clientY);
    if (e.ctrlKey || e.metaKey) zoomAt(scale * Math.exp(-e.deltaY * unit * .01), p.x, p.y);
    else { x -= e.deltaX * unit; y -= e.deltaY * unit; fitting = false; paint(); }
  }, { passive: false });
  listen(target, 'keydown', raw => {
    const e = raw as KeyboardEvent;
    if (e.code === 'Space') { e.preventDefault(); space = true; paint(); }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.2); }
    if (e.key === '-') { e.preventDefault(); zoomBy(1 / 1.2); }
    if (e.key.toLowerCase() === 'f') { e.preventDefault(); fit(); }
    if (e.key === '0') { e.preventDefault(); reset(); }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault(); fitting = false;
      x += e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0;
      y += e.key === 'ArrowUp' ? 40 : e.key === 'ArrowDown' ? -40 : 0;
      paint();
    }
  });
  listen(doc, 'keyup', raw => { if ((raw as KeyboardEvent).code === 'Space') { space = false; paint(); } });
  listen(win, 'blur', () => { space = false; pointers.clear(); gesture = false; paint(); });
  listen(target, 'pointerdown', raw => {
    const e = raw as PointerEvent;
    if (embedded && e.pointerType !== 'touch') embedded.viewport.focus({ preventScroll: true });
    suppressClick = false;
    if (!(space || e.button === 1 || (!embedded && e.pointerType === 'touch'))) return;
    if (e.pointerType !== 'touch') e.preventDefault();
    pointers.set(e.pointerId, point(e.clientX, e.clientY));
    if (space || e.button === 1) { suppressClick = true; (embedded?.viewport ?? doc.documentElement).setPointerCapture(e.pointerId); }
    gesture = true;
  });
  listen(target, 'pointermove', raw => {
    const e = raw as PointerEvent;
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    e.preventDefault();
    const before = [...pointers.values()];
    const p = point(e.clientX, e.clientY);
    pointers.set(e.pointerId, p);
    const after = [...pointers.values()];
    if (before.length === 2) {
      const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
      const newDistance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
      const oldX = (before[0].x + before[1].x) / 2, oldY = (before[0].y + before[1].y) / 2;
      if (oldDistance > 0) zoomAt(scale * newDistance / oldDistance, oldX, oldY);
      x += (after[0].x + after[1].x) / 2 - oldX;
      y += (after[0].y + after[1].y) / 2 - oldY;
    } else { x += p.x - previous.x; y += p.y - previous.y; }
    if (Math.hypot(p.x - previous.x, p.y - previous.y) > 1 || before.length > 1) suppressClick = true;
    fitting = false; paint();
  }, { passive: false });
  const release = (raw: Event) => {
    const e = raw as PointerEvent;
    pointers.delete(e.pointerId); gesture = pointers.size > 0; paint();
  };
  listen(doc, 'pointerup', release);
  listen(doc, 'pointercancel', release);
  listen(target, 'click', e => { if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); suppressClick = false; } }, { capture: true });
  listen(target, 'auxclick', e => e.preventDefault());
  const observer = new ResizeObserver(() => { if (fitting) fit(); });
  observer.observe(embedded?.viewport ?? doc.documentElement);
  fit();
  return { fit, reset, zoomBy, dispose: () => { observer.disconnect(); cleanup.forEach(remove => remove()); } };
}
