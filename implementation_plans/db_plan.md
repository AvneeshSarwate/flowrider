Here’s a concrete implementation plan that:

* **Only implements single-repo behavior for now**
* But **bakes in** the DB/schema + settings you’ll need for multi-repo & cross flows later

I’ll keep it focused on “what to build” rather than deep restatements of previous design.

---

## 1. Goals & Scope (v0)

**In-scope for this pass**

* Mono-repo (one git repo ↔ one VS Code workspace folder).
* Single local DB file: `.codeflows/flows.jsonc`.
* Parse `@flow` comments from the repo and export them into the DB.
* Load a flow from the DB and hydrate it into the open files (decorations / ghost comments).
* Use a DB schema that already supports:

  * `repoId`
  * cross-repo flows
  * future global DBs

**Out-of-scope for this pass**

* Actually handling multiple repos or a global DB.
* Fancy heuristics for remapping (just stub or implement a simple version).
* Commit-by-commit “breaking commit” drilldown.

---

## 2. DB Schema (monorepo, but multi-repo-capable)

### 2.1 Root file structure

File: `.codeflows/flows.jsonc`

```jsonc
{
  "schemaVersion": 1,
  "dbScope": "repo", // or "global" in the future
  "dbRepoId": "github.com/org/your-repo", // optional now, but populate it

  "meta": {
    "createdAt": "2025-01-12T10:00:00.000Z",
    "toolVersion": "0.1.0"
  },

  "flows": {
    "github.com/org/your-repo::SIGNUP_FLOW": {
      "id": "github.com/org/your-repo::SIGNUP_FLOW",
      "name": "SIGNUP_FLOW",
      "description": "User signup through /signup",
      "tags": ["signup", "auth"],
      "createdAt": "2025-01-12T10:01:00.000Z",
      "updatedAt": "2025-01-12T10:01:00.000Z",

      // flow-level cross flags
      "declaredCross": false, // true if any annotation had `cross` in this DB
      "isCross": false,       // effective cross-ness (may be adjusted in multi-DB world later)

      "annotations": [
        {
          "id": "a1",

          // repo identity
          "repoId": "github.com/org/your-repo", // in local DB you *can* omit; see below

          // code location
          "filePath": "src/auth/LoginForm.tsx",
          "commitHash": "abc123...",
          "line": 42,
          "column": 4,

          // context for remapping
          "contextBefore": [
            "  const handleSubmit = async () => {",
            "    setLoading(true);"
          ],
          "contextLine": "    const result = await api.signup(email, password);",
          "contextAfter": [
            "    setLoading(false);",
            "    if (!result.ok) {"
          ],

          // AST-ish anchoring (future)
          "symbolPath": "LoginForm.handleSubmit",
          "nodeType": "call_expression",

          // flow graph bits
          "flowName": "SIGNUP_FLOW",
          "currentNode": "WEB_SIGNUP_FORM",
          "nextNode": "API_CREATE_USER",
          "crossDeclared": false, // whether *this* comment had the 'cross' keyword

          // misc
          "note": "Call to signup API",
          "rawComment": "@flow SIGNUP_FLOW : WEB_SIGNUP_FORM => API_CREATE_USER",
          "meta": {}
        }
      ]
    }
  }
}
```

**Monorepo simplification**

* In a **local** DB:

  * `dbScope = "repo"`
  * `dbRepoId` is always set.
  * `repoId` on annotation is optional; if omitted, the extension treats `repoId = dbRepoId`.
* For now, you can be lazy and omit `repoId` on annotations; just make sure the schema allows it.

---

## 3. VS Code Extension Architecture (v0)

### 3.1 Modules

Rough logical modules:

1. **`flowStore.ts`**

   * Load/save `.codeflows/flows.jsonc`
   * Handle migrations (even if only schemaVersion=1 exists now)
   * In-memory representation of flows

2. **`commentParser.ts`**

   * Parse `@flow` comments in source files
   * Extract:

     * `flowName`
     * `currentNode` / `nextNode`
     * `crossDeclared`
   * Return parsed `AnnotationLike` structs

3. **`exporter.ts`**

   * Scan repo for flow comments
   * Group by `flowName`
   * Build `Flow` objects (including cross flags)
   * Write DB via `flowStore`

4. **`loader.ts` / `hydrator.ts`**

   * Take a `Flow` from `flowStore`
   * Map annotations to current file locations (simple version first)
   * Create VS Code decorations / ghost comments

5. **`settings.ts`**

   * Read configuration:

     * Tag string (`@flow` by default)
     * Local DB path
     * (Later) global DB path

6. **`git.ts`**

   * Helper for:

     * Getting `dbRepoId` from git remote
     * Getting current commit hash

---

## 4. Step-by-step Implementation Plan (monorepo)

### Step 1: Settings & configuration

Define extension settings (in `package.json`):

* `codeFlows.tag` (string, default `"@flow"`)
* `codeFlows.dbPath` (string, default: `".codeflows/flows.jsonc"`)
* `codeFlows.contextLines` (number, default `3`)

Later:

* `codeFlows.globalDbPath` (string | null) — define now or later; it doesn’t hurt to define now but ignore it in v0.

### Step 2: `flowStore` for a single repo

Responsibilities:

* Determine local DB path: `${workspaceFolder}/${dbPath}`.

* On first access:

  * If file exists:

    * Read it.
    * Parse JSONC → object.
    * Run migrations (if `schemaVersion` < current).
  * If file does not exist:

    * Create an in-memory object:

      ```ts
      {
        schemaVersion: 1,
        dbScope: "repo",
        dbRepoId: inferRepoIdFromGit(workspaceFolder),
        meta: { createdAt: now, toolVersion },
        flows: {}
      }
      ```

* Provide API:

  ```ts
  interface FlowStore {
    load(): Promise<void>;
    save(): Promise<void>;

    getAllFlows(): Flow[];
    getFlowById(id: string): Flow | undefined;
    getFlowsByName(name: string): Flow[];

    upsertFlow(flow: Flow): void;
    replaceAllFlows(flows: Flow[]): void; // for full export
  }
  ```

Monorepo v0 behavior:

* You’ll mostly use `replaceAllFlows` when exporting, and `getAllFlows` / `getFlowsByName` when loading.

### Step 3: Comment parser (`commentParser.ts`)

Input: a `TextDocument` + config `tag` (e.g. `"@flow"`).

Task: find comments that match your flow syntax:

```ts
// @flow [cross] FLOW_NAME : CURRENT_NODE => NEXT_NODE
```

Rough parser:

1. For each line, check if it contains the tag:

   ```ts
   const idx = lineText.indexOf(tag);
   if (idx === -1) continue;
   const body = lineText.slice(idx + tag.length).trim();
   ```

2. Split at `:`:

   ```ts
   const [left, right] = body.split(":");
   if (!right) return; // invalid

   const leftTokens = left.trim().split(/\s+/);
   const hasCross = leftTokens[0].toLowerCase() === "cross";
   const flowName = hasCross ? leftTokens[1] : leftTokens[0];

   const [currentNode, nextNode] = right.split("=>").map(s => s.trim());
   ```

3. Build a parsed annotation:

   ```ts
   interface ParsedFlowComment {
     flowName: string;
     currentNode: string;
     nextNode: string;
     crossDeclared: boolean;
     line: number;              // 1-based
     column: number;
     rawComment: string;
   }
   ```

4. Also gather context lines:

   * Use `document.lineAt(line - k .. line + k)` for `contextBefore/After`.

The parser doesn’t care about repo right now; that’s handled later.

### Step 4: Export flows (single repo)

Command: `"codeFlows.exportFlows"`

Behavior:

1. Ensure `flowStore.load()` is called.

2. Determine target files to scan:

   * E.g. use `git ls-files` to list tracked files, filtered by extensions (`.ts`, `.tsx`, `.js`, `.py`, etc.).
   * Or for v0, only scan currently open documents and a couple of glob patterns.

3. For each file:

   * Open as `TextDocument`.
   * Run `parseDocumentForFlowComments(document)` → `ParsedFlowComment[]`.

4. For each parsed comment:

   * Convert to `Annotation`:

     ```ts
     const repoId = flowStore.dbRepoId; // from store
     const commitHash = await git.getHeadCommit(workspaceFolder);

     const annotation: Annotation = {
       id: generateAnnotationId(repoId, filePath, line, flowName),
       repoId, // optional to store; but you may choose to set it
       filePath,
       commitHash,
       line,
       column,
       contextBefore,
       contextLine,
       contextAfter,
       symbolPath: null, // can fill with AST later
       nodeType: null,
       flowName,
       currentNode,
       nextNode,
       crossDeclared,
       note: "",
       rawComment,
       meta: {}
     };
     ```

5. Group annotations by `flowName`:

   ```ts
   const grouped: Map<string, Annotation[]> = new Map();
   ```

6. For each `flowName`, build a `Flow`:

   ```ts
   const declaredCross = annotations.some(a => a.crossDeclared);
   const isCross = declaredCross; // monorepo v0: same

   const flowId = `${flowStore.dbRepoId}::${flowName}`;

   const flow: Flow = {
     id: flowId,
     name: flowName,
     description: existingFlow?.description ?? "",
     tags: existingFlow?.tags ?? [],
     createdAt: existingFlow?.createdAt ?? now,
     updatedAt: now,
     declaredCross,
     isCross,
     annotations
   };
   ```

   * If there was already a flow with that `id` in the store, you can preserve non-derived metadata like `description`, `tags`, etc.

7. Write flows back to store:

   * For v0 mono-repo, simplest is:

     ```ts
     flowStore.replaceAllFlows(Array.from(newFlows.values()));
     await flowStore.save();
     ```

   * Later, you can be more incremental (only replace flows touched by this export).

### Step 5: Load & hydrate flows (single repo)

Command: `"codeFlows.loadFlow"`

1. `await flowStore.load()`.

2. Let the user pick a flow (QuickPick list of `Flow.name` with maybe `[local]` suffix).

3. For the selected flow:

   * For each annotation:

     * Open `filePath` as `TextDocument`.
     * Try to place an annotation in the editor:

       **v0 simple mapping**:

       * Just use `annotation.line` directly.
       * Optionally sanity-check that the `contextLine` is the same as the current file line text.

         * If mismatch, mark annotation as “stale” in UI (e.g. different decoration color).

       **Hook point for later heuristics**:

       * Wrap this in a function `remapAnnotation(annotation, document)` so you can swap in diff/AST logic later without touching DB.

4. Show annotations as:

   * Gutter icons,
   * Inline decoration/hover showing:

     * `FLOW_NAME : CURRENT_NODE => NEXT_NODE`
     * Any `note` text.

You don’t need multi-repo logic here yet; just use `filePath` inside the current workspace and assume a single repo.

### Step 6: Basic migrations scaffold

Even if you only have `schemaVersion: 1` now, add the machinery:

```ts
const CURRENT_SCHEMA_VERSION = 1;

function migrate(data: any): any {
  let version = data.schemaVersion ?? 1;
  while (version < CURRENT_SCHEMA_VERSION) {
    switch (version) {
      case 1:
        data = migrateV1toV2(data);
        version = 2;
        break;
      default:
        throw new Error(`No migration for version ${version}`);
    }
  }
  data.schemaVersion = CURRENT_SCHEMA_VERSION;
  return data;
}
```

Stub `migrateV1toV2` for now. This ensures you can evolve schema without blowing up older DBs.

---

## 5. Minimal Git helper (`git.ts`)

For monorepo v0:

* `getRepoId(workspaceFolder): Promise<string>`

  * Run `git remote get-url origin`.
  * Normalize to a slug like `github.com/org/repo`:

    * Strip `git@` or `https://`.
    * Strip `.git` suffix.
* `getHeadCommit(workspaceFolder): Promise<string>`

  * `git rev-parse HEAD`.

You call `getRepoId` when creating a new DB, and `getHeadCommit` when exporting annotations.

---

## 6. Testing & ergonomics

* Test exporting + reloading in a small sample repo:

  * change code slightly and see how annotations behave in the simple mapper.
* Ensure DB is pretty-printed for easy diffs (`JSON.stringify(data, null, 2)`).
* Consider adding a “View raw flows.jsonc” command to help debug.

---

## 7. Future Work: Multi-repo & Global Flows (spec outline)

This is **not** implemented now, but the schema you just adopted should make it straightforward.

### 7.1 Multi-DB / multi-repo support

* Recognize multiple workspace folders (multi-root):

  * Each with its own local DB (`dbScope: "repo"` + `dbRepoId`).
* Add `codeFlows.globalDbPath` setting:

  * Path to a global DB (`dbScope: "global"`) that may live in another repo.

### 7.2 Flow identity & cross resolution

Use the fields you already have:

* `Flow.name` – human name, used in comments.
* `Flow.id` – stable identifier (e.g. `"github.com/org/repo::SIGNUP_FLOW"` or a UUID).
* `Flow.declaredCross` – whether *this DB’s* annotations declared `cross`.
* `Flow.isCross` – computed “effective” cross-ness.

Resolution rules (as you sketched):

1. Aggregate flows from all DBs in memory.
2. For each `flowName`:

   * If **no** `declaredCross` anywhere → treat flows as repo-local; they’re all distinct.
   * If **any** has `declaredCross: true`:

     * Treat that `flowName` as global:

       * Build a logical “global flow” that aggregates annotations from all DBs for that name.
     * Set `isCross = true` for all of them in-memory (and persist later if desired).

You can then:

* Materialize global flows into the global DB (write them out).
* Or treat the global DB as canonical and merge local DB flows into it.

### 7.3 Repo mapping & hydration across repos

* Use `repoId` on annotations to determine which workspace folder they belong to.
* If a referenced repo isn’t open:

  * Mark those annotations as unresolved / “requires repo X”.

### 7.4 UI semantics for multi-repo

* Group flows in the UI as:

  * Local flows (non-cross, scoped to current repo).
  * Global flows (cross).
  * Inferred globals (if no global DB is configured but multiple repos with same name + `cross` are open).
* Show badges:

  * “Cross” (from `isCross`).
  * “Global DB missing” (when `declaredCross` is true but `globalDbPath` unset).

### 7.5 Syncing local ↔ global DB

* Define strategies:

  * **Push**: from local DBs, export cross flows into global DB.
  * **Pull**: load from global DB and optionally project back into local DB (for discoverability).
* Use `flow.id` and `repoId` to avoid dupes and maintain stable identities.

---

With this plan, you can build a solid monorepo v0:

* Single local DB.
* Clean `@flow` parsing.
* Export + load/hydrate.

And because you’ve already baked in:

* `dbScope`
* `dbRepoId`
* `repoId`
* `id` vs `name`
* `declaredCross` / `isCross`

you won’t need to trash the DB format when you graduate to multi-repo + global flow DBs later—you’ll just flesh out the resolution logic and UI around it.
