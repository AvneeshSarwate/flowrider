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
  dirty: boolean;
  duplicates: DuplicateEdge[];
  moved: MovedEdge[];
  missing: MissingEdge[];
}

export interface MalformedComment {
  filePath: string;
  lineNumber: number;
  rawText: string;
  reason: string;
}

export interface MatchCandidate {
  line: number;
  score: number;
  source: string;
  snippet?: string;
  symbol?: string;
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
      sessionId: string;
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

