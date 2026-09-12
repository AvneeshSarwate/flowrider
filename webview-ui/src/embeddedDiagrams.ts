import { attachCanvasNavigation } from './canvasNavigation';

/** Wrap only marked SVGs. The document supplies content, never executable controls. */
export function attachEmbeddedDiagrams(doc: Document, reportError: (message: string) => void) {
  const cleanups: (() => void)[] = [];
  doc.querySelectorAll<SVGSVGElement>('svg[data-flowrider-canvas]').forEach((svg, index) => {
    if (svg.parentElement?.closest('svg[data-flowrider-canvas]')) {
      reportError(`Diagram ${index + 1}: marked SVGs must not be nested.`);
      return;
    }
    const container = doc.createElement('div');
    container.className = 'flowrider-embedded-diagram';
    container.style.cssText = 'width:100%;min-width:0;margin:12px 0;border:1px solid #8392a866;border-radius:6px;overflow:hidden;box-sizing:border-box;';
    const toolbar = doc.createElement('div');
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', `Diagram ${index + 1} controls`);
    toolbar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:4px 6px;font:12px system-ui;background:#e6ecf5;color:#20324b;';
    const label = doc.createElement('span');
    label.textContent = `Diagram ${index + 1}`;
    label.style.marginRight = 'auto';
    toolbar.append(label);
    const viewport = doc.createElement('div');
    viewport.className = 'flowrider-diagram-viewport';
    viewport.tabIndex = 0;
    viewport.setAttribute('aria-label', `Diagram ${index + 1} viewport`);
    viewport.style.cssText = 'position:relative;width:100%;height:320px;min-height:120px;max-height:1200px;overflow:hidden;box-sizing:border-box;touch-action:pan-y;';
    viewport.title = 'Pinch/Ctrl-wheel to zoom. Space-drag to pan. Drag the bottom divider to resize.';
    svg.before(container);
    container.append(toolbar, viewport);
    viewport.append(svg);
    try {
      const percentage = doc.createElement('span');
      percentage.setAttribute('aria-label', 'Diagram zoom');
      const navigation = attachCanvasNavigation(doc, scale => { percentage.textContent = `${Math.round(scale * 100)}%`; }, { svg, viewport });
      const button = (text: string, title: string, action: () => void) => {
        const b = doc.createElement('button');
        b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title);
        b.style.cssText = 'font:12px system-ui;padding:2px 6px;min-width:24px;background:transparent;color:inherit;border:0;border-radius:3px;cursor:pointer;';
        b.addEventListener('click', action);
        cleanups.push(() => b.removeEventListener('click', action));
        toolbar.append(b);
      };
      button('−', 'Zoom out', () => navigation.zoomBy(1 / 1.2));
      toolbar.append(percentage);
      button('+', 'Zoom in', () => navigation.zoomBy(1.2));
      button('Fit', 'Fit diagram', navigation.fit);
      button('100%', 'Actual size', navigation.reset);
      const resizer = doc.createElement('div');
      resizer.className = 'flowrider-diagram-resizer';
      resizer.tabIndex = 0;
      resizer.setAttribute('role', 'separator');
      resizer.setAttribute('aria-label', `Resize diagram ${index + 1}`);
      resizer.setAttribute('aria-orientation', 'horizontal');
      resizer.setAttribute('aria-valuemin', '120'); resizer.setAttribute('aria-valuemax', '1200'); resizer.setAttribute('aria-valuenow', '320');
      resizer.style.cssText = 'height:8px;cursor:row-resize;background:#8392a855;touch-action:none;';
      let startY = 0, startHeight = 320;
      const resize = (height: number) => {
        const value = Math.max(120, Math.min(1200, height));
        viewport.style.height = `${value}px`; resizer.setAttribute('aria-valuenow', String(Math.round(value)));
      };
      resizer.addEventListener('pointerdown', e => { e.preventDefault(); startY = e.clientY; startHeight = viewport.clientHeight; resizer.setPointerCapture(e.pointerId); });
      resizer.addEventListener('pointermove', e => { if (resizer.hasPointerCapture(e.pointerId)) resize(startHeight + e.clientY - startY); });
      resizer.addEventListener('pointerup', e => resizer.releasePointerCapture(e.pointerId));
      resizer.addEventListener('keydown', e => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); resize(viewport.clientHeight + (e.key === 'ArrowUp' ? -40 : 40)); }
      });
      container.append(resizer);
      const hint = doc.createElement('div');
      hint.textContent = 'Scroll to read · Pinch to zoom · Space-drag to pan';
      hint.style.cssText = 'padding:3px 6px;font:10px system-ui;color:#567;';
      container.append(hint);
      cleanups.push(() => navigation.dispose());
    } catch (error) {
      const message = `Diagram ${index + 1}: ${error instanceof Error ? error.message : String(error)}`;
      const warning = doc.createElement('p'); warning.setAttribute('role', 'alert'); warning.textContent = message;
      container.append(warning); reportError(message);
    }
  });
  return () => cleanups.forEach(cleanup => cleanup());
}
