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

export type FlowLoadStatus = 'loaded' | 'partial' | 'notLoaded' | 'duplicates' | 'moved';

export interface DuplicateEdge {
  currentNode: string;
  nextNode: string;
  locations: Array<{ filePath: string; lineNumber: number }>;
}

export interface MovedEdge {
  currentNode: string;
  nextNode: string;
  dbLocation: { filePath: string; lineNumber: number };
  sourceLocation: { filePath: string; lineNumber: number };
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
}

export interface MalformedComment {
  filePath: string;
  lineNumber: number;
  rawText: string;
  reason: string;
}

export type ExtensionMessage =
  | {
      type: 'flowsUpdated';
      flows: FlowSummary[];
      malformed: MalformedComment[];
    }
  | {
      type: 'hydratedFlow';
      flowName: string;
      hydrated: HydratedFlow;
    };

export type WebviewMessage =
  | { type: 'openLocation'; filePath: string; lineNumber: number }
  | { type: 'requestFlows' }
  | { type: 'writeFlowToDb'; flowName: string }
  | { type: 'hydrateFlowFromDb'; flowName: string }
  | { type: 'requestHydrateFlow'; flowName: string }
  | { type: 'resolveCandidate'; flowName: string; annotationId: string; line: number }
  | { type: 'addCandidateComment'; flowName: string; annotationId: string; line: number };

// Hydration payloads
export type ResolutionStatus =
  | { kind: 'auto'; line: number; confidence: number; source: string }
  | { kind: 'candidates'; candidates: MatchCandidate[] }
  | { kind: 'unmapped'; reason: string; note?: string };

export interface MatchCandidate {
  line: number;
  score: number;
  source: string;
  snippet?: string;
  symbol?: string;
}

export interface Annotation {
  id: string;
  filePath: string;
  flowName: string;
  currentNode: string;
  nextNode: string;
  rawComment: string;
  contextBefore: string[];
  contextLine: string;
  contextAfter: string[];
  commitHash: string;
}

export interface HydratedAnnotation {
  annotation: Annotation;
  resolution: ResolutionStatus;
}

export interface HydratedFlow {
  flow: { id: string; name: string };
  annotations: HydratedAnnotation[];
}
