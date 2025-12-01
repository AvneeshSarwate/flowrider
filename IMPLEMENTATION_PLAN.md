# FlowRider Implementation Plan

## Overview
A VS Code extension that parses "flow comments" from code and displays them as interactive Mermaid DAGs in a sidebar panel.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     VS Code Extension (src/)                     │
├─────────────────────────────────────────────────────────────────┤
│  extension.ts          - Entry point, registers providers       │
│  FlowViewProvider.ts   - WebviewViewProvider for sidebar        │
│  flowParser.ts         - Ripgrep execution & comment parsing    │
│  flowStore.ts          - Data structures for flows/DAGs         │
│  config.ts             - Extension settings management          │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ postMessage / onDidReceiveMessage
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Webview UI (webview-ui/)                      │
├─────────────────────────────────────────────────────────────────┤
│  React + Vite + Zustand                                         │
│  - FlowList.tsx        - Collapsible list of all flows          │
│  - FlowDiagram.tsx     - Mermaid diagram for a single flow      │
│  - NodePopup.tsx       - Popup showing file/line locations      │
│  - store.ts            - Zustand global state                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1 Features Breakdown

### 1. Flow Comment Parsing

**Format:** `TAG FLOW_NAME : CURRENT_POS => NEXT_POS`
- Example: `#@#@#@ auth-flow : validate_token => check_permissions`

**Data Model:**
```typescript
interface FlowEdge {
  flowName: string;
  currentPos: string;      // Node name
  nextPos: string;         // Node name  
  filePath: string;        // Absolute path to file
  lineNumber: number;      // 1-indexed line number
}

interface FlowGraph {
  name: string;
  edges: FlowEdge[];
  nodes: Set<string>;      // All unique node names
}

interface FlowStore {
  flows: Map<string, FlowGraph>;  // flowName -> graph
}
```

### 2. Ripgrep Integration (`flowParser.ts`)

**Responsibilities:**
- Execute ripgrep to find all flow comments in workspace
- Parse ripgrep output into `FlowEdge[]`
- Group edges by `flowName` into `FlowGraph` objects

**Key VSCode APIs:**
- `child_process.exec` or `child_process.spawn` for ripgrep
- `vscode.workspace.workspaceFolders` for workspace root

**Regex Pattern:**
```
TAG\s+(\S+)\s*:\s*(\S+)\s*=>\s*(\S+)
```

**Trigger:** 
- `vscode.workspace.onDidSaveTextDocument` - re-scan on every file save

### 3. Extension Settings (`config.ts`)

**VSCode Configuration API:**
```typescript
// In package.json contributes.configuration
{
  "flowrider.tag": {
    "type": "string",
    "default": "#@#@#@",
    "description": "Tag used to identify flow comments"
  }
}

// Reading in code
const tag = vscode.workspace.getConfiguration('flowrider').get<string>('tag', '#@#@#@');
```

### 4. WebviewViewProvider (`FlowViewProvider.ts`)

**Key VSCode APIs:**
- `vscode.window.registerWebviewViewProvider` - register sidebar view
- `WebviewViewProvider.resolveWebviewView` - initialize webview
- `webview.postMessage()` - extension → webview
- `webview.onDidReceiveMessage` - webview → extension

**package.json contributions:**
```json
{
  "contributes": {
    "views": {
      "explorer": [
        {
          "type": "webview",
          "id": "flowrider.flowsView",
          "name": "Flow Rider"
        }
      ]
    }
  }
}
```

**Message Protocol:**
```typescript
// Extension → Webview
type ExtensionMessage = 
  | { type: 'flowsUpdated'; flows: FlowGraph[] }

// Webview → Extension  
type WebviewMessage =
  | { type: 'openLocation'; filePath: string; lineNumber: number }
  | { type: 'requestFlows' }
```

### 5. Opening Files at Specific Lines

**VSCode API:**
```typescript
async function openFileAtLine(filePath: string, line: number) {
  const uri = vscode.Uri.file(filePath);
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const position = new vscode.Position(line - 1, 0); // 0-indexed
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenter
  );
}
```

### 6. Webview UI (React + Zustand)

**Zustand Store:**
```typescript
interface FlowUIStore {
  flows: FlowGraph[];
  expandedFlows: Set<string>;
  selectedNode: { flowName: string; nodeName: string } | null;
  
  setFlows: (flows: FlowGraph[]) => void;
  toggleFlow: (flowName: string) => void;
  selectNode: (flowName: string, nodeName: string) => void;
  clearSelection: () => void;
}
```

**Component Hierarchy:**
```
App
├── FlowList
│   └── FlowItem (for each flow)
│       ├── FlowHeader (name + expand/collapse)
│       └── FlowDiagram (Mermaid when expanded)
└── NodePopup (modal when node clicked)
    └── LocationList
        └── LocationItem (file:line, clickable)
```

**Mermaid Integration:**
- Use `mermaid` npm package for rendering
- Generate flowchart syntax from FlowGraph:
```
graph TD
  validate_token --> check_permissions
  check_permissions --> authorize
  check_permissions --> deny
```

---

## Implementation Order

### Step 1: Extension Foundation
- [ ] Update `package.json` with configuration and view contributions
- [ ] Create `src/config.ts` - settings management
- [ ] Create `src/flowParser.ts` - ripgrep execution and parsing
- [ ] Create `src/FlowViewProvider.ts` - basic WebviewViewProvider

### Step 2: File Save Watcher
- [ ] Add `onDidSaveTextDocument` listener in `extension.ts`
- [ ] Trigger re-scan of workspace on file save
- [ ] Send updated flows to webview

### Step 3: Webview UI Basics
- [ ] Set up Vite build to output to extension's `media/` folder
- [ ] Create Zustand store with flow state
- [ ] Build `FlowList` component with expand/collapse
- [ ] Set up message passing between extension and webview

### Step 4: Mermaid Diagrams
- [ ] Install and configure mermaid in webview-ui
- [ ] Build `FlowDiagram` component
- [ ] Add click handlers on diagram nodes

### Step 5: Node Popup & Navigation
- [ ] Build `NodePopup` component showing locations
- [ ] Implement `openLocation` message handling
- [ ] Add file/line opening in extension

### Step 6: Polish
- [ ] Add loading states
- [ ] Handle errors gracefully (ripgrep not found, parse errors)
- [ ] VSCode theme integration for webview styles
- [ ] Add refresh command

---

## Key Files to Create/Modify

| File | Purpose |
|------|---------|
| `src/extension.ts` | Entry point, register providers and listeners |
| `src/FlowViewProvider.ts` | WebviewViewProvider implementation |
| `src/flowParser.ts` | Ripgrep execution and comment parsing |
| `src/config.ts` | Extension configuration helper |
| `src/types.ts` | Shared TypeScript interfaces |
| `package.json` | Add contributions (views, configuration) |
| `webview-ui/src/store.ts` | Zustand store |
| `webview-ui/src/App.tsx` | Main app with message handling |
| `webview-ui/src/components/FlowList.tsx` | Flow list UI |
| `webview-ui/src/components/FlowDiagram.tsx` | Mermaid diagram |
| `webview-ui/src/components/NodePopup.tsx` | Location popup |
| `webview-ui/vite.config.ts` | Configure output path |

---

## Design Decisions

1. **Ripgrep path**: Assume user has ripgrep installed on their system

2. **Multiple workspaces**: Scan all workspace folders (supports cross-repo flows)

3. **Performance**: Debounce file save events (see details below)

4. **Diagram layout**: Mermaid auto-layout (TD direction)

5. **Error handling**: Show malformed comments in a collapsible list at bottom of sidebar

6. **View type**: Sidebar only (WebviewView)

---

## Debouncing Explanation

**Why debounce?**

When a user saves a file, we trigger a full workspace scan via ripgrep. This is problematic because:

1. **Rapid saves**: Users often save frequently (Cmd+S habit, auto-save). Each save spawning a ripgrep process is wasteful.

2. **Ripgrep overhead**: Even though ripgrep is fast, spawning a child process has fixed overhead (~50-100ms). On large codebases with many files, a full scan could take 200-500ms.

3. **Race conditions**: If save #1 triggers scan A, and save #2 triggers scan B before A finishes, we might process results out of order or have stale data.

4. **UI thrashing**: Each scan completion updates the webview. Rapid updates cause unnecessary re-renders of Mermaid diagrams.

**Implementation:**

```typescript
// In extension.ts
let scanTimeout: NodeJS.Timeout | undefined;
const DEBOUNCE_MS = 500;

vscode.workspace.onDidSaveTextDocument(() => {
  if (scanTimeout) {
    clearTimeout(scanTimeout);
  }
  scanTimeout = setTimeout(() => {
    scanWorkspace();
  }, DEBOUNCE_MS);
});
```

This ensures we only scan once after the user stops saving for 500ms.

---

## Malformed Comments Handling

**Data Model Addition:**
```typescript
interface MalformedComment {
  filePath: string;
  lineNumber: number;
  rawText: string;        // The original comment text
  reason: string;         // Why it failed to parse
}

interface FlowStore {
  flows: Map<string, FlowGraph>;
  malformedComments: MalformedComment[];
}
```

**UI:** Collapsible "Parsing Errors" section at bottom of sidebar showing each malformed comment with file:line link.

---

## VSCode API Summary

| API | Purpose |
|-----|---------|
| `window.registerWebviewViewProvider` | Register sidebar webview |
| `workspace.onDidSaveTextDocument` | Listen for file saves |
| `workspace.getConfiguration()` | Read extension settings |
| `workspace.workspaceFolders` | Get workspace roots for ripgrep |
| `workspace.openTextDocument` | Open a file |
| `window.showTextDocument` | Show file in editor |
| `TextEditor.revealRange` | Scroll to specific line |
| `webview.postMessage` | Send data to webview |
| `webview.onDidReceiveMessage` | Receive data from webview |
