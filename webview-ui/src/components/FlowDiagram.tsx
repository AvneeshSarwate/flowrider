import { useEffect, useId, useMemo, useRef } from 'react';
import mermaid from 'mermaid';
import type { FlowSummary } from '../types';

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

interface Props {
  flow: FlowSummary;
  onNodeClick: (nodeName: string) => void;
}

const FlowDiagram: React.FC<Props> = ({ flow, onNodeClick }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartId = useId().replace(/:/g, '');
  const callbackName = `flowrider_${chartId}`;

  const { definition, idToNode } = useMemo(() => {
    const idMap = new Map<string, string>();
    const lines: string[] = ['graph TD'];
    const clickLines: string[] = [];

    for (const node of flow.nodes) {
      const id = sanitizeId(node);
      idMap.set(id, node);
      lines.push(`  ${id}["${escapeLabel(node)}"]`);
      clickLines.push(`  click ${id} ${callbackName}`);
    }

    for (const edge of flow.edges) {
      const fromId = sanitizeId(edge.currentPos);
      const toId = sanitizeId(edge.nextPos);
      if (!idMap.has(fromId)) {
        idMap.set(fromId, edge.currentPos);
        lines.push(`  ${fromId}["${escapeLabel(edge.currentPos)}"]`);
        clickLines.push(`  click ${fromId} ${callbackName}`);
      }
      if (!idMap.has(toId)) {
        idMap.set(toId, edge.nextPos);
        lines.push(`  ${toId}["${escapeLabel(edge.nextPos)}"]`);
        clickLines.push(`  click ${toId} ${callbackName}`);
      }
      lines.push(`  ${fromId} --> ${toId}`);
    }

    return { definition: [...lines, ...clickLines].join('\n'), idToNode: idMap };
  }, [flow.edges, flow.nodes, callbackName]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let isCancelled = false;

    // Register global callback for mermaid click events
    (window as unknown as Record<string, unknown>)[callbackName] = (nodeId: string) => {
      const nodeName = idToNode.get(nodeId);
      console.log('Mermaid click callback:', nodeId, '->', nodeName);
      if (nodeName) {
        onNodeClick(nodeName);
      }
    };

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'dark',
      themeVariables: {
        primaryColor: '#3c3c3c',
        primaryTextColor: '#cccccc',
        primaryBorderColor: '#555555',
        lineColor: '#888888',
        secondaryColor: '#2d2d2d',
        tertiaryColor: '#252525',
        background: '#1e1e1e',
        mainBkg: '#2d2d2d',
        nodeBorder: '#555555',
        clusterBkg: '#252525',
        clusterBorder: '#444444',
        titleColor: '#cccccc',
        edgeLabelBackground: '#1e1e1e',
      },
    });

    const render = async () => {
      try {
        console.log('Mermaid definition:', definition);
        const { svg, bindFunctions } = await mermaid.render(chartId, definition);
        if (isCancelled || !containerRef.current) {
          return;
        }
        containerRef.current.innerHTML = svg;
        
        // Bind click events after inserting SVG into DOM
        if (bindFunctions) {
          bindFunctions(containerRef.current);
        }
      } catch (error) {
        if (containerRef.current) {
          containerRef.current.innerHTML = `<div class="diagram-error">Unable to render Mermaid diagram</div>`;
        }
        console.error('Mermaid render failed', error, 'Definition was:', definition);
      }
    };

    render();

    const container = containerRef.current;
    return () => {
      isCancelled = true;
      delete (window as unknown as Record<string, unknown>)[callbackName];
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [chartId, definition, idToNode, onNodeClick, callbackName]);

  return <div className="diagram" ref={containerRef} />;
};

export default FlowDiagram;
