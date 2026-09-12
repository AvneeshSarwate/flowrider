# Diff Review documents

Select **Diff Review** in the FlowRider sidebar, then **Load HTML**. The diagram can also be displayed using the existing **FlowRider: Open in Editor** command. Click links to open a native diff. Reload rereads the HTML and resolves its references again.

Below the diagram, the **Changed files** tree lists the comparison's files with status markers. Expand or collapse folders and click a file to open its diff. Renames use the original path on the left; deletions show an empty right side. Working-tree comparisons include non-ignored untracked files. Use Reload to refresh the tree after changing files.

Use **Expand all**, **Collapse all**, and the filename filter to navigate large comparisons. The file list scrolls independently of the diagram. Drag the divider up or down to resize the panes; double-click it to restore the default split. The focused divider also supports Up/Down arrow keys and Home/End.

Agent generation contract: produce a self-contained HTML document with inline CSS and optionally inline SVG. Include exactly one JSON metadata block:

```html
<script type="application/json" id="flowrider-review">
{"version":1,"title":"My review","base":"FULL_BASE_SHA","head":"FULL_HEAD_SHA"}
</script>
<a href="flowrider://diff?path=src%2Fauth.ts&amp;line=87">Validate token</a>
```

`base` and `head` are Git commit references, resolved to fixed SHAs on load. Use `"head":"working-tree"` to compare saved files on disk against the base, including staged and unstaged changes. Unsaved buffers are excluded. Each working-tree click reads a fresh snapshot. No checkout occurs.

For PR-style comparisons, compute the merge base beforehand and put that SHA in `base`; the loader compares the exact specified endpoints. Both commits must exist locally. Optional `repository` is the name of an open workspace folder and is required when multiple folders are open. Paths are relative to that folder's Git repository root.

Links use 1-based right-side line numbers. `side=head` is optional. For renamed files, add `basePath=old%2Fname.ts`; `path` always identifies the right-side file. An absent base path renders as an empty left side (added file). Deleted files have no right-side entry point. Binary files are unsupported.

No line remapping or repair occurs. Out-of-range lines produce an error; in-range stale lines navigate literally. Users must keep diagrams synchronized with code.

HTML runs in an isolated frame with scripts disabled and sanitized markup. Inline styles, inline SVG and embedded data images are supported. External assets, scripts, forms and external navigation are disabled. Wrap SVG shapes in `<a href="flowrider://diff?...">`; an SVG embedded as an image cannot provide clickable internal links. These links work inside FlowRider, not as system-wide external URLs.

See `review-example.html` for a working-tree example targeting this repository.

## Canvas documents

Set `mode: "canvas"` in the JSON metadata and use exactly one inline `svg[data-flowrider-canvas]` with a positive `viewBox`. The plugin supplies Fit, actual size, zoom buttons, pinch/Ctrl-wheel zoom, scroll panning and Space-drag. Initial view fits the canvas. Resizing while fitted refits it; manual zoom and pan survive pane resizing and code navigation. Zoom is limited to 2%–800%. `mode: "document"` (the default) retains ordinary HTML scrolling.

The shareable authoring skill is [flowrider-review-docs](../skills/flowrider-review-docs/SKILL.md). Manual fixtures and a gesture checklist are in [test_reviews/manual-checks.md](test_reviews/manual-checks.md).

## Diagrams within prose

In document mode, add `data-flowrider-canvas` to any inline SVG with a positive `viewBox` to get an independent viewer in place. Multiple non-nested marked SVGs are supported. Each viewer has zoom/Fit/actual-size controls and a bottom resize divider. Ordinary wheel scrolling reads the prose; pinch/Ctrl-wheel zooms locally and Space-drag pans a focused diagram. Leave SVGs unmarked for normal rendering. Avoid fixed-size or overflow-clipping wrappers around marked SVGs.

## Automated checks

Run `npm run build` and `npm test`. If the test runner cannot locate the downloaded VS Code executable, set `FLOWRIDER_TEST_CODE` to an installed executable. On this Mac the verified command is:

```sh
FLOWRIDER_TEST_CODE='/Applications/Visual Studio Code.app/Contents/MacOS/Code' npm test
```

The suite creates an isolated temporary Git repository and verifies historical contents, added-file diffs, working-tree snapshots, invalid lines, editor group reuse, and native right-side selection.
