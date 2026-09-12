# Canvas navigation acceptance checks

Reload VS Code after installation. Open this repository, then use **FlowRider → Diff Review → Load HTML**. These fixtures compare `HEAD` with saved working-tree files in this repo; they require no checkout or special commits.

1. **canvas-large.html** — a 2400 × 1600 map with 20 linked nodes. The whole map should fit initially. Pinch on the trackpad or use Ctrl+wheel to zoom near the pointer. Ordinary trackpad scrolling pans. Hold Space and drag over a node: the map should move without opening code. Release Space and click a node: its diff should open. Return to the diagram: zoom and position should be unchanged. Use Fit to recover the whole map and 100% for actual size.
2. **canvas-wide.html** — a 4800 × 520 map. Test horizontal trackpad pan and finding the far-right node. Drag the diagram/tree divider and resize the sidebar: in Fit mode the map refits; after manual zoom/pan the current transform stays intact. Double-click the pane divider to restore the split. Make sure the file tree still scrolls independently.
3. **../review-example.html** — existing normal HTML document. It should retain normal document scrolling, clickable links, and no canvas toolbar.
4. **canvas-invalid.html** — deliberately missing SVG bounds. Expect a visible error about a positive viewBox, with Load HTML still usable to recover by opening a valid file.

Keyboard checks: click inside the canvas, then use +/− to zoom, F to fit, 0 for actual size, and arrow keys to pan. Tab to the toolbar to use the same operations without gestures. Touch hardware, if available: two-finger pinch should zoom and one-finger drag should pan; a tap should open a node.

For mixed prose, load **mixed-prose-diagrams.html**. All six diagrams now have local plugin controls. Zoom the first diagram and confirm the others keep their own views. Ordinary wheel scrolling over a diagram should continue reading the document; trackpad pinch/Ctrl-wheel should zoom locally. Click a diagram to focus it before using Space-drag or keyboard navigation. Drag the bottom divider to enlarge its viewport. Check the wide, tall, dense, and two-column sections in both narrow and wide panels. The authoring skill documents the required marker and container constraints.

Subjective checks: is trackpad zoom too fast or slow, do labels stay legible, is the drag gesture comfortable, and is the initial Fit useful in your normal sidebar width? Automated events cannot establish the feel of a physical trackpad.
