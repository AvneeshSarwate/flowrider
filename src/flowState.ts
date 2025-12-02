import { DuplicateEdge, FlowRecord, FlowSummary, MissingEdge, MovedEdge, ParsedComment } from './types';

/** Edge identity key: flowName|currentNode|nextNode */
function edgeKey(flowName: string, currentNode: string, nextNode: string): string {
  return `${flowName}|${currentNode}|${nextNode}`;
}

/** Detect duplicate edges within a flow's comments */
function detectDuplicates(comments: ParsedComment[]): DuplicateEdge[] {
  const byKey = new Map<string, ParsedComment[]>();

  for (const comment of comments) {
    const key = edgeKey(comment.flowName, comment.currentNode, comment.nextNode);
    const list = byKey.get(key) ?? [];
    list.push(comment);
    byKey.set(key, list);
  }

  const duplicates: DuplicateEdge[] = [];

  for (const [, group] of byKey) {
    if (group.length > 1) {
      duplicates.push({
        currentNode: group[0].currentNode,
        nextNode: group[0].nextNode,
        locations: group.map((c) => ({
          filePath: c.filePath,
          lineNumber: c.line,
        })),
      });
    }
  }

  return duplicates;
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

    // Detect duplicates first
    const duplicates = detectDuplicates(comments);

    // For matching, only consider non-duplicate comments (use first occurrence)
    const seenKeys = new Set<string>();
    const uniqueComments: ParsedComment[] = [];
    for (const comment of comments) {
      const key = edgeKey(comment.flowName, comment.currentNode, comment.nextNode);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueComments.push(comment);
      }
    }

    // Match DB annotations against unique source comments and detect moved/missing edges
    let present = 0;
    const matchedCommentKeys = new Set<string>();
    const moved: MovedEdge[] = [];
    const missing: MissingEdge[] = [];

    // Build a map of unique comments by edge key for quick lookup
    const uniqueCommentsByKey = new Map<string, ParsedComment>();
    for (const comment of uniqueComments) {
      const key = edgeKey(comment.flowName, comment.currentNode, comment.nextNode);
      uniqueCommentsByKey.set(key, comment);
    }

    if (dbFlow) {
      for (const annotation of dbFlow.annotations) {
        const key = edgeKey(annotation.flowName, annotation.currentNode, annotation.nextNode);
        const matchingComment = uniqueCommentsByKey.get(key);
        if (matchingComment) {
          present += 1;
          matchedCommentKeys.add(key);

          // Check if location differs (file or line)
          const dbFile = annotation.filePath;
          const dbLine = annotation.line;
          const srcFile = matchingComment.relativePath;
          const srcLine = matchingComment.line;

          if (dbFile !== srcFile || dbLine !== srcLine) {
            moved.push({
              currentNode: annotation.currentNode,
              nextNode: annotation.nextNode,
              dbLocation: {
                filePath: dbFile,
                lineNumber: dbLine,
                contextBefore: annotation.contextBefore,
                contextLine: annotation.contextLine,
                contextAfter: annotation.contextAfter,
              },
              sourceLocation: { filePath: srcFile, lineNumber: srcLine },
            });
          }
        } else {
          // DB annotation not found in source - it's missing
          missing.push({
            currentNode: annotation.currentNode,
            nextNode: annotation.nextNode,
            dbLocation: {
              filePath: annotation.filePath,
              lineNumber: annotation.line,
              contextBefore: annotation.contextBefore,
              contextLine: annotation.contextLine,
              contextAfter: annotation.contextAfter,
            },
            rawComment: annotation.rawComment,
          });
        }
      }
    }

    // Extras = unique source edges not in DB
    const extras = uniqueComments.filter((c) => {
      const key = edgeKey(c.flowName, c.currentNode, c.nextNode);
      return !matchedCommentKeys.has(key) || !dbFlow;
    }).length;

    const total = dbFlow ? dbFlow.annotations.length : 0;
    const dirty = dbFlow ? present !== total || extras > 0 : true;

    // Determine status with priority: duplicates > missing > moved > partial > loaded > notLoaded
    let status: 'loaded' | 'partial' | 'notLoaded' | 'duplicates' | 'moved' | 'missing' = 'notLoaded';
    if (duplicates.length > 0) {
      status = 'duplicates';
    } else if (missing.length > 0) {
      status = 'missing';
    } else if (moved.length > 0) {
      status = 'moved';
    } else if (comments.length === 0 && total === 0) {
      status = 'notLoaded';
    } else if (!dirty) {
      status = 'loaded';
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
      duplicates,
      moved,
      missing,
    });
  }

  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}
