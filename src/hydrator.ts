import { RemapEngine } from './remapper';
import { FlowRecord, HydratedFlow } from './types';

export class FlowHydrator {
  private readonly engine: RemapEngine;

  constructor(private readonly workspacePath: string) {
    this.engine = new RemapEngine(workspacePath);
  }

  // No-op dispose/clear because we removed editor decorations per spec.
  dispose() {}
  clear() {}

  async hydrate(flow: FlowRecord): Promise<HydratedFlow> {
    // Hydration now only computes remap results and returns them;
    // it does not apply any VS Code decorations.
    return this.engine.remapFlow(flow);
  }
}
