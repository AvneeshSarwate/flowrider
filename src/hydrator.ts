import * as path from 'path';
import * as vscode from 'vscode';
import { RemapEngine } from './remapper';
import {
  FlowRecord,
  HydratedFlow,
  HydratedAnnotation,
  MatchCandidate,
} from './types';

const COLOR_AUTO = '#4CAF50';
const COLOR_CANDIDATE = '#FFB300';
const COLOR_STALE = '#E53935';

interface DecorationBuckets {
  auto: vscode.DecorationOptions[];
  candidate: vscode.DecorationOptions[];
  stale: vscode.DecorationOptions[];
}

export class FlowHydrator {
  private readonly engine: RemapEngine;
  private readonly autoDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    after: { color: COLOR_AUTO, margin: '0 0 0 1em' },
  });
  private readonly candidateDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    after: { color: COLOR_CANDIDATE, margin: '0 0 0 1em' },
  });
  private readonly staleDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    after: { color: COLOR_STALE, margin: '0 0 0 1em' },
  });

  private lastEditors: vscode.TextEditor[] = [];

  constructor(private readonly workspacePath: string) {
    this.engine = new RemapEngine(workspacePath);
  }

  dispose() {
    this.clear();
    this.autoDecoration.dispose();
    this.candidateDecoration.dispose();
    this.staleDecoration.dispose();
  }

  clear() {
    for (const editor of this.lastEditors) {
      editor.setDecorations(this.autoDecoration, []);
      editor.setDecorations(this.candidateDecoration, []);
      editor.setDecorations(this.staleDecoration, []);
    }
    this.lastEditors = [];
  }

  async hydrate(flow: FlowRecord): Promise<HydratedFlow> {
    this.clear();
    const hydrated = await this.engine.remapFlow(flow);
    await this.applyDecorations(hydrated);
    return hydrated;
  }

  private buildHover(
    annotation: HydratedAnnotation,
    status: string,
    candidates?: MatchCandidate[]
  ): vscode.MarkdownString {
    const hover = new vscode.MarkdownString(undefined, true);
    hover.appendMarkdown(
      `**${annotation.annotation.flowName}** — ${annotation.annotation.currentNode} -> ${annotation.annotation.nextNode}\n\n`
    );
    hover.appendMarkdown(`Status: ${status}\n\n`);
    hover.appendMarkdown('Original:\n');
    hover.appendCodeblock(annotation.annotation.rawComment);

    if (candidates && candidates.length > 0) {
      hover.appendMarkdown('\nCandidates:\n');
      for (const candidate of candidates.slice(0, 3)) {
        hover.appendMarkdown(
          `- line ${candidate.line} (score ${(candidate.score * 100).toFixed(0)}%) from ${candidate.source}\n`
        );
      }
    }

    return hover;
  }

  private async applyDecorations(hydrated: HydratedFlow) {
    const perFile = new Map<string, DecorationBuckets>();

    const push = (
      filePath: string,
      kind: 'auto' | 'candidate' | 'stale',
      option: vscode.DecorationOptions
    ) => {
      const bucket =
        perFile.get(filePath) ?? { auto: [], candidate: [], stale: [] };
      bucket[kind].push(option);
      perFile.set(filePath, bucket);
    };

    for (const item of hydrated.annotations) {
      const filePath = path.join(this.workspacePath, item.annotation.filePath);
      const hover = this.buildHover(
        item,
        item.resolution.kind,
        item.resolution.kind === 'candidates'
          ? item.resolution.candidates
          : undefined
      );

      if (item.resolution.kind === 'auto') {
        const range = new vscode.Range(
          Math.max(0, item.resolution.line - 1),
          0,
          Math.max(0, item.resolution.line - 1),
          0
        );
        push(filePath, 'auto', {
          range,
          renderOptions: {
            after: {
              contentText: ` ${item.annotation.flowName}: ${item.annotation.currentNode} -> ${item.annotation.nextNode}`,
            },
          },
          hoverMessage: hover,
        });
      } else if (item.resolution.kind === 'candidates') {
        const target = item.resolution.candidates[0];
        const range = new vscode.Range(
          Math.max(0, target.line - 1),
          0,
          Math.max(0, target.line - 1),
          0
        );
        push(filePath, 'candidate', {
          range,
          renderOptions: {
            after: {
              contentText: ` ${item.annotation.flowName} (?) ${item.annotation.currentNode} -> ${item.annotation.nextNode} (score ${(target.score * 100).toFixed(0)}%)`,
            },
          },
          hoverMessage: hover,
        });
      } else {
        // unmapped
        // Try to place at original line if the file exists; otherwise skip decoration.
        let range: vscode.Range | undefined;
        try {
          const doc = await vscode.workspace.openTextDocument(filePath);
          const line =
            item.annotation.line <= doc.lineCount
              ? item.annotation.line
              : doc.lineCount;
          range = new vscode.Range(
            Math.max(0, line - 1),
            0,
            Math.max(0, line - 1),
            0
          );
        } catch {
          range = undefined;
        }
        if (range) {
          push(filePath, 'stale', {
            range,
            renderOptions: {
              after: {
                contentText: ` ${item.annotation.flowName}: unable to remap`,
              },
            },
            hoverMessage: hover,
          });
        }
      }
    }

    for (const [filePath, bucket] of perFile.entries()) {
      try {
        const document = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(document, {
          preserveFocus: true,
          preview: false,
        });
        editor.setDecorations(this.autoDecoration, bucket.auto);
        editor.setDecorations(this.candidateDecoration, bucket.candidate);
        editor.setDecorations(this.staleDecoration, bucket.stale);
        this.lastEditors.push(editor);
      } catch (error) {
        console.error('Failed to open file for hydration', filePath, error);
      }
    }
  }
}
