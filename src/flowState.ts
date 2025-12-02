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
  const parsedByFlow = new Map<string, ParsedComment[]>();
  for (const comment of parsedComments) {
    const list = parsedByFlow.get(comment.flowName) ?? [];
    list.push(comment);
    parsedByFlow.set(comment.flowName, list);
  }

  const summaries: FlowSummary[] = [];
  const allFlowNames = new Set<string>([
    ...flows.map((f) => f.name),
    ...parsedByFlow.keys(),
  ]);

  for (const flowName of allFlowNames) {
    const dbFlow = flows.find((f) => f.name === flowName);
    const comments = parsedByFlow.get(flowName) ?? [];
    const used = new Set<number>();
    let present = 0;

    if (dbFlow) {
      for (const annotation of dbFlow.annotations) {
        const idx = comments.findIndex((c, i) => !used.has(i) && isSameAnnotation(annotation, c));
        if (idx >= 0) {
          used.add(idx);
          present += 1;
        }
      }
    }

    const extras = comments.length - used.size;
    const total = dbFlow ? dbFlow.annotations.length : 0;
    const dirty = dbFlow ? present !== total || extras > 0 : true;
    let status: 'loaded' | 'partial' | 'notLoaded' = 'notLoaded';
    if (comments.length === 0 && total === 0) {
      status = 'notLoaded';
    } else if (!dirty) {
      status = 'loaded';
    } else if (present > 0) {
      status = 'partial';
    } else {
      status = 'partial';
    }

    // Build graph from parsed comments if available; otherwise from DB.
    const nodes = new Set<string>();
    const edges =
      comments.length > 0
        ? comments.map((c) => {
            nodes.add(c.currentNode);
            nodes.add(c.nextNode);
            return {
              flowName,
              currentPos: c.currentNode,
              nextPos: c.nextNode,
              filePath: c.filePath,
              lineNumber: c.line,
            };
          })
        : (dbFlow?.annotations ?? []).map((annotation) => {
            nodes.add(annotation.currentNode);
            nodes.add(annotation.nextNode);
            return {
              flowName,
              currentPos: annotation.currentNode,
              nextPos: annotation.nextNode,
              filePath: annotation.filePath,
              lineNumber: annotation.line,
            };
          });

    const declaredCross =
      comments.length > 0
        ? comments.some((c) => c.crossDeclared) || dbFlow?.declaredCross === true
        : dbFlow?.declaredCross ?? false;
    const isCross = dbFlow?.isCross ?? declaredCross;

    summaries.push({
      id: dbFlow?.id ?? `unsaved::${flowName}`,
      name: flowName,
      edges: edges.sort((a, b) => a.lineNumber - b.lineNumber),
      nodes: Array.from(nodes).sort(),
      status,
      present,
      total,
      extras: Math.max(0, extras),
      declaredCross,
      isCross,
      dirty,
    });
  }

  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}
