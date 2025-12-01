import { FlowGraph, FlowParseResult, MalformedComment } from './types';

export class FlowStore {
  private flows: FlowGraph[] = [];
  private malformed: MalformedComment[] = [];

  set(result: FlowParseResult) {
    this.flows = result.flows;
    this.malformed = result.malformed;
  }

  getFlows(): FlowGraph[] {
    return this.flows;
  }

  getMalformed(): MalformedComment[] {
    return this.malformed;
  }

  snapshot(): FlowParseResult {
    return { flows: this.flows, malformed: this.malformed };
  }
}
