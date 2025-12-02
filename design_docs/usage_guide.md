# FlowRider: Usage Guide & Technical Overview

FlowRider is a VS Code extension for tracking logical "flows" through a codebase using specially formatted comments. It's designed for developers who want to document cross-cutting concerns, trace execution paths, or annotate code with navigable DAG structures.

## Core Concept: Flow Comments

A flow comment declares an edge in a directed graph:

```
#@#@#@ auth-flow : validate => authorize
```

This creates an edge from node `validate` to node `authorize` in a flow named `auth-flow`. The comment is placed at the code location where this transition conceptually occurs.

### Comment Syntax

```
#@#@#@ <flow-name> : <current-node> => <next-node>
#@#@#@ <flow-name>! : <current-node> => <next-node>   // cross-file flow (! suffix)
```

The tag `#@#@#@` is configurable via VS Code settings and meant to aid in easily finding such comments.

### Edge-Based Identity

**Critical concept**: An annotation is uniquely identified by the tuple `(flowName, currentNode, nextNode)`, NOT by its file location. This means:

- Moving a comment to a different line/file doesn't create a new annotation
- The same edge can only exist once per flow (duplicates are flagged)
- Detection and matching operate on edge identity, not position

---

## The Long-Lived Comment Branch Workflow

FlowRider is designed around a specific Git workflow where you maintain flow comments on a **dedicated long-lived branch** that periodically merges from `main`.

### Why This Workflow?

Flow comments are documentation artifacts that:
1. Don't belong in production code (they're for your understanding, not the runtime)
2. Need to survive code churn on `main` without polluting commit history
3. Should be restorable when code refactoring breaks comment positions

### The Branch Model

```
main:     A---B---C---D---E---F
                   \       \
comments:           X---Y---Z---W  (your flow comments live here)
                        ^       ^
                    merge C   merge F
```

You work on the `comments` branch, periodically merging from `main` to pick up new changes.

### Merge Conflict Strategy: "Append After Remote"

When merging `main` into your `comments` branch, you will encounter conflicts where:
- Remote (`main`) modified a file
- Local (`comments`) has flow comments in that file

**The intended resolution strategy**: Accept all remote changes first, then append your flow comments at the end of each conflicting block. This is the **"accept theirs, then append mine"** pattern. You can use the node script ___ to execute this type of merge.

```
<<<<<<< HEAD (comments branch)
function validate(token) {
  // #@#@#@ auth-flow : validate => authorize
  return checkToken(token);
}
=======
function validate(token: string): boolean {
  return checkToken(token);
}
>>>>>>> main
```

Resolved as:
```
function validate(token: string): boolean {
  return checkToken(token);
}
// #@#@#@ auth-flow : validate => authorize   <-- appended after remote block
```

**Note**: This resolution will likely cause the comment to be in the "wrong" place. That's expected! FlowRider's detection systems will flag this as a "moved" edge, and you can then manually relocate it. This strategy was chosen as a balance of keeping things predictably "correct enough" while still being fairly mechanical to implement. In the interface, there are heuristics for trying to restore the comment to the "correct" place post merge (described later in the "Context Matching" section)

---

## The FlowRider Database

FlowRider maintains a JSON database (`.flowrider/flows.json`) that stores the canonical state of your flows.

### What's Stored Per Annotation

```typescript
interface Annotation {
  id: string;                    // UUID
  filePath: string;              // relative to workspace
  line: number;                  // physical line number when exported
  commitHash: string;            // git commit at export time

  // Edge identity
  flowName: string;
  currentNode: string;
  nextNode: string;

  // Context for matching (stored at export time)
  contextBefore: string[];       // N lines before the comment
  contextLine: string;           // the code line the comment is on
  contextAfter: string[];        // N lines after the comment

  // The actual comment text
  rawComment: string;

  // Optional metadata
  symbolPath?: string;           // AST symbol path (e.g., "MyClass.myMethod")
  nodeType?: string;             // AST node type
}
```

### Export Operation ("⬇︎ DB" button)

When you export a flow to the DB:
1. FlowRider scans source files for all comments matching that flow
2. For each comment, it captures the current file, line, and surrounding context
3. The annotation is stored with the current git commit hash
4. Previous DB state for that flow is replaced

**Key assumption**: The DB represents "where comments were last known to be". It's your source of truth for restoration.

---

## Detection: What FlowRider Shows You

On every file save, FlowRider scans your workspace and compares source comments against the DB.

### Flow Status Badges

| Status | Meaning |
|--------|---------|
| `loaded` | All DB edges found in source at expected locations |
| `partial` | Some edges present, some missing |
| `moved` | Edges found but at different locations than DB |
| `missing` | DB edges not found in source |
| `duplicates` | Same edge appears multiple times |

### Detection Categories

#### 1. Duplicates Panel
Same edge `(flowName, currentNode, nextNode)` appears in multiple locations. This is usually an error—you probably copy-pasted a comment and forgot to update it.

#### 2. Moved Edges Panel
The edge exists in source, but at a different `(file, line)` than the DB recorded. This happens when:
- Code was refactored and comments moved with it
- You manually relocated a comment
- A merge conflict resolution displaced the comment

**Actions**:
- **Open DB Location**: Jump to where DB thinks it was
- **Open Source Location**: Jump to where it actually is
- **Find Context Candidates**: Search for where the *original context code* might have moved to (more info in the "Context Matching" section)

#### 3. Missing Edges Panel
The edge exists in DB but wasn't found in any source file. This happens when:
- The comment was accidentally deleted
- A merge conflict resolution dropped the comment
- The file was deleted or renamed

**Actions**:
- **Open DB Location**: Jump to the last known location
- **Insert at DB Line**: Blindly insert the comment at the stored line number
- **Find Candidates**: Use context matching to find where the code moved
- **Insert Here**: Insert the comment at a candidate location

---

## Context Matching: The Remapping Engine

When a comment goes missing or moves, FlowRider can search for where its surrounding code context might have relocated.

### How Matching Works

The DB stores `contextBefore`, `contextLine`, and `contextAfter`—the code surrounding the comment when it was exported. The remapper searches the current file for similar code patterns.

### Match Strategies (in priority order)

1. **Exact Snippet Match** (score: 1.0)
   - The entire context block exists verbatim in the file
   - Highest confidence

2. **Context Line Match** (score: varies)
   - The specific `contextLine` exists somewhere in the file
   - Surrounding window is compared for similarity
   - Good for when code structure changed but the key line remains

3. **Fuzzy Window Match** (score: 0.6-0.9)
   - Sliding window comparison using string similarity
   - Catches cases where code was slightly modified
   - Lower confidence, presented as candidates

### Match Sources in UI

| Source | Meaning |
|--------|---------|
| `exact-snippet` | Full context block found verbatim |
| `context-line` | The context line matched exactly |
| `fuzzy-window` | Similar code found via fuzzy matching |
| `diff` | Git diff mapping suggested this location |

### Thresholds

- **Auto-resolve** (≥90% confidence): Would be auto-placed in a full hydration flow
- **Candidate** (70-90%): Presented for manual review
- **Rejected** (<60%): Not shown, too low confidence

---

## Typical Session Workflow

### 1. After Merging Main

```bash
git checkout comments
git merge main
# Resolve conflicts using "accept theirs, append mine" strategy
```

Then in VS Code:
1. Open FlowRider panel
2. Check each flow for `moved` or `missing` status
3. For **moved edges**:
   - Usually just re-export to DB to update stored positions
   - If the comment is in a bad spot, relocate it first
4. For **missing edges**:
   - Click "Find Candidates" to locate where the context code moved
   - "Open" candidates to verify the right spot
   - "Insert Here" to restore the comment

### 2. Regular Development

As you add new flow comments:
1. Add comment at the relevant code location
2. Save the file (FlowRider auto-scans)
3. Click "⬇︎ DB" to export to database
4. Commit both source changes and `.flowrider/flows.json`

### 3. Investigating a Flow

1. Expand a flow in the panel
2. Click nodes in the Mermaid diagram to see all edges touching that node
3. Click node locations to open a list of all edges from that node, click the edge to jump to it's comment
4. Use the diagram to understand the flow structure

---

## Assumptions & Limitations

### Assumptions

1. **Edge uniqueness**: Each `(flowName, currentNode, nextNode)` tuple should appear exactly once
2. **Context stability**: The code around a comment is relatively stable—if you completely rewrite a function, context matching will fail
3. **Single workspace**: Currently designed for single-folder workspaces (monorepo support is limited)
4. **Git availability**: Some features (like diff-based matching) require git history

### Limitations

1. **No auto-fix**: FlowRider won't automatically relocate comments. It shows you what's wrong and offers tools to fix it manually.
2. **Context window size**: Default is 3 lines before/after. Larger windows improve matching but increase DB size.
3. **File renames**: If a file is renamed, comments become "missing" from the old path. You'll need to manually re-place the comment and update the DB.

### The "Append After Remote" Script (TODO)

The merge conflict resolution strategy requires a script that:
1. Parses git conflict markers
2. Identifies flow comments in the local (HEAD) side
3. Accepts the remote version
4. Appends flow comments after each resolved block

This would be invoked as a custom merge driver or post-merge hook:

```bash
# Pseudocode for the merge resolver
for each conflict_block:
    local_comments = extract_flow_comments(block.local)
    resolved = block.remote
    if local_comments:
        resolved += "\n" + "\n".join(local_comments)
    write(resolved)
```

---

## Configuration

VS Code settings (`settings.json`):

```json
{
  "flowrider.flowTag": "#@#@#@",           // Comment prefix
  "flowrider.contextLines": 3,             // Lines of context to store
  "flowrider.debounceMs": 500              // Scan debounce delay
}
```

---

## File Structure

```
your-repo/
├── .flowrider/
│   └── flows.json          # Flow database
├── src/
│   └── *.ts                # Your source files with flow comments
└── .vscode/
    └── settings.json       # FlowRider configuration
```

The `.flowrider/` directory should be committed to your `comments` branch.

## todo 
doesn't properly cover `cross` keyword and cross-repo flows (though those are not explicitly supported right now)