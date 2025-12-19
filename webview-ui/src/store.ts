import { create } from 'zustand';
import type { FlowSummary, MalformedComment, MissingEdgeCandidates, MovedEdgeCandidates } from './types';
import vscode from './vscode';

export interface Selection {
  flowName: string;
  nodeName: string;
}

/** Shape of persisted UI state in VS Code's webview state */
interface PersistedState {
  sessionId: string;
  expandedFlows: string[];
  selectedNode: Selection | null;
}

export interface FlowUIStore {
  sessionId: string | null;
  flows: FlowSummary[];
  missingCandidates: Map<string, MissingEdgeCandidates>; // key: flowName|currentNode|nextNode
  movedCandidates: Map<string, MovedEdgeCandidates>; // key: flowName|currentNode|nextNode
  malformed: MalformedComment[];
  expandedFlows: Set<string>;
  selectedNode: Selection | null;
  setSessionId: (sessionId: string) => void;
  setFlows: (flows: FlowSummary[], malformed: MalformedComment[]) => void;
  setMissingCandidates: (data: MissingEdgeCandidates) => void;
  setMovedCandidates: (data: MovedEdgeCandidates) => void;
  toggleFlow: (flowName: string) => void;
  selectNode: (selection: Selection) => void;
  clearSelection: () => void;
}

/** Persist UI state to VS Code's webview state storage */
function persistState(state: FlowUIStore) {
  if (!vscode || !state.sessionId) return;
  const persisted: PersistedState = {
    sessionId: state.sessionId,
    expandedFlows: Array.from(state.expandedFlows),
    selectedNode: state.selectedNode,
  };
  vscode.setState(persisted);
}

export const useFlowStore = create<FlowUIStore>((set, get) => ({
  sessionId: null,
  flows: [],
  missingCandidates: new Map<string, MissingEdgeCandidates>(),
  movedCandidates: new Map<string, MovedEdgeCandidates>(),
  malformed: [],
  expandedFlows: new Set<string>(),
  selectedNode: null,

  setSessionId: (sessionId: string) => {
    // Check if we have persisted state from the same session
    const persisted = vscode?.getState<PersistedState>();
    if (persisted && persisted.sessionId === sessionId) {
      // Same session (panel was just hidden/shown) - restore UI state
      set({
        sessionId,
        expandedFlows: new Set(persisted.expandedFlows),
        selectedNode: persisted.selectedNode,
      });
    } else {
      // New session (VS Code restarted) - clear persisted state and start fresh
      set({ sessionId });
      persistState(get());
    }
  },

  setFlows: (flows, malformed) =>
    set((state) => {
      const nextExpanded = new Set<string>();
      for (const flow of flows) {
        if (state.expandedFlows.has(flow.name)) {
          nextExpanded.add(flow.name);
        }
      }

      const newState = {
        ...state,
        flows,
        missingCandidates: new Map<string, MissingEdgeCandidates>(),
        movedCandidates: new Map<string, MovedEdgeCandidates>(),
        malformed,
        expandedFlows: nextExpanded,
      };
      persistState(newState);
      return newState;
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
      const newState = { ...state, expandedFlows: expanded };
      persistState(newState);
      return { expandedFlows: expanded };
    }),

  selectNode: (selection) => {
    set({ selectedNode: selection });
    persistState(get());
  },

  clearSelection: () => {
    set({ selectedNode: null });
    persistState(get());
  },
}));
