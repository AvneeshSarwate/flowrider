# Flow Rider

A VS Code extension for visualizing and navigating code flows. Write specially formatted comments to describe how data or control flows through your codebase, and Flow Rider will parse them into interactive Mermaid diagrams.

## Features

### Flow Comments

Add comments anywhere in your code using this format:

```
TAG FLOW_NAME : CURRENT_POS => NEXT_POS
```

**Example:**
```javascript
// #@#@#@ auth-flow : validate_token => check_permissions
function validateToken(token) {
  // ...
}

// #@#@#@ auth-flow : check_permissions => authorize
function checkPermissions(user) {
  // ...
}

// #@#@#@ auth-flow : check_permissions => deny
function denyAccess() {
  // ...
}
```

- **TAG**: A unique string to identify flow comments (default: `#@#@#@`)
- **FLOW_NAME**: The name of the flow (groups related comments into one diagram)
- **CURRENT_POS**: The "logical node" where this comment is located
- **NEXT_POS**: The next "logical node" in the flow

Flows can branch, merge, and contain cycles.

### Sidebar View

Click the Flow Rider icon in the activity bar to open the sidebar. You'll see:

- **Flow List**: All detected flows as collapsible sections
- **Mermaid Diagrams**: Expand a flow to see its visual graph
- **Interactive Nodes**: Click any node to see all locations where it appears
- **Jump to Code**: Click a location to open that file at the exact line

### Automatic Scanning

Flow Rider automatically rescans your workspace when you save any file. The scan uses ripgrep for fast searching across large codebases.

## Requirements

- **ripgrep**: Must be installed and available in your system PATH
  - macOS: `brew install ripgrep`
  - Ubuntu/Debian: `apt install ripgrep`
  - Windows: `choco install ripgrep` or `scoop install ripgrep`

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `flowrider.tag` | `#@#@#@` | Tag used to identify flow comments |
| `flowrider.debounceMs` | `500` | Delay (ms) to debounce workspace rescans after saves |

## Usage Tips

- Use descriptive node names that reflect what happens at each point
- Group related functionality into the same flow
- Use multiple flows to document different aspects of your system (e.g., `auth-flow`, `data-flow`, `error-handling`)
- The sidebar shows parsing errors at the bottom if any comments are malformed

## Known Issues

- Requires ripgrep to be installed separately
- Very large codebases may experience slight delays during scanning

## Release Notes

### 0.0.1

Initial release:
- Flow comment parsing with configurable tag
- Mermaid diagram visualization
- Interactive node clicking with location popup
- Jump-to-code navigation
- Automatic workspace scanning on file save
- Parsing error display
