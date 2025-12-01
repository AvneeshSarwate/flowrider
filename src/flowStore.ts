import * as fs from 'fs';
import * as path from 'path';
import { parse as parseJsonc } from 'jsonc-parser';
import * as vscode from 'vscode';
import { getContextLineCount, getDbPath } from './config';
import { getRepoId } from './git';
import {
  FlowDatabase,
  FlowGraph,
  FlowRecord,
  MalformedComment,
} from './types';

const CURRENT_SCHEMA_VERSION = 1;
const TOOL_VERSION = '0.1.0';

function nowIso(): string {
  return new Date().toISOString();
}

function migrate(data: FlowDatabase): FlowDatabase {
  // Only schema version 1 exists today; this is a forward-looking hook.
  const result = { ...data };
  if (!result.schemaVersion) {
    result.schemaVersion = 1;
  }
  return result;
}

export class FlowStore {
  private db: FlowDatabase | null = null;
  private readonly dbFile: string;
  private malformed: MalformedComment[] = [];

  constructor(private readonly workspaceFolder: vscode.WorkspaceFolder) {
    const configuredPath = getDbPath();
    this.dbFile = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(this.workspaceFolder.uri.fsPath, configuredPath);
  }

  async load(): Promise<void> {
    if (this.db) {
      return;
    }

    if (fs.existsSync(this.dbFile)) {
      const raw = await fs.promises.readFile(this.dbFile, 'utf8');
      const parsed = parseJsonc(raw) as FlowDatabase;
      if (!parsed) {
        throw new Error(`Unable to parse flow DB at ${this.dbFile}`);
      }
      this.db = migrate(parsed);
    } else {
      this.db = await this.createDefaultDb();
      await this.save();
    }
  }

  async save(): Promise<void> {
    if (!this.db) {
      return;
    }
    await fs.promises.mkdir(path.dirname(this.dbFile), { recursive: true });
    const serialized = `${JSON.stringify(this.db, null, 2)}\n`;
    await fs.promises.writeFile(this.dbFile, serialized, 'utf8');
  }

  getDatabase(): FlowDatabase {
    if (!this.db) {
      throw new Error('FlowStore.load() must be called before accessing the DB.');
    }
    return this.db;
  }

  getRepoId(): string {
    return this.getDatabase().dbRepoId;
  }

  getWorkspacePath(): string {
    return this.workspaceFolder.uri.fsPath;
  }

  getAllFlows(): FlowRecord[] {
    return Object.values(this.getDatabase().flows);
  }

  getFlowById(id: string): FlowRecord | undefined {
    return this.getDatabase().flows[id];
  }

  replaceAllFlows(flows: FlowRecord[]): void {
    const db = this.getDatabase();
    db.flows = {};
    for (const flow of flows) {
      db.flows[flow.id] = flow;
    }
  }

  upsertFlow(flow: FlowRecord): void {
    const db = this.getDatabase();
    db.flows[flow.id] = flow;
  }

  setMalformed(malformed: MalformedComment[]): void {
    this.malformed = malformed;
  }

  getMalformed(): MalformedComment[] {
    return this.malformed;
  }

  toFlowGraphs(): FlowGraph[] {
    const graphs: FlowGraph[] = [];
    for (const flow of this.getAllFlows()) {
      const nodes = new Set<string>();
      const edges = flow.annotations.map((annotation) => {
        nodes.add(annotation.currentNode);
        nodes.add(annotation.nextNode);
        return {
          flowName: flow.name,
          currentPos: annotation.currentNode,
          nextPos: annotation.nextNode,
          filePath: path.join(this.workspaceFolder.uri.fsPath, annotation.filePath),
          lineNumber: annotation.line,
        };
      });
      graphs.push({
        name: flow.name,
        edges: edges.sort((a, b) => a.lineNumber - b.lineNumber),
        nodes: Array.from(nodes).sort(),
      });
    }
    return graphs.sort((a, b) => a.name.localeCompare(b.name));
  }

  getContextLineCount(): number {
    return getContextLineCount();
  }

  private async createDefaultDb(): Promise<FlowDatabase> {
    const repoId = await getRepoId(this.workspaceFolder.uri.fsPath);
    const createdAt = nowIso();
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      dbScope: 'repo',
      dbRepoId: repoId,
      meta: { createdAt, toolVersion: TOOL_VERSION },
      flows: {},
    };
  }
}
