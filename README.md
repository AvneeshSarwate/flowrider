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

## Development

### Quick Start

1. **With Hot Reload (recommended for webview development):**
   - Select **"Run Extension (Dev + HMR)"** from the Run and Debug dropdown
   - Press F5
   - This starts the Vite dev server and TypeScript watcher in parallel

2. **Standard build:**
   - Press F5 (uses default "Run Extension" config)
   - Builds webview and watches extension TypeScript

### Hot Reload Behavior

| Change Type | Reload Behavior |
|-------------|-----------------|
| React/webview code (`webview-ui/src/`) | **Automatic** — Vite HMR updates instantly |
| Extension TypeScript (`src/`) | Reload dev window (`Cmd+R` / `Ctrl+R`) |

### Manual Commands

```bash
# Start Vite dev server for webview
cd webview-ui && npm run dev

# Watch extension TypeScript
npm run watch

# Build everything for production
npm run build
```

### Port Configuration

The dev server uses port `5199` by default (non-standard to avoid conflicts). If needed, override with:

```bash
FLOWRIDER_DEV_PORT=5200 npm run dev  # in webview-ui/
```

The extension and Vite config both read from `FLOWRIDER_DEV_PORT`.

### Building & Installing Locally

**Prerequisites:** [Node.js/npm](https://nodejs.org/) and the `code` CLI command (in VS Code: `Cmd+Shift+P` → "Shell Command: Install 'code' command in PATH")

```bash
./build_and_install_locally.sh
```

This installs dependencies, builds the extension, packages it as a `.vsix`, and installs it to VS Code. Reload VS Code after installation.

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
