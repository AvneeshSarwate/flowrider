import * as crypto from 'crypto';
import * as path from 'path';
import { getHeadCommit } from './git';
import { FlowStore } from './flowStore';
import { scanWorkspace } from './flowParser';
import { Annotation, FlowRecord, MalformedComment, ParsedComment } from './types';

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function buildAnnotationId(
  repoId: string,
  filePath: string,
  line: number,
  flowName: string
): string {
  const hash = crypto
    .createHash('sha1')
    .update([repoId, filePath, String(line), flowName].join('|'))
    .digest('hex');
  return `${repoId}::${flowName}::${hash}`;
}

export async function exportFlows(
  store: FlowStore,
  tag: string,
  contextLines: number,
  targetFlowNames?: Set<string>
): Promise<{ flows: FlowRecord[]; malformed: MalformedComment[]; parsed: ParsedComment[] }> {
  await store.load();

  const workspacePath = store.getWorkspacePath();
  const repoId = store.getRepoId();
  const headCommit = await getHeadCommit(workspacePath);

  const scan = await scanWorkspace(tag, contextLines);

  const grouped = new Map<string, Annotation[]>();

  for (const comment of scan.parsed) {
    if (targetFlowNames && !targetFlowNames.has(comment.flowName)) {
      continue;
    }
    const relPath = normalizeRelativePath(comment.relativePath);
    const annotation: Annotation = {
      id: buildAnnotationId(repoId, relPath, comment.line, comment.flowName),
      repoId,
      filePath: relPath,
      commitHash: headCommit,
      line: comment.line,
      isoLine: comment.isoLine,
      column: comment.column,
      contextBefore: comment.contextBefore,
      contextLine: comment.contextLine,
      contextAfter: comment.contextAfter,
      symbolPath: comment.symbolPath ?? null,
      nodeType: comment.nodeType ?? null,
      flowName: comment.flowName,
      currentNode: comment.currentNode,
      nextNode: comment.nextNode,
      crossDeclared: comment.crossDeclared,
      note: '',
      rawComment: comment.rawComment,
      meta: {},
    };

    const list = grouped.get(comment.flowName) ?? [];
    list.push(annotation);
    grouped.set(comment.flowName, list);
  }

  const existing = new Map<string, FlowRecord>();
  for (const flow of store.getAllFlows()) {
    existing.set(flow.id, flow);
  }

  const now = new Date().toISOString();
  const flows: FlowRecord[] = [];

  for (const [flowName, annotations] of grouped.entries()) {
    const declaredCross = annotations.some((a) => a.crossDeclared);
    const isCross = declaredCross;
    const flowId = `${repoId}::${flowName}`;
    const previous = existing.get(flowId);

    flows.push({
      id: flowId,
      name: flowName,
      description: previous?.description ?? '',
      tags: previous?.tags ?? [],
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      declaredCross,
      isCross,
      annotations: annotations.sort((a, b) => a.line - b.line),
    });
  }

  if (targetFlowNames) {
    // Upsert only selected flows, preserve others
    for (const flow of flows) {
      store.upsertFlow(flow);
    }
  } else {
    store.replaceAllFlows(flows);
  }
  store.setMalformed(scan.malformed);
  await store.save();

  return { flows: store.getAllFlows(), malformed: scan.malformed, parsed: scan.parsed };
}
