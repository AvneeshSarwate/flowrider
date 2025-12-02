import { create } from 'zustand';
import type { FlowSummary, MalformedComment, MissingEdgeCandidates, MovedEdgeCandidates } from './types';

export interface Selection {
  flowName: string;
  nodeName: string;
}

export interface FlowUIStore {
  flows: FlowSummary[];
  missingCandidates: Map<string, MissingEdgeCandidates>; // key: flowName|currentNode|nextNode
  movedCandidates: Map<string, MovedEdgeCandidates>; // key: flowName|currentNode|nextNode
  malformed: MalformedComment[];
  expandedFlows: Set<string>;
  selectedNode: Selection | null;
  setFlows: (flows: FlowSummary[], malformed: MalformedComment[]) => void;
  setMissingCandidates: (data: MissingEdgeCandidates) => void;
  setMovedCandidates: (data: MovedEdgeCandidates) => void;
  toggleFlow: (flowName: string) => void;
  selectNode: (selection: Selection) => void;
  clearSelection: () => void;
}

export const useFlowStore = create<FlowUIStore>((set) => ({
  flows: [],
  missingCandidates: new Map<string, MissingEdgeCandidates>(),
  movedCandidates: new Map<string, MovedEdgeCandidates>(),
  malformed: [],
  expandedFlows: new Set<string>(),
  selectedNode: null,
  setFlows: (flows, malformed) =>
    set((state) => {
      const nextExpanded = new Set<string>();
      for (const flow of flows) {
        if (state.expandedFlows.has(flow.name)) {
          nextExpanded.add(flow.name);
        }
      }

      return {
        flows,
        missingCandidates: new Map<string, MissingEdgeCandidates>(),
        movedCandidates: new Map<string, MovedEdgeCandidates>(),
        malformed,
        expandedFlows: nextExpanded,
      };
    }),
  setMissingCandidates: (data) =>
    set((state) => {
      const key = `${data.flowName}|${data.edgeKey}`;
      const next = new Map(state.missingCandidates);
      next.set(key, data);
      return { missingCandidates: next };
    }),
  setMovedCandidates: (data) =>
    set((state) => {
      const key = `${data.flowName}|${data.edgeKey}`;
      const next = new Map(state.movedCandidates);
      next.set(key, data);
      return { movedCandidates: next };
    }),
  toggleFlow: (flowName: string) =>
    set((state) => {
      const expanded = new Set(state.expandedFlows);
      if (expanded.has(flowName)) {
        expanded.delete(flowName);
      } else {
        expanded.add(flowName);
      }
      return { expandedFlows: expanded };
    }),
  selectNode: (selection) => set({ selectedNode: selection }),
  clearSelection: () => set({ selectedNode: null }),
}));
