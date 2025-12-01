this is a VS code extension to help make it easier to understand and navigate codebases. it allows you to write specially formatted comments and then parse them out into a DAG that describes data flow through a codebase. it contributes a sidebar view that uses mermaid diagrams to display these flows and click into them and jump to different parts of the codebase

### phase 1
- be able to parse out "flow comments" 
- flow comments are comments of format TAG FLOW_NAME : CURRENT_POS => NEXT_POS
  - TAG is some relatively rare string use to effiently search for flow comments (e.g "#@#@#@")
  - FLOW_NAME is the name of the flow - a directed graph of points in the code 
  - CURRENT_POS is the current position - if you add a comment to a place in the code, the place you're adding it to is CURRENT_POS
  - NEXT_POS is where this flow can go next. 
  - there can be multiple comments with the same CURRENT_POS or NEXT_POS (because flows can branch out, or different paths can converge to the same spot). there can also be cycles

Flow comments can describe any kind of flow - the goal is to be an easy-to-write, high level utility for sharing how parts of a codebase work. 

the first pass of features for the extension should support the follwing:
- automatically search for all flow comments and assemble all DAGs for each flow (should search with ripgrep every time a file is saved - for now, assume the user has it installed on their system). the TAG to use will be in the extension settings - the default will be #@#@#@
- have a UI that lists all of the flows
- each flow will be a collapsible section - expanding the name shows a mermaid diagram of the flow. clicking on a node shows you a pop up scrollable box showing you all of the files/lines with a flow comment having that node as CURRENT_POS
- clicking on one of those file/line entries opens that file/line in vscode

use zustand for global state management as necessary

this should be a webview view (ie a sidebar panel like file browser or search)

keep the general code design simple and clean but extensible, like a senior engineer working on an MVP rather than a throwoaway prototype 

### phase 2