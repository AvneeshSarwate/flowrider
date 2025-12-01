import * as path from 'path';
import * as ts from 'typescript';
import { SymbolIndex, SymbolRange } from './types';

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function toScriptKind(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.ts':
      return ts.ScriptKind.TS;
    case '.jsx':
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.JS;
  }
}

function getNodeName(node: ts.Node): string | undefined {
  const maybeNamed = node as ts.Node & { name?: ts.Node };
  if (maybeNamed.name && ts.isIdentifier(maybeNamed.name)) {
    return maybeNamed.name.text;
  }
  if (ts.isConstructorDeclaration(node)) {
    return 'constructor';
  }
  if (ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
    if (ts.isIdentifier(node.name)) {
      return node.name.text;
    }
  }
  return undefined;
}

function recordRange(source: ts.SourceFile, node: ts.Node, pathParts: string[]): SymbolRange {
  const start = source.getLineAndCharacterOfPosition(node.getStart());
  const end = source.getLineAndCharacterOfPosition(node.getEnd());
  return {
    path: pathParts.join('.'),
    startLine: start.line + 1,
    endLine: end.line + 1,
    nodeType: ts.SyntaxKind[node.kind],
  };
}

export function buildSymbolIndex(filePath: string, content: string): SymbolIndex | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return undefined;
  }

  const source = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    toScriptKind(filePath)
  );

  const byPath = new Map<string, SymbolRange>();

  const visit = (node: ts.Node, stack: string[]) => {
    const name = getNodeName(node);
    const nextStack = name ? [...stack, name] : stack;

    if (
      ts.isClassDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)
    ) {
      if (name) {
        const range = recordRange(source, node, nextStack);
        byPath.set(range.path, range);
      }
    }

    ts.forEachChild(node, (child) => visit(child, nextStack));
  };

  visit(source, []);

  return { byPath };
}

export function inferSymbolAtPosition(
  filePath: string,
  content: string,
  line: number,
  column: number
): { symbolPath?: string; nodeType?: string; range?: SymbolRange } {
  const index = buildSymbolIndex(filePath, content);
  if (!index) {
    return {};
  }

  const candidates: SymbolRange[] = [];
  for (const range of index.byPath.values()) {
    if (line >= range.startLine && line <= range.endLine) {
      candidates.push(range);
    }
  }

  if (candidates.length === 0) {
    return {};
  }

  // Choose the deepest/longest path
  candidates.sort((a, b) => b.path.length - a.path.length);
  const picked = candidates[0];
  return { symbolPath: picked.path, nodeType: picked.nodeType, range: picked };
}

export function findSymbolRange(
  symbolPath: string | undefined | null,
  index: SymbolIndex | undefined
): SymbolRange | undefined {
  if (!symbolPath || !index) {
    return undefined;
  }
  return index.byPath.get(symbolPath);
}
