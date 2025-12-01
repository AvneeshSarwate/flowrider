import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { inferSymbolAtPosition } from './ast';
import { ParsedComment, ScanResult, MalformedComment } from './types';

interface RipgrepMatch {
  filePath: string;
  relativePath: string;
  lineNumber: number;
  column: number;
  isoLine: number;
  lineText: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runRipgrepOnFolder(
  folderPath: string,
  tag: string
): Promise<RipgrepMatch[]> {
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
            const lineText = (parsed.data.lines.text as string).replace(/\r?\n$/, '');
            const column =
              (parsed.data.submatches?.[0]?.start ?? lineText.indexOf(tag)) + 1;
            matches.push({
              filePath: absolutePath,
              relativePath: fileRelative,
              lineNumber,
              column,
              isoLine: 0, // to be filled later
              lineText,
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

function parseCommentLine(
  lineText: string,
  tag: string,
  filePath: string,
  relativePath: string,
  lineNumber: number,
  isoLine: number,
  column: number,
  contextBefore: string[],
  contextLine: string,
  contextAfter: string[]
): { parsed?: ParsedComment; malformed?: MalformedComment } {
  const rawText = lineText.trim();
  const idx = rawText.toLowerCase().indexOf(tag.toLowerCase());
  const body = idx >= 0 ? rawText.slice(idx + tag.length).trim() : rawText;

  const crossPattern = new RegExp(
    `^(cross\\s+)?([^\\s:]+)\\s*:\\s*([^\\s=>]+)\\s*=>\\s*(\\S+)`,
    'i'
  );
  const match = crossPattern.exec(body);

  if (!match) {
    return {
      malformed: {
        filePath,
        lineNumber,
        rawText,
        reason:
          'Comment does not match "[tag] [cross] FLOW : CURRENT => NEXT" format',
      },
    };
  }

  const [, crossToken, flowName, currentNode, nextNode] = match;

  return {
    parsed: {
      flowName,
      currentNode,
      nextNode,
      crossDeclared: Boolean(crossToken),
      rawComment: rawText,
      line: lineNumber,
      isoLine,
      column,
      filePath,
      relativePath,
      contextBefore,
      contextLine,
      contextAfter,
    },
  };
}

export async function scanWorkspace(
  tag: string,
  contextLines: number
): Promise<ScanResult> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { parsed: [], malformed: [] };
  }

  const parsed: ParsedComment[] = [];
  const malformed: MalformedComment[] = [];

  for (const folder of workspaceFolders) {
    const folderPath = folder.uri.fsPath;
    const matches = await runRipgrepOnFolder(folderPath, tag);

    // Cache file contents so we only read once per file
    const contentCache = new Map<string, string[]>();
    const textCache = new Map<string, string>();
    const isoCache = new Map<string, number[]>();

    for (const match of matches) {
      let lines = contentCache.get(match.filePath);
      let fullText = textCache.get(match.filePath);
      let isoLines = isoCache.get(match.filePath);

      if (!lines || !fullText || !isoLines) {
        fullText = await fs.promises.readFile(match.filePath, 'utf8');
        lines = fullText.split(/\r?\n/);
        const isoArray: number[] = [];
        let flowlessCounter = 0;
        for (let i = 0; i < lines.length; i += 1) {
          const text = lines[i];
          const hasTag = text.includes(tag);
          if (!hasTag) {
            flowlessCounter += 1;
          }
          isoArray[i] = flowlessCounter;
        }
        contentCache.set(match.filePath, lines);
        textCache.set(match.filePath, fullText);
        isoCache.set(match.filePath, isoArray);
        isoLines = isoArray;
      }

      const idx = Math.max(0, match.lineNumber - 1);
      const beforeStart = Math.max(0, idx - contextLines);
      const afterEnd = Math.min(lines.length, idx + 1 + contextLines);
      const contextBefore = lines.slice(beforeStart, idx);
      const contextLine = lines[idx] ?? match.lineText;
      const contextAfter = lines.slice(idx + 1, afterEnd);

      const result = parseCommentLine(
        lines[idx] ?? match.lineText,
        tag,
        match.filePath,
        match.relativePath,
        match.lineNumber,
        isoLines ? isoLines[idx] : match.lineNumber,
        match.column,
        contextBefore,
        contextLine,
        contextAfter
      );

      if (result.parsed) {
        const symbolInfo = inferSymbolAtPosition(
          match.filePath,
          fullText,
          match.lineNumber,
          match.column
        );
        parsed.push({
          ...result.parsed,
          symbolPath: symbolInfo.symbolPath ?? null,
          nodeType: symbolInfo.nodeType ?? null,
        });
      } else if (result.malformed) {
        malformed.push(result.malformed);
      }
    }
  }

  return { parsed, malformed };
}
