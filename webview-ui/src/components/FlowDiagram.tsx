import { useEffect, useId, useMemo, useRef } from 'react';
import mermaid from 'mermaid';
import type { FlowGraph } from '../types';

const hashValue = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
};

const sanitizeId = (value: string) => {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, '_') || 'node';
  return `${cleaned}_${hashValue(value)}`;
};

const escapeLabel = (value: string) => value.replace(/"/g, '&quot;');

const cssEscape =
  typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape
    : (value: string) => value.replace(/[^a-zA-Z0-9_\-]/g, '\\$&');

interface Props {
  flow: FlowGraph;
  onNodeClick: (nodeName: string) => void;
}

const FlowDiagram: React.FC<Props> = ({ flow, onNodeClick }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartId = useId().replace(/:/g, '');

  const { definition, idToNode } = useMemo(() => {
    const idMap = new Map<string, string>();
    const lines: string[] = ['graph TD'];

    for (const node of flow.nodes) {
      const id = sanitizeId(node);
      idMap.set(id, node);
      lines.push(`  ${id}["${escapeLabel(node)}"]`);
    }

    for (const edge of flow.edges) {
      const fromId = sanitizeId(edge.currentPos);
      const toId = sanitizeId(edge.nextPos);
      if (!idMap.has(fromId)) {
        idMap.set(fromId, edge.currentPos);
        lines.push(`  ${fromId}["${escapeLabel(edge.currentPos)}"]`);
      }
      if (!idMap.has(toId)) {
        idMap.set(toId, edge.nextPos);
        lines.push(`  ${toId}["${escapeLabel(edge.nextPos)}"]`);
      }
      lines.push(`  ${fromId} --> ${toId}`);
    }

    return { definition: lines.join('\n'), idToNode: idMap };
  }, [flow.edges, flow.nodes]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let isCancelled = false;
    const listeners: Array<() => void> = [];

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'neutral',
    });

    const render = async () => {
      try {
        console.log('Mermaid definition:', definition);
        const { svg } = await mermaid.render(chartId, definition);
        if (isCancelled || !containerRef.current) {
          return;
        }
        containerRef.current.innerHTML = svg;

        const svgRoot = containerRef.current.querySelector('svg');
        if (svgRoot) {
          idToNode.forEach((nodeName, nodeId) => {
            const element = svgRoot.querySelector<HTMLElement>(`#${cssEscape(nodeId)}`);
            if (element) {
              element.style.cursor = 'pointer';
              const handler = (event: Event) => {
                event.stopPropagation();
                onNodeClick(nodeName);
              };
              element.addEventListener('click', handler);
              listeners.push(() => element.removeEventListener('click', handler));
            }
          });
        }
      } catch (error) {
        if (containerRef.current) {
          containerRef.current.innerHTML = `<div class="diagram-error">Unable to render Mermaid diagram</div>`;
        }
        console.error('Mermaid render failed', error, 'Definition was:', definition);
      }
    };

    render();

    return () => {
      isCancelled = true;
      listeners.forEach((dispose) => dispose());
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [chartId, definition, idToNode, onNodeClick]);

  return <div className="diagram" ref={containerRef} />;
};

export default FlowDiagram;
