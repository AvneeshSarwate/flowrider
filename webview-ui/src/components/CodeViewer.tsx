import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';

interface Props {
  code: string;
  filePath: string;
  highlightLine?: number; // 0-indexed line to highlight
}

function getLanguageExtension(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript();
    case 'ts':
      return javascript({ typescript: true });
    case 'jsx':
      return javascript({ jsx: true });
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'py':
      return python();
    case 'rs':
      return rust();
    case 'c':
    case 'h':
      return cpp();
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return cpp();
    case 'java':
      return java();
    case 'html':
    case 'htm':
      return html();
    case 'css':
    case 'scss':
    case 'less':
      return css();
    case 'json':
      return json();
    case 'md':
    case 'markdown':
      return markdown();
    default:
      // Default to javascript for unknown types
      return javascript();
  }
}

const baseTheme = EditorView.theme({
  '&': {
    fontSize: '12px',
    backgroundColor: 'var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.3))',
  },
  '.cm-content': {
    fontFamily: 'var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Consolas, monospace)',
    padding: '8px 0',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: '1px solid var(--vscode-input-border, rgba(255, 255, 255, 0.08))',
    color: 'var(--vscode-editorLineNumber-foreground, #858585)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--vscode-charts-yellow) 20%, transparent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--vscode-charts-yellow) 15%, transparent)',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
});

const CodeViewer: React.FC<Props> = ({ code, filePath, highlightLine }) => {
  const langExtension = getLanguageExtension(filePath);

  const extensions = [
    langExtension,
    baseTheme,
    EditorView.lineWrapping,
    EditorView.editable.of(false),
  ];

  return (
    <div className="code-viewer">
      <CodeMirror
        value={code}
        extensions={extensions}
        editable={false}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: highlightLine !== undefined,
          highlightActiveLine: highlightLine !== undefined,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: false,
          bracketMatching: false,
          closeBrackets: false,
          autocompletion: false,
          rectangularSelection: false,
          crosshairCursor: false,
          highlightSelectionMatches: false,
          closeBracketsKeymap: false,
          searchKeymap: false,
          foldKeymap: false,
          completionKeymap: false,
          lintKeymap: false,
        }}
        theme="dark"
      />
    </div>
  );
};

export default CodeViewer;
