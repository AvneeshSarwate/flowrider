
# Preamble: Code Flow Annotations & Remapping

## 1. Project Overview

We want a way to **document logical flows through a codebase** using specially formatted comments, without permanently cluttering source files.

High-level behavior:

* Developers annotate flow steps with inline comments like:

  ```ts
  // #@#@#@ SIGNUP_FLOW : WEB_SIGNUP_FORM => API_CREATE_USER
  ```

  (Optionally `cross` for cross-repo flows.)

* A VS Code extension scans the code, extracts these flow annotations into a **separate flow database file**, and removes the need to keep comments inline long-term.

* When a user wants to inspect a flow, the extension **hydrates** it back into the editor: it finds where each annotated piece of code currently lives and overlays decorations / phantom comments in the right spots.

The tricky bits:

* **Code changes over time**: lines move, blocks refactor, functions rename, files split/merge.
* Flows may eventually span **multiple repos**.
* We want flow definitions to live in **version-controlled, human-diffable files**, and the system should be robust to schema evolution.

So the project splits into two major concerns:

1. A **flow database and repo model**: how flows and annotations are stored, versioned, and configured (local vs global, mono vs multi-repo).
2. An **annotation remapping engine**: given a stored annotation (file, commit, context), how to map it to the current working tree, detect moves, propose candidates, or mark it stale.

The detailed design docs you’ll implement cover those two areas separately. This preamble just frames the overall goals and how they fit.


IMPORTANT
A basic UI for this already exists in this repo - it searches for TAG (#@#@#@ by default), creates the DAG, and visualizes it with a mermaid diagram, allowing the user click on the diagram to navigate to code

---

## 2. Goals & Problem Statement

### 2.1 Primary goals

1. **Flow documentation without code pollution**

   * Let developers describe logical flows (e.g., “login happy path”, “signup + email verification”) using lightweight inline comments.
   * Extract those comments into a separate DB so the main code stays clean.

2. **Stable mappings across code evolution**

   * When code changes, flows should remain attached to the *logical* code locations as much as possible.
   * If we can no longer confidently map an annotation, we should:

     * indicate it’s stale,
     * show where it *used* to be,
     * and ideally identify the commit where mapping broke.

3. **Shareable, version-controlled artifacts**

   * Flows live in text-based files (`flows.jsonc`) committed to git.
   * The files are easy to diff and review in PRs.
   * Schema evolution should be explicit and backwards-compatible via simple migrations.

4. **Cross-repo flows (future)**

   * Eventually, a flow may span multiple services/repos.
   * We need a DB schema that can represent this cleanly even if v0 only deals with a single repo.

5. **Good UX in VS Code**

   * Commands to:

     * export flows from comments → DB,
     * load flows from DB → hydrated editor decorations.
   * Reasonable performance: hydrating a single flow (≤ ~30 annotations) should be under ~500 ms on a normal dev machine.

### 2.2 Core problems to solve

1. **Persistence model**

   * How to represent flows and annotations in one or more JSONC files.
   * How to tie annotations to specific code locations (file path, commit hash, line, context).
   * How to encode repo identity for multi-repo scenarios.

2. **Remapping logic**

   * Given an annotation created at `(repoId, filePath, commitHash, line, context…)`, find where it “should” land in the current working tree:

     * Fast path: direct diff-based line remapping.
     * Heuristic path: detect moved / modified code via context and AST.
     * Fallback: mark stale + optionally find the commit where mapping broke.

3. **Single-repo vs multi-repo behavior**

   * v0: simple monorepo semantics with a single flow database per repo.
   * Future: optional global DB and cross-repo flows, without breaking the original schema.

---

## 3. Architecture at a Glance

At a high level, the system has these pieces:

1. **Comment Syntax & Parsing**

   * Inline comments in code mark flow steps:

     ```ts
     // #@#@#@ [cross] FLOW_NAME : CURRENT_NODE => NEXT_NODE
     ```

   * A parser extracts:

     * `flowName`
     * `currentNode`, `nextNode`
     * whether `cross` was present (`crossDeclared`)

   * It also records:

     * file path
     * line/column
     * local context (surrounding lines)
     * raw comment text

  IMPORTANT!
  This is mostly already implemented, but the option [cross] field is not yet supported

2. **Flow Database (DB)**

   * Stored as a JSON/JSONC file, typically `.codeflows/flows.jsonc` in a repo.
   * Holds:

     * `schemaVersion`, `dbScope` (“repo” vs “global”), `dbRepoId`
     * A map of `flows`:

       * `id` (stable flow ID)
       * `name` (flow name used in comments)
       * `declaredCross` (whether any annotation in this DB had `cross`)
       * `isCross` (effective cross-ness once multi-DB resolution is in place)
       * `annotations` (each with filePath, commitHash, line, context, graph info, etc.)
   * Designed so a **single-repo** DB today can be merged into a **multi-repo** global DB later without changing the core shapes.

3. **Export Pipeline (code → DB)**

   * Scans tracked files for flow comments.
   * Parses them into annotation records.
   * Groups by `flowName` to form flows.
   * Writes flows into the local DB (creating or updating them).
   * Sets `dbRepoId` (from git remote) and `declaredCross`/`isCross` fields.

4. **Remapping Engine (DB → current code)**

   * For a given annotation:

     * Loads the old version of the file (for `commitHash`) and the current version.
     * Computes a diff and a per-line mapping (fast path).
     * If the line is mapped cleanly and context matches closely enough → **auto-adjust**.
     * If not, uses heuristics:

       * search for the context snippet,
       * fuzzy match across the file,
       * restrict to function/symbol scope using AST,
       * propose candidate locations.
     * If still unresolved:

       * marks the annotation “stale”
       * optionally finds the *breaking commit* via commit-by-commit remapping.
   * This is used during flow hydration to decide where to place decorations.

5. **Hydration & VS Code UI**

   * Given a selected flow:

     * Applies remapping to each annotation.
     * Opens relevant files.
     * Draws decorations in the editor:

       * for auto-mapped annotations,
       * for candidate locations that need user confirmation,
       * for stale locations with a warning badge.
   * Provides commands:

     * “Export flows” (rebuild DB from comments),
     * “Load/Hydrate flow” (show in editor),
     * (future) “Inspect stale annotation” (show breaking commit, etc.).

---

## 4. How the Two Design Docs Fit Together

There are two deeper design docs you’ll implement from:

### Document 1 – **Flow Database, Repo Model, and Mono-Repo Implementation**

This doc defines the **data model and persistence**. it is in the file db_plan.md

Key points:

* DB format: single JSON/JSONC file with:

  * `schemaVersion`
  * `dbScope` (“repo” or “global”)
  * `dbRepoId` (git-based repo slug)
  * `flows` map keyed by stable `id`:

    * `id`, `name`
    * `declaredCross`, `isCross`
    * `annotations` with:

      * `repoId` (optional in local DBs → defaults to `dbRepoId`)
      * `filePath`, `commitHash`, `line`, `contextBefore/Line/After`
      * `flowName`, `currentNode`, `nextNode`
      * `crossDeclared`
      * optional AST hints (`symbolPath`, `nodeType`)
      * `rawComment`, `note`, `meta`
* Single-repo v0 behavior:

  * One DB per repo, auto-discovered.
  * Simple export/import commands.
  * No global DB or cross-repo hydration yet.
* Future multi-repo behavior:

  * Optional global DB containing merged flows.
  * Rules for flow name reuse and `cross`:

    * If a name is never `cross` → flows are repo-local.
    * If any annotation of that name is `cross` → treat that name as cross-repo.
  * Use `repoId` to map annotations to workspace folders.
  * Distinguish `declaredCross` (where we saw `cross`) vs `isCross` (resolved cross-ness).

**This doc is about the shape of data and how the VS Code extension reads/writes it, not about remapping logic.**

---

### Document 2 – **Annotation Remapping & Movement Heuristics**

This doc defines the **remapping engine**. it is in the move_matching.md file

Key points:

* How to build a line mapping between an “old” file (at `commitHash`) and the current file:

  * Using git diffs or `jsdiff`.
* How to classify outcomes:

  * `auto` (direct map + high context similarity),
  * `candidates` (suggested new locations),
  * `unmapped` (stale).
* Heuristics for detecting moved code:

  * Exact context snippet search.
  * Exact context-line search + surrounding context.
  * Fuzzy windowed search with string similarity.
  * AST-based scoping using `web-tree-sitter` (and optionally ast-grep).
* Commit-by-commit remapping (on-demand) to find which commit broke tracking.
* Performance expectations: hydrating a single flow with ≤ 30 annotations under ~500 ms by reusing diffs/ASTs per file.

**This doc is focused purely on algorithms and their Node-friendly library choices.**
It assumes the `Annotation` schema (commitHash, filePath, context, symbol hints) is available from the DB.

---

With this preamble plus the two detailed design docs (remapping engine + DB/repo model), a coding agent should have a clear picture of:

* **Why** the system exists,
* **What** problems it solves,
* And **how** the two major subsystems (storage vs remapping) relate and interact.


I want to implement a robust version of the mono-repo version of this - the DB schema will support multi-repo work, but we will ignore teh business logic of all of that for now. I want robust implementations of the heuristics described in the implementation plan for the remapping engine.
