import { FlowRecord, FlowSummary, ParsedComment } from './types';

function isSameAnnotation(annotation: FlowRecord['annotations'][number], comment: ParsedComment): boolean {
  if (annotation.flowName !== comment.flowName) return false;
  if (annotation.filePath !== comment.relativePath) return false;
  if (annotation.currentNode !== comment.currentNode) return false;
  if (annotation.nextNode !== comment.nextNode) return false;

  if (annotation.isoLine === comment.isoLine) return true;

  // Fallbacks: close physical line + matching context
  if (Math.abs(annotation.line - comment.line) <= 1) {
    const ctxA = annotation.contextLine.trim();
    const ctxB = comment.contextLine.trim();
    if (ctxA && ctxA === ctxB) {
      return true;
    }
  }
  return false;
}

export function computeFlowSummaries(
  flows: FlowRecord[],
  parsedComments: ParsedComment[]
): FlowSummary[] {
  const byFlow = new Map<string, ParsedComment[]>();
  for (const comment of parsedComments) {
    const list = byFlow.get(comment.flowName) ?? [];
    list.push(comment);
    byFlow.set(comment.flowName, list);
  }

  const summaries: FlowSummary[] = [];

  for (const flow of flows) {
    const comments = byFlow.get(flow.name) ?? [];
    const used = new Set<number>();
    let present = 0;

    for (const annotation of flow.annotations) {
      const idx = comments.findIndex((c, i) => !used.has(i) && isSameAnnotation(annotation, c));
      if (idx >= 0) {
        used.add(idx);
        present += 1;
      }
    }

    const extras = comments.length - used.size;
    let status: 'loaded' | 'partial' | 'notLoaded' = 'notLoaded';
    if (present === flow.annotations.length && flow.annotations.length > 0) {
      status = 'loaded';
    } else if (present > 0) {
      status = 'partial';
    }

    const nodes = new Set<string>();
    const edges = flow.annotations.map((annotation) => {
      nodes.add(annotation.currentNode);
      nodes.add(annotation.nextNode);
      return {
        flowName: flow.name,
        currentPos: annotation.currentNode,
        nextPos: annotation.nextNode,
        filePath: annotation.filePath,
        lineNumber: annotation.line,
      };
    });

    summaries.push({
      id: flow.id,
      name: flow.name,
      edges: edges.sort((a, b) => a.lineNumber - b.lineNumber),
      nodes: Array.from(nodes).sort(),
      status,
      present,
      total: flow.annotations.length,
      extras: Math.max(0, extras),
      declaredCross: flow.declaredCross,
      isCross: flow.isCross,
    });
  }

  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}
