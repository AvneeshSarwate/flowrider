import * as fs from 'fs';
import * as path from 'path';
import { diffLines } from 'diff';
import { compareTwoStrings } from 'string-similarity';
import { buildSymbolIndex, findSymbolRange } from './ast';
import { getFileAtCommit } from './git';
import {
  Annotation,
  FlowRecord,
  HydratedAnnotation,
  HydratedFlow,
  LineMapEntry,
  MatchCandidate,
  ResolutionStatus,
  SymbolIndex,
} from './types';

type LineMap = Map<number, LineMapEntry>;

interface FileContext {
  oldContent?: string;
  newContent?: string;
  newLines?: string[];
  lineMap?: LineMap;
  symbolIndex?: SymbolIndex;
}

interface SearchRegion {
  lines: string[];
  startLine: number; // 1-based line number of lines[0] in the file
  symbol?: string;
}

const STRICT_THRESHOLD = 0.9;
const CANDIDATE_THRESHOLD = 0.7;
const FUZZY_MIN_THRESHOLD = 0.6;
const MAX_CANDIDATES = 5;

function safeSimilarity(a: string, b: string): number {
  if (!a.trim() && !b.trim()) {
    return 1;
  }
  return compareTwoStrings(a, b);
}

function buildSnippet(before: string[], line: string, after: string[]): string {
  return [...before, line, ...after].join('\n');
}

function snippetAt(
  lines: string[],
  lineNumber: number,
  before: number,
  after: number
): string {
  const idx = Math.max(0, lineNumber - 1);
  const start = Math.max(0, idx - before);
  const end = Math.min(lines.length, idx + 1 + after);
  return lines.slice(start, end).join('\n');
}

function buildLineMap(oldContent: string, newContent: string): LineMap {
  const diff = diffLines(oldContent, newContent);
  const map: LineMap = new Map();
  let oldLine = 1;
  let newLine = 1;

  for (const part of diff) {
    const valueLines = part.value.split(/\r?\n/);
    const count = part.count ?? Math.max(valueLines.length - 1, 1);

    if (part.added) {
      newLine += count;
      continue;
    }

    if (part.removed) {
      for (let i = 0; i < count; i += 1) {
        map.set(oldLine + i, { status: 'deleted' });
      }
      oldLine += count;
      continue;
    }

    // Unchanged block: map directly
    for (let i = 0; i < count; i += 1) {
      map.set(oldLine + i, { status: 'mapped', newLine: newLine + i });
    }
    oldLine += count;
    newLine += count;
  }

  return map;
}

function dedupeCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  const bestByLine = new Map<number, MatchCandidate>();
  for (const candidate of candidates) {
    const existing = bestByLine.get(candidate.line);
    if (!existing || candidate.score > existing.score) {
      bestByLine.set(candidate.line, candidate);
    }
  }
  return Array.from(bestByLine.values()).sort((a, b) => b.score - a.score);
}

function regionFor(
  newLines: string[],
  symbolPath: string | undefined | null,
  index: SymbolIndex | undefined
): SearchRegion {
  const range = findSymbolRange(symbolPath, index);
  if (!range) {
    return { lines: newLines, startLine: 1, symbol: undefined };
  }
  const start = Math.max(0, range.startLine - 1);
  const end = Math.min(newLines.length, range.endLine);
  return { lines: newLines.slice(start, end), startLine: range.startLine, symbol: range.path };
}

function exactSnippetSearch(
  snippetLines: string[],
  region: SearchRegion
): MatchCandidate[] {
  if (snippetLines.length === 0) {
    return [];
  }

  const matches: MatchCandidate[] = [];

  for (let i = 0; i <= region.lines.length - snippetLines.length; i += 1) {
    let allMatch = true;
    for (let j = 0; j < snippetLines.length; j += 1) {
      if (region.lines[i + j] !== snippetLines[j]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      matches.push({
        line: region.startLine + i,
        score: 1,
        source: 'exact-snippet',
        snippet: snippetLines.join('\n'),
        symbol: region.symbol,
      });
    }
  }

  return matches;
}

function contextLineSearch(
  contextLine: string,
  snippet: string,
  snippetLines: string[],
  region: SearchRegion
): MatchCandidate[] {
  const matches: MatchCandidate[] = [];
  if (!contextLine.trim()) {
    return matches;
  }

  for (let i = 0; i < region.lines.length; i += 1) {
    if (region.lines[i] !== contextLine) {
      continue;
    }
    const windowStart = Math.max(0, i - Math.floor(snippetLines.length / 2));
    const windowEnd = Math.min(region.lines.length, windowStart + snippetLines.length);
    const window = region.lines.slice(windowStart, windowEnd);
    const score = safeSimilarity(snippet, window.join('\n'));
    matches.push({
      line: region.startLine + i,
      score,
      source: 'context-line',
      snippet: window.join('\n'),
      symbol: region.symbol,
    });
  }

  return matches;
}

function fuzzyWindowSearch(
  snippet: string,
  snippetLines: string[],
  region: SearchRegion
): MatchCandidate[] {
  const matches: MatchCandidate[] = [];
  if (snippetLines.length === 0) {
    return matches;
  }

  const windowSize = snippetLines.length;
  for (let i = 0; i <= region.lines.length - windowSize; i += 1) {
    const window = region.lines.slice(i, i + windowSize);
    const score = safeSimilarity(snippet, window.join('\n'));
    if (score >= FUZZY_MIN_THRESHOLD) {
      matches.push({
        line: region.startLine + i,
        score,
        source: 'fuzzy-window',
        snippet: window.join('\n'),
        symbol: region.symbol,
      });
    }
  }

  return matches;
}

function tryDiffMapping(
  annotation: Annotation,
  ctx: FileContext,
  oldSnippet: string
): { resolution?: ResolutionStatus; candidate?: MatchCandidate } {
  if (!ctx.lineMap || !ctx.newLines) {
    return {};
  }
  const mapEntry = ctx.lineMap.get(annotation.line);
  if (!mapEntry || mapEntry.status !== 'mapped' || !mapEntry.newLine) {
    return {};
  }

  const newSnippet = snippetAt(
    ctx.newLines,
    mapEntry.newLine,
    annotation.contextBefore.length,
    annotation.contextAfter.length
  );
  const score = safeSimilarity(oldSnippet, newSnippet);

  if (score >= STRICT_THRESHOLD) {
    return {
      resolution: { kind: 'auto', line: mapEntry.newLine, confidence: score, source: 'diff' },
    };
  }

  return {
    candidate: {
      line: mapEntry.newLine,
      score,
      source: 'diff',
      snippet: newSnippet,
      symbol: annotation.symbolPath ?? undefined,
    },
  };
}

function remapAnnotation(annotation: Annotation, ctx: FileContext): ResolutionStatus {
  if (!ctx.newContent || !ctx.newLines) {
    return { kind: 'unmapped', reason: 'file-missing' };
  }
  if (!ctx.oldContent || !ctx.lineMap) {
    return { kind: 'unmapped', reason: 'git-missing' };
  }

  const oldSnippet = buildSnippet(
    annotation.contextBefore,
    annotation.contextLine,
    annotation.contextAfter
  );
  const snippetLines = oldSnippet.split(/\r?\n/);
  const region = regionFor(ctx.newLines, annotation.symbolPath, ctx.symbolIndex);

  const diffOutcome = tryDiffMapping(annotation, ctx, oldSnippet);
  if (diffOutcome.resolution) {
    return diffOutcome.resolution;
  }

  const candidates: MatchCandidate[] = [];
  if (diffOutcome.candidate) {
    candidates.push(diffOutcome.candidate);
  }

  candidates.push(...exactSnippetSearch(snippetLines, region));
  candidates.push(...contextLineSearch(annotation.contextLine, oldSnippet, snippetLines, region));
  candidates.push(...fuzzyWindowSearch(oldSnippet, snippetLines, region));

  const deduped = dedupeCandidates(candidates).slice(0, MAX_CANDIDATES);

  if (deduped.length === 0) {
    return { kind: 'unmapped', reason: 'no-match' };
  }

  const best = deduped[0];
  if (best.score >= STRICT_THRESHOLD) {
    return { kind: 'auto', line: best.line, confidence: best.score, source: best.source };
  }

  if (best.score >= CANDIDATE_THRESHOLD) {
    return { kind: 'candidates', candidates: deduped };
  }

  return { kind: 'unmapped', reason: 'no-match' };
}

export class RemapEngine {
  constructor(private readonly workspacePath: string) {}

  private async loadFileContext(
    filePath: string,
    commitHash: string
  ): Promise<FileContext> {
    const absPath = path.join(this.workspacePath, filePath);

    const [oldContent, newContent] = await Promise.all([
      getFileAtCommit(this.workspacePath, commitHash, filePath),
      fs.promises.readFile(absPath, 'utf8').catch(() => undefined),
    ]);

    const newLines = newContent?.split(/\r?\n/);
    const lineMap =
      oldContent && newContent ? buildLineMap(oldContent, newContent) : undefined;
    const symbolIndex =
      newContent && newLines ? buildSymbolIndex(absPath, newContent) : undefined;

    return { oldContent, newContent, newLines, lineMap, symbolIndex };
  }

  async remapFlow(flow: FlowRecord): Promise<HydratedFlow> {
    const results: HydratedAnnotation[] = [];
    const cache = new Map<string, FileContext>();

    for (const annotation of flow.annotations) {
      const key = `${annotation.commitHash}::${annotation.filePath}`;
      let ctx = cache.get(key);
      if (!ctx) {
        ctx = await this.loadFileContext(annotation.filePath, annotation.commitHash);
        cache.set(key, ctx);
      }

      const resolution = remapAnnotation(annotation, ctx);
      results.push({ annotation, resolution });
    }

    return { flow, annotations: results };
  }
}
