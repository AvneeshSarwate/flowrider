---
name: flowrider-review-docs
description: Create self-contained HTML and inline SVG review diagrams for FlowRider, with commit comparison metadata and exact right-side code links.
---

Create a review explanation that loads in FlowRider's Diff Review panel. Read the relevant code and verify links against the exact right-side revision before delivering it.

## Document contract

Use self-contained HTML with inline CSS and this JSON block, exactly once:

```html
<script type="application/json" id="flowrider-review">
{"version":1,"title":"Review title","base":"BASE_COMMIT_SHA","head":"HEAD_COMMIT_SHA","mode":"canvas"}
</script>
```

Both commits must be available locally. For PR-style comparisons, resolve the merge base and use its SHA for `base`. Use `head: "working-tree"` for saved files, including staged and unstaged changes. Unsaved buffers are excluded. Optional `repository` is an open workspace folder name, required in multi-root workspaces. Paths are relative to that folder's Git root.

For canvas mode, include exactly one top-level inline SVG marked `data-flowrider-canvas`, with a finite positive `viewBox`. Put all visible content inside it. Example:

```html
<svg data-flowrider-canvas viewBox="0 0 1600 900" xmlns="http://www.w3.org/2000/svg">
  <a href="flowrider://diff?path=src%2Fauth.ts&amp;line=87">
    <rect x="40" y="40" width="300" height="100" rx="12"/>
    <text x="60" y="95">Validate token</text>
  </a>
</svg>
```

FlowRider owns the root SVG's size, position and transform. Do not override them with CSS, especially `!important`. Choose a canvas large enough for content and include all shapes, labels, and edge markers inside its bounds. Give nodes descriptive labels, clear groupings, generous spacing, and readable text at actual size. The plugin initially fits the map; it supports pinch zoom, scroll pan, Space-drag, fit and actual-size controls. Do not implement gesture handlers, navigation toolbars or scripts in the document.

Use `mode: "document"` (or omit mode) for prose mixed with diagrams. Mark each interactive inline SVG with `data-flowrider-canvas` and give each a finite `viewBox` with positive width and height. Multiple marked SVGs are allowed in document mode; do not nest marked SVGs inside one another. Unmarked SVGs remain ordinary illustrations.

The plugin inserts a separate viewer at each marked SVG's location, with local zoom, Fit, actual-size controls and a vertically resizable viewport. Normal wheel scrolling continues through the prose; pinch/Ctrl-wheel zoom and Space-drag operate on the diagram. Each viewer preserves its own transform. Authors supply no navigation code.

Place marked SVGs in normal-flow containers such as `figure` or `div` that allow their contents to determine height. Avoid fixed-width or fixed-height wrappers, clipping, and custom overflow scrollers around them. For grid/flex columns, allow shrinking with `min-width: 0`. Do not target the plugin's `.flowrider-*` wrappers or override the SVG's size/position/transform with `!important`. Give every diagram an accessible label and preferably a caption outside the SVG. Reuse SVG IDs only if they are unique across the entire HTML document.

## Links and validation

Use real anchors around SVG nodes or text. `path` is URL-encoded and `line` is a positive 1-based line on the right side. Escape `&` as `&amp;` in HTML attributes. Optional `basePath` identifies a pre-rename path. Deleted-only lines have no right-side target; link to surviving callers or explain the deletion in prose.

No line remapping occurs. Validate each path and line against the specified head or saved file. Prefer immutable SHAs for shared reviews. Report missing commits or uncertain entry points rather than inventing targets.

Scripts, remote assets, forms and external navigation are disabled. Use inline SVG rather than an SVG image when internal links must work. Avoid external fonts. Do not embed secrets or credentials in the artifact.

Before handing off: validate the JSON, exactly one marked root in canvas mode or non-nested marked roots in document mode, numeric viewBox bounds, absence of clipped content, and all link targets. Provide the HTML file and its comparison endpoints. A visual review in FlowRider should check Fit, zoom to readable text, code links, and panning over a linked node without navigation. For mixed documents, also check that zooming one diagram leaves others unchanged and ordinary scrolling over a diagram continues through the prose.
