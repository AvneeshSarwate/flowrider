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

export interface FlowParseResult {
  flows: FlowGraph[];
  malformed: MalformedComment[];
}

export type ExtensionMessage = {
  type: 'flowsUpdated';
  flows: FlowGraph[];
  malformed: MalformedComment[];
};

export type WebviewMessage =
  | { type: 'openLocation'; filePath: string; lineNumber: number }
  | { type: 'requestFlows' };
