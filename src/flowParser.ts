import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { FlowEdge, FlowGraph, FlowParseResult, MalformedComment } from './types';

interface RipgrepMatch {
  filePath: string;
  lineNumber: number;
  lineText: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseFlowLine(
  lineText: string,
  tag: string,
  filePath: string,
  lineNumber: number
): { edge?: FlowEdge; malformed?: MalformedComment } {
  const pattern = new RegExp(
    `${escapeRegExp(tag)}\\s+(\\S+)\\s*:\\s*(\\S+)\\s*=>\\s*(\\S+)`
  );
  const match = pattern.exec(lineText);

  if (!match) {
    return {
      malformed: {
        filePath,
        lineNumber,
        rawText: lineText.trim(),
        reason: 'Comment does not match TAG FLOW : CURRENT => NEXT format',
      },
    };
  }

  const [, flowName, currentPos, nextPos] = match;
  return {
    edge: {
      flowName,
      currentPos,
      nextPos,
      filePath,
      lineNumber,
    },
  };
}

function runRipgrepOnFolder(folderPath: string, tag: string): Promise<RipgrepMatch[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '--json',
      '--line-number',
      '--hidden',
      '--glob',
      '!.git',
      '--glob',
      '!node_modules',
      '--glob',
      '!dist',
      '--glob',
      '!out',
      '--fixed-strings',
      tag,
      '.',
    ];

    const rg = spawn('rg', args, { cwd: folderPath });
    const matches: RipgrepMatch[] = [];
    let stderr = '';

    rg.stdout.on('data', (data) => {
      const lines = data
        .toString()
        .split('\n')
        .filter((line: string) => line.trim().length > 0);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'match') {
            const fileRelative = parsed.data.path.text as string;
            const absolutePath = path.join(folderPath, fileRelative);
            const lineNumber = parsed.data.line_number as number;
            const lineText = parsed.data.lines.text as string;
            matches.push({
              filePath: absolutePath,
              lineNumber,
              lineText: lineText.trimEnd(),
            });
          }
        } catch {
          // Ignore lines that are not valid JSON events
        }
      }
    });

    rg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    rg.on('error', (error) => {
      reject(error);
    });

    rg.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        reject(
          new Error(
            stderr.trim().length > 0
              ? stderr
              : `ripgrep exited with code ${code ?? 'unknown'}`
          )
        );
        return;
      }
      resolve(matches);
    });
  });
}

export async function parseWorkspace(tag: string): Promise<FlowParseResult> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { flows: [], malformed: [] };
  }

  const allMatches: RipgrepMatch[] = [];
  for (const folder of workspaceFolders) {
    const folderPath = folder.uri.fsPath;
    const matches = await runRipgrepOnFolder(folderPath, tag);
    allMatches.push(...matches);
  }

  const edges: FlowEdge[] = [];
  const malformed: MalformedComment[] = [];

  for (const match of allMatches) {
    const parsed = parseFlowLine(match.lineText, tag, match.filePath, match.lineNumber);
    if (parsed.edge) {
      edges.push(parsed.edge);
    } else if (parsed.malformed) {
      malformed.push(parsed.malformed);
    }
  }

  const flowMap = new Map<string, FlowGraph>();

  for (const edge of edges) {
    let graph = flowMap.get(edge.flowName);
    if (!graph) {
      graph = { name: edge.flowName, edges: [], nodes: [] };
      flowMap.set(edge.flowName, graph);
    }
    graph.edges.push(edge);
    if (!graph.nodes.includes(edge.currentPos)) {
      graph.nodes.push(edge.currentPos);
    }
    if (!graph.nodes.includes(edge.nextPos)) {
      graph.nodes.push(edge.nextPos);
    }
  }

  const flows = Array.from(flowMap.values()).map((graph) => ({
    ...graph,
    edges: [...graph.edges].sort((a, b) => a.lineNumber - b.lineNumber),
    nodes: [...graph.nodes].sort(),
  }));

  return { flows: flows.sort((a, b) => a.name.localeCompare(b.name)), malformed };
}
