import { useEffect, useId, useMemo, useRef } from 'react';
import mermaid from 'mermaid';
import svgPanZoom from 'svg-pan-zoom';
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

const buildMermaidDefinition = (
  flow: FlowSummary
): { definition: string; idToNode: Map<string, string> } => {
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
};

interface Props {
  flow: FlowSummary;
  onNodeClick: (nodeName: string) => void;
}

const DRAG_THRESHOLD = 5; // pixels - movement beyond this is considered a drag

const FlowDiagram: React.FC<Props> = ({ flow, onNodeClick }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panZoomRef = useRef<SvgPanZoom.Instance | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  const chartId = useId().replace(/:/g, '');

  const { definition, idToNode } = useMemo(
    () => buildMermaidDefinition(flow),
    [flow]
  );

  // Keep the callback ref updated (in an effect to satisfy React rules)
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  // Effect for rendering diagram and setting up pan/zoom (does NOT depend on onNodeClick)
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let isCancelled = false;

    // Track mouse positions to distinguish clicks from drags
    const handleMouseDown = (e: MouseEvent) => {
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e: MouseEvent) => {
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = (e: MouseEvent) => {
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    };

    // Handle node clicks - uses ref to always get latest callback
    const handleNodeClick = (e: MouseEvent) => {
      // Check if this was a drag rather than a click
      const start = dragStartRef.current;
      const end = lastMousePosRef.current;
      if (start && end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > DRAG_THRESHOLD) {
          console.log('Ignoring click - was a drag (distance:', distance, ')');
          return;
        }
      }

      // Find the node element (could be clicking on a child element)
      const target = e.target as Element;
      const nodeElement = target.closest('.node');
      if (!nodeElement) return;

      // Extract node ID from the element's id attribute
      // Mermaid generates IDs like "flowchart-nodeId-0" or just the nodeId
      const elementId = nodeElement.id;
      // Try to find a matching key in idToNode
      const nodeName = idToNode.get(elementId) ||
        [...idToNode.entries()].find(([key]) => elementId.includes(key))?.[1];

      console.log('Node click:', elementId, '->', nodeName);
      if (nodeName) {
        onNodeClickRef.current(nodeName);
      }
    };

    containerRef.current.addEventListener('mousedown', handleMouseDown);
    containerRef.current.addEventListener('mousemove', handleMouseMove);
    containerRef.current.addEventListener('mouseup', handleMouseUp);

    mermaid.initialize({
      startOnLoad: false,
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
        const { svg } = await mermaid.render(chartId, definition);
        if (isCancelled || !containerRef.current) {
          return;
        }
        containerRef.current.innerHTML = svg;

        // Initialize svg-pan-zoom on the rendered SVG
        const svgElement = containerRef.current.querySelector('svg');
        if (svgElement) {
          // Destroy previous instance if it exists
          if (panZoomRef.current) {
            panZoomRef.current.destroy();
            panZoomRef.current = null;
          }

          // Make SVG fill the container for better pan/zoom experience
          svgElement.style.width = '100%';
          svgElement.style.height = '100%';
          svgElement.style.maxWidth = 'none';

          // Add click listeners to all node elements
          const nodes = svgElement.querySelectorAll('.node');
          nodes.forEach(node => {
            node.addEventListener('click', handleNodeClick as EventListener);
            (node as HTMLElement).style.cursor = 'pointer';
          });

          panZoomRef.current = svgPanZoom(svgElement, {
            panEnabled: true,
            controlIconsEnabled: true,
            zoomEnabled: true,
            dblClickZoomEnabled: true,
            mouseWheelZoomEnabled: true,
            zoomScaleSensitivity: 0.3,
            minZoom: 0.25,
            maxZoom: 10,
            fit: true,
            center: true,
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

    const container = containerRef.current;
    return () => {
      isCancelled = true;
      // Remove mouse event listeners
      if (container) {
        container.removeEventListener('mousedown', handleMouseDown);
        container.removeEventListener('mousemove', handleMouseMove);
        container.removeEventListener('mouseup', handleMouseUp);
      }
      // Destroy svg-pan-zoom instance before clearing container
      if (panZoomRef.current) {
        panZoomRef.current.destroy();
        panZoomRef.current = null;
      }
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [chartId, definition, idToNode]);

  return <div className="diagram" ref={containerRef} />;
};

export default FlowDiagram;
