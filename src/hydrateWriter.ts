import * as fs from 'fs';
import * as path from 'path';
import { getFlowTag } from './config';
import { Annotation, FlowRecord } from './types';

function isFlowComment(line: string, tag: string): boolean {
  return line.includes(tag);
}

function findInsertionLine(lines: string[], isoLine: number, tag: string): number {
  let nonFlowCount = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!isFlowComment(lines[i], tag)) {
      nonFlowCount += 1;
    }
    if (nonFlowCount === isoLine) {
      // Insert before this code line
      return i;
    }
  }
  return lines.length; // append at end
}

function buildCommentLine(rawComment: string, tag: string): string {
  const trimmed = rawComment.trim();
  if (trimmed.startsWith('//')) {
    return trimmed;
  }
  if (trimmed.includes(tag)) {
    return `// ${trimmed}`;
  }
  return `// ${tag} ${trimmed}`;
}

function insertAnnotationsIntoFile(
  absPath: string,
  annotations: Annotation[],
  tag: string
): boolean {
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    return false;
  }

  const lines = content.split(/\r?\n/);
  let changed = false;

  // Sort bottom-up to avoid shifting earlier targets
  const sorted = [...annotations].sort((a, b) => b.isoLine - a.isoLine);

  for (const annotation of sorted) {
    const existingIdx = lines.findIndex(
      (line) =>
        isFlowComment(line, tag) &&
        line.includes(annotation.flowName) &&
        line.includes(annotation.currentNode) &&
        line.includes(annotation.nextNode)
    );
    if (existingIdx >= 0) {
      continue; // already present
    }

    const insertAt = findInsertionLine(lines, annotation.isoLine, tag);
    const commentLine = buildCommentLine(annotation.rawComment, tag);

    // If target line already has a flow comment, place below to avoid conflict
    const targetIndex =
      insertAt < lines.length && isFlowComment(lines[insertAt], tag) ? insertAt + 1 : insertAt;

    lines.splice(targetIndex, 0, commentLine);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
  }

  return changed;
}

export async function applyFlowToSource(
  workspacePath: string,
  flow: FlowRecord
): Promise<number> {
  const tag = getFlowTag();
  const byFile = new Map<string, Annotation[]>();

  for (const annotation of flow.annotations) {
    const list = byFile.get(annotation.filePath) ?? [];
    list.push(annotation);
    byFile.set(annotation.filePath, list);
  }

  let filesChanged = 0;
  for (const [filePath, annotations] of byFile.entries()) {
    const absPath = path.join(workspacePath, filePath);
    const changed = insertAnnotationsIntoFile(absPath, annotations, tag);
    if (changed) {
      filesChanged += 1;
    }
  }

  return filesChanged;
}

export async function insertSingleComment(
  workspacePath: string,
  annotation: Annotation,
  line: number
): Promise<boolean> {
  const tag = getFlowTag();
  const targetPath = path.isAbsolute(annotation.filePath)
    ? annotation.filePath
    : path.join(workspacePath, annotation.filePath);
  const content = await fs.promises.readFile(targetPath, 'utf8').catch(() => undefined);
  if (!content) return false;
  const lines = content.split(/\r?\n/);

  // Avoid duplicates
  const already = lines.some(
    (lineText) =>
      isFlowComment(lineText, tag) &&
      lineText.includes(annotation.flowName) &&
      lineText.includes(annotation.currentNode) &&
      lineText.includes(annotation.nextNode)
  );
  if (already) return true;

  const idx = Math.min(Math.max(line - 1, 0), lines.length);
  const targetIndex = idx < lines.length && isFlowComment(lines[idx], tag) ? idx + 1 : idx;
  const commentLine = buildCommentLine(annotation.rawComment, tag);
  lines.splice(targetIndex, 0, commentLine);
  await fs.promises.writeFile(targetPath, lines.join('\n'), 'utf8');
  return true;
}
