export interface FlowEdge {
  flowName: string;
  currentPos: string;
  nextPos: string;
  filePath: string;
  lineNumber: number;
}

export interface FlowGraph {
  name: string;
  edges: FlowEdge[];
  nodes: string[];
}

export interface MalformedComment {
  filePath: string;
  lineNumber: number;
  rawText: string;
  reason: string;
}

// -----------------------------
// Flow database (monorepo v0)
// -----------------------------

export interface Annotation {
  id: string;
  repoId?: string;
  filePath: string; // always relative to workspace folder
  commitHash: string;
  line: number; // physical line where comment existed when exported
  isoLine: number; // line index counting only non-flow-comment lines (flow-less)
  column: number;
  contextBefore: string[];
  contextLine: string;
  contextAfter: string[];
  symbolPath?: string | null;
  nodeType?: string | null;
  flowName: string;
  currentNode: string;
  nextNode: string;
  crossDeclared: boolean;
  note?: string;
  rawComment: string;
  meta: Record<string, unknown>;
}

export interface FlowRecord {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  declaredCross: boolean;
  isCross: boolean;
  annotations: Annotation[];
}

export interface FlowDatabase {
  schemaVersion: number;
  dbScope: 'repo' | 'global';
  dbRepoId: string;
  meta: {
    createdAt: string;
    toolVersion: string;
  };
  flows: Record<string, FlowRecord>;
}

export interface CommentMatch {
  filePath: string;
  relativePath: string;
  lineNumber: number;
  column: number;
  isoLine: number;
  lineText: string;
}

export interface ParsedComment {
  flowName: string;
  currentNode: string;
  nextNode: string;
  crossDeclared: boolean;
  rawComment: string;
  line: number;
  isoLine: number;
  column: number;
  filePath: string;
  relativePath: string;
  contextBefore: string[];
  contextLine: string;
  contextAfter: string[];
  symbolPath?: string | null;
  nodeType?: string | null;
}

export interface ScanResult {
  parsed: ParsedComment[];
  malformed: MalformedComment[];
}

// -----------------------------
// Remapping / hydration
// -----------------------------

export interface LineMapEntry {
  status: 'mapped' | 'deleted';
  newLine?: number;
}

export type MatchSource =
  | 'diff'
  | 'exact-snippet'
  | 'context-line'
  | 'fuzzy-window'
  | 'ast';

export interface MatchCandidate {
  line: number;
  score: number;
  source: MatchSource;
  snippet?: string;
  symbol?: string;
}

export type ResolutionStatus =
  | { kind: 'auto'; line: number; confidence: number; source: MatchSource }
  | { kind: 'candidates'; candidates: MatchCandidate[] }
  | { kind: 'unmapped'; reason: 'no-match' | 'file-missing' | 'git-missing'; note?: string };

export interface HydratedAnnotation {
  annotation: Annotation;
  resolution: ResolutionStatus;
}

export interface HydratedFlow {
  flow: FlowRecord;
  annotations: HydratedAnnotation[];
}

export interface SymbolRange {
  path: string;
  startLine: number;
  endLine: number;
  nodeType: string;
}

export interface SymbolIndex {
  byPath: Map<string, SymbolRange>;
}

export type FlowLoadStatus = 'loaded' | 'partial' | 'notLoaded' | 'duplicates' | 'moved' | 'missing';

export interface DuplicateEdge {
  currentNode: string;
  nextNode: string;
  locations: Array<{ filePath: string; lineNumber: number }>;
}

export interface MovedEdge {
  currentNode: string;
  nextNode: string;
  dbLocation: {
    filePath: string;
    lineNumber: number;
    contextBefore: string[];
    contextLine: string;
    contextAfter: string[];
  };
  sourceLocation: { filePath: string; lineNumber: number };
}

export interface MissingEdge {
  currentNode: string;
  nextNode: string;
  dbLocation: {
    filePath: string;
    lineNumber: number;
    contextBefore: string[];
    contextLine: string;
    contextAfter: string[];
  };
  rawComment: string;
}

export interface FlowSummary extends FlowGraph {
  id: string;
  status: FlowLoadStatus;
  present: number;
  total: number;
  extras: number;
  declaredCross: boolean;
  isCross: boolean;
  dirty: boolean; // code differs from DB
  duplicates: DuplicateEdge[];
  moved: MovedEdge[];
  missing: MissingEdge[];
}

export interface MissingEdgeCandidates {
  flowName: string;
  edgeKey: string; // currentNode|nextNode
  candidates: MatchCandidate[];
}

export interface MovedEdgeCandidates {
  flowName: string;
  edgeKey: string; // currentNode|nextNode
  candidates: MatchCandidate[];
}

export type ExtensionMessage =
  | {
      type: 'flowsUpdated';
      flows: FlowSummary[];
      malformed: MalformedComment[];
    }
  | {
      type: 'missingEdgeCandidates';
      data: MissingEdgeCandidates;
    }
  | {
      type: 'movedEdgeCandidates';
      data: MovedEdgeCandidates;
    };

export type WebviewMessage =
  | { type: 'openLocation'; filePath: string; lineNumber: number }
  | { type: 'requestFlows' }
  | { type: 'writeFlowToDb'; flowName: string }
  | { type: 'findMissingEdgeCandidates'; flowName: string; edge: MissingEdge }
  | { type: 'insertMissingComment'; flowName: string; edge: MissingEdge }
  | { type: 'insertAtCandidate'; flowName: string; edge: MissingEdge; line: number }
  | { type: 'findMovedEdgeCandidates'; flowName: string; edge: MovedEdge };
