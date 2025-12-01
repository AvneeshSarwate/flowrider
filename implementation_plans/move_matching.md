Yeah, with “one flow at a time” and ~30 comments, you’ve got a *lot* of headroom for nicer heuristics and AST-level stuff. 500 ms for a single hydration is very realistic if you’re smart about reuse (parse once per file, diff once per file, etc.).

Here’s an updated design that folds in concrete libraries (tree-sitter, ast-grep, string similarity libs) and the “rehydrate one flow” workflow.

---

## 0. High-level shape (updated)

**Mental model now:**

* You have a **Flow** object (e.g. “User login happy path”) that is a small set of annotations (≤30) across a few files.
* The “database” (JSON, SQLite, whatever) knows:

  * Which flows exist
  * Which annotations belong to each flow
* When the user wants to *view* a flow:

  1. They pick it in your UI.
  2. The extension **hydrates** that flow by trying to map each annotation from its original `(file, commit, line)` to the current working tree.
  3. You overlay decorations / pseudo-comments in the editor.

Hydration is the thing we care about; it should feel instant-ish (~<500 ms).

Because we only handle one flow at a time, and each flow has a small number of annotations, we can afford:

* One **diff** per file
* One **AST parse** per file
* A few fuzzy similarity scans per annotation
* Optional slower “commit-by-commit” drilldown when needed (can be behind a “debug this annotation” command since it might exceed 500 ms).

---

## 1. Libraries & how they fit

### 1.1 Git and diffs

Options for getting file content + diffs:

* **Shelling out to Git** with `child_process` (easy, robust, matches user’s Git exactly):

  * `git show <commit>:<path>` to get old file.
  * `git show HEAD:<path>` or read directly from workspace for new file.
  * `git diff <commitOld>..HEAD -- <path>` if you want unified diff text.

* **`isomorphic-git`** for pure JS Git if you don’t want to shell out. It can read commits, trees, and blobs from a repo via Node. ([npm][1])

For text diffs inside Node:

* [`diff` / `jsdiff`](https://www.npmjs.com/package/diff) (commonly used line/word diff lib).
* Or just parse `git diff`’s unified format yourself (you already know how hunks look).

For your context, I’d probably:

* Use **Git CLI** for simplicity.
* Use **jsdiff** for line-based diff if you want to stay independent of Git’s output format.

---

### 1.2 AST and structure

You’ve got two good options:

#### A. Tree-sitter (WASM / web-tree-sitter)

* Tree-sitter is a fast incremental parser that builds syntax trees and updates them efficiently as code changes. ([tree-sitter.github.io][2])
* There are per-language grammars like `tree-sitter-javascript`, `tree-sitter-typescript`, etc., published to npm. ([npm][3])
* In VS Code, using Node-native `tree-sitter` can be finicky because it’s a native module and VS Code runs on Electron, which often requires rebuilding and special handling; people often use **`web-tree-sitter`** (WASM) instead. ([GitHub][4])

For you:

* **Use `web-tree-sitter` + language grammars compiled to WASM**.
* Parse each file once per hydration.
* Use it to:

  * Map annotations to AST nodes (e.g. the specific `CallExpression`, `IfStatement`, function declaration).
  * Limit searches to the containing function / class.
  * Use node ranges instead of single lines as your “anchor”.

#### B. ast-grep

* `ast-grep` is an AST-based search/transform tool built on top of tree-sitter; it supports a lot of languages (JS/TS, Python, Go, etc.). ([ast-grep.github.io][5])
* It has a Node/JS API via `@ast-grep/napi` (Rust via napi). ([ast-grep.github.io][6])

Pros for you:

* Lets you query AST with pattern-code-style queries (e.g. “call to `foo($X)`”).
* Can be used to find “same shape” nodes across revisions (good for move detection).

Caveat:

* It’s a native module. It *should* work in Node, but you have to ensure it plays nicely with VS Code’s Electron runtime and packaging. If that sounds like pain, you can start with `web-tree-sitter` and add ast-grep later if you want fancier matching.

A reasonable plan:

* **Baseline**: use `web-tree-sitter` for basic AST anchoring and region limiting.
* **Optional**: add `@ast-grep/napi` later for advanced matching and multi-language support, once the core system works.

---

### 1.3 String similarity

You want robust but not crazy-heavy string metrics.

Options:

* [`string-similarity`](https://www.npmjs.com/package/string-similarity): Dice coefficient–based, returns similarity 0–1 and best matches among a set. ([npm][7])
* [`cmpstr`](https://github.com/komed3/cmpstr): TS library with Levenshtein, Dice–Sørensen, Damerau–Levenshtein, etc., no deps. ([GitHub][8])

Recommendation:

* Use **`cmpstr`** as your “engine” (it gives you multiple algorithms).
* Wrap it in a tiny helper:

  ```ts
  function similarity(a: string, b: string): number {
    // maybe Dice or normalized Levenshtein
  }
  ```

Use this for:

* Comparing old vs new context windows.
* Scoring candidate moved snippets.

---

## 2. Updated hydration pipeline (per flow)

Input: **Flow** = list of annotations.

```ts
interface Flow {
  id: string;
  name: string;
  annotations: Annotation[];
}
```

### 2.1 Group annotations by file

Most flows will touch 1–3 files. Group for efficiency:

```ts
const byFile = groupBy(flow.annotations, a => a.filePath);
```

For each `filePath`:

1. Get `oldContent` (`git show annotation.commit:filePath` from *any* annotation in that file).
2. Get `newContent` (from workspace or `git show HEAD:filePath`).
3. Build **diff-based line map** from `oldContent` → `newContent`.
4. Build **ASTs** (optional but recommended):

   * `oldAST = parseWithTreeSitter(oldContent)`
   * `newAST = parseWithTreeSitter(newContent)`

Now all annotations in that file reuse the same diff + AST.

### 2.2 For each annotation in that file

We run a staged heuristic pipeline.

#### Stage 1: Direct diff mapping (fast path)

Use the mapping we discussed earlier:

* Using `jsdiff` (or parsed `git diff`), build:

  ```ts
  interface LineMapEntry {
    status: 'mapped' | 'deleted' | 'modified';
    newLine?: number;
  }

  type LineMap = Map<number, LineMapEntry>;
  ```

* Look up `lineMap.get(annotation.line)`.

If `status === 'mapped'`, we have a **candidate** new line. Now:

#### Stage 2: Context similarity check

* Extract new context window around `newLine` from `newContent` (same number of lines as `contextBefore/After`).
* Compute similarity between:

  * Old combined context (`before + line + after`) and
  * New combined context.

Using your `similarity` helper (Dice or normalized Levenshtein via `cmpstr`):

```ts
const oldSnippet = buildSnippet(annotation);
const newSnippet = buildSnippetAt(newContent, newLine, windowSize);
const score = similarity(oldSnippet, newSnippet);
```

Decision:

* If `score >= 0.9` → **happy path auto-adjust**.
* If `0.7 <= score < 0.9` → candidate, but maybe ask the user (or mark as medium-confidence).
* If `< 0.7` → treat like “needs move detection” (we suspect a heavy edit or move).

#### Stage 3: Move detection (text-level)

If line is `deleted`/`modified` OR context looks too different, run move heuristics. Rough order:

1. **Exact multi-line snippet search**:

   * Look for `oldSnippet` as a substring in `newContent`.
   * If exactly one hit:

     * Use that as `newLine`, mark as **moved, high confidence**.
   * If multiple hits:

     * Score each hit by context similarity; keep top N.

2. **Exact context line search**:

   * Search for `contextLine` exactly in `newContent`.
   * For each candidate line:

     * Build local snippet and compute similarity to `oldSnippet`.
   * If exactly one high-scoring candidate → strong move candidate.
   * Else → list of candidates.

3. **Fuzzy windowed search** (fallback):

   * Break `newContent` into lines.
   * Slide a window of `N = snippetLines.length`:

     * For each window, build snippet; compute similarity.
   * Keep highest scoring (and maybe top 3 for user inspection).
   * Filter by threshold (e.g. ≥0.75).

Use `cmpstr` for all scoring.

#### Stage 4: AST-assisted matching

AST helps reduce false positives and make moves more robust.

**Anchoring annotations to AST nodes:**

When you *create* an annotation, you can store:

* `symbolPath` (function/method/class name) by climbing ancestors in the **old** AST.
* `nodeType` (e.g. `call_expression`, `if_statement`, `return_statement`).
* Maybe a stable subset of the node text (e.g. function name and parameters, or callee + argument shape).

At hydration time:

1. **Find containing symbol in new AST**:

   * Use `symbolPath` to locate the same function/class (e.g. find `function foo()` or `class AuthService`).
   * Restrict text-based move search to that region (line range of that symbol).
2. **Match node shapes**:

   * Using `web-tree-sitter`:

     * In the old AST: find the specific node you anchored to.
     * In the new AST: find nodes with same type + similar text features (identifier, string literal, etc.).
   * Optionally, with **ast-grep**:

     * Build a pattern that approximates the code you annotated (e.g. `foo($ARG)`).
     * Run it on `newContent` to find structurally similar locations. ([ast-grep.github.io][5])

This AST layer is especially useful when:

* Code moved between files or functions but kept the same shape.
* Text-based snippet matching is unstable because of formatting changes (e.g. prettier, reflow).

In practice, you might:

* Use text-based heuristics first.
* If they produce too many candidates or low scores, consult AST as a tie-breaker:

  * “Does candidate’s AST node look like the original node?”
  * Bonus points if it’s under the same symbol.

---

## 3. Result classification (unchanged concept, more concrete)

For **each annotation**, after all heuristics:

```ts
type ResolutionStatus =
  | { kind: 'auto'; newLine: number; confidence: number; }
  | { kind: 'candidates'; options: MatchCandidate[]; }
  | { kind: 'unmapped'; reason: 'no-match' | 'file-missing' | 'timeout'; breakingCommit?: string; };
```

Where a `MatchCandidate` might look like:

```ts
interface MatchCandidate {
  newLine: number;
  score: number;          // 0-1
  source: 'diff' | 'snippet' | 'context-line' | 'fuzzy' | 'ast';
  symbol?: string;        // symbolPath if known
}
```

**You then:**

* Apply all `kind: 'auto'` resolutions silently when hydrating the flow.
* For `kind: 'candidates'`, show a quick-pick / side panel letting the user pick or ignore.
* For `kind: 'unmapped'`, show them as stale & optionally offer a “show breaking commit” button.

---

## 4. Commit-by-commit “breaking commit” search (still Step 4)

You now clearly only do this on **one annotation at a time**, when the user clicks something like “why is this stale?”

Algorithm (unchanged conceptually, just scoped):

1. Find a commit path from `commitOld` to `HEAD` (e.g. `git rev-list --ancestry-path` or `git log` first-parent chain).
2. Start with `(currentCommit, currentLine, currentSnippet)` = annotation’s original.
3. For each next commit in the path:

   * Get diff for `filePath`.
   * Build line map old→new.
   * Try to map `currentLine`.
   * If mapping + context check succeed:

     * Update `(currentCommit, currentLine, currentSnippet)` to this commit.
   * If mapping fails and heuristics also fail:

     * **This commit is the breaking commit**.
     * Stop.
4. Show UI:

   * Commit metadata (hash, message, author, date).
   * Before/after snippet around the annotation location.
   * Explanation: “This is where the code changed too much for us to track the annotation.”

Because this is per-annotation and only on demand, it can be slower than 500 ms and that’s fine.

---

## 5. Flow-level behavior & UX

Because you’re doing *one flow at a time*:

1. User opens command palette / panel: “Show flow…”
2. They pick a flow.
3. Extension:

   * Loads all annotations for that flow.
   * Groups by file; does one diff + AST parse per file.
   * Resolves each annotation via pipeline.

Given ≤30 annotations, typical pattern is:

* Maybe 1–3 files.
* Per file:

  * `git show` twice
  * `jsdiff` on a few hundred or thousand lines
  * One `web-tree-sitter` parse
* Per annotation:

  * Line map lookup (O(1))
  * A couple of string similarity calls
  * Maybe one or two fuzzy scans in worst case

On a reasonable machine, this is comfortably under 500 ms.

### VS Code UI ideas with flows

* **Flow picker view**:

  * Left sidebar listing flows.
  * Click flow → triggers hydration and opens relevant files with decorations.
* **Decoration semantics**:

  * Resolved annotations: normal gutter icon + inline phantom text.
  * Ambiguous ones: warning icon; clicking it opens candidate picker.
  * Unmapped: red-ish icon; clicking opens:

    * Original snippet from `commitOld`,
    * “Try to find breaking commit” action.

---

## 6. Performance notes (with your 500ms budget)

Totally back-of-envelope, but:

* `git show` and `jsdiff` on a 1k–2k line file: a few ms each.
* `web-tree-sitter` parse of that file: small Rust/WASM parser, typically <20–30 ms for modest files. ([tree-sitter.github.io][2])
* `cmpstr` similarity on ~5–15 lines of text: microseconds. ([GitHub][8])
* Sliding-window fuzzy search:

  * Worst case: O(N * windowSize) comparisons.
  * N ~ 1000 lines, windowSize ~ 7–11 → ~ 1000 similarity calls → still cheap.

Even if you do:

* 3 files
* AST + diff per file
* A few fuzzy scans per annotation

you’re almost certainly under 500 ms on any vaguely modern dev machine, especially since:

* Many annotations will resolve in the fast path.
* You can short-circuit once you hit a high-confidence match.

If you ever hit slow cases (huge files, very long commit chains), you can:

* Cap fuzzy search per annotation by time or max windows.
* Make commit-by-commit reconstruction *explicitly user-triggered*.

---

If you want, next step we can sketch a rough TypeScript module layout (e.g. `git.ts`, `diffMapper.ts`, `astAnchor.ts`, `resolver.ts`) so it’s clearer how to keep this manageable inside a VS Code extension.

[1]: https://www.npmjs.com/package/tree-sitter?utm_source=chatgpt.com "Node Tree-sitter"
[2]: https://tree-sitter.github.io/?utm_source=chatgpt.com "Tree-sitter: Introduction"
[3]: https://www.npmjs.com/package/tree-sitter-javascript?utm_source=chatgpt.com "tree-sitter-javascript"
[4]: https://github.com/tree-sitter/node-tree-sitter/issues/189?utm_source=chatgpt.com "Can't use in VS Code extension · Issue #189 · tree-sitter ..."
[5]: https://ast-grep.github.io/guide/introduction.html?utm_source=chatgpt.com "What is ast-grep?"
[6]: https://ast-grep.github.io/?utm_source=chatgpt.com "ast-grep | structural search/rewrite tool for many languages"
[7]: https://www.npmjs.com/package/string-similarity?utm_source=chatgpt.com "string-similarity"
[8]: https://github.com/komed3/cmpstr?utm_source=chatgpt.com "CmpStr is a lightweight, fast and well performing package ..."
