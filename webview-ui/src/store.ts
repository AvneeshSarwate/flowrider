import { create } from 'zustand';
import type { FlowGraph, MalformedComment } from './types';

export interface Selection {
  flowName: string;
  nodeName: string;
}

export interface FlowUIStore {
  flows: FlowGraph[];
  malformed: MalformedComment[];
  expandedFlows: Set<string>;
  selectedNode: Selection | null;
  setFlows: (flows: FlowGraph[], malformed: MalformedComment[]) => void;
  toggleFlow: (flowName: string) => void;
  selectNode: (selection: Selection) => void;
  clearSelection: () => void;
}

export const useFlowStore = create<FlowUIStore>((set) => ({
  flows: [],
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
        malformed,
        expandedFlows: nextExpanded,
      };
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
