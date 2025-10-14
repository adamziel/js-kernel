# AGENTS.md

## Project overview
- This is a client-side implementation of the Node.js APIs. It
  uses actual Node.js code modules source code with browser-specific
  internal bindings. It is meant to be used in the browser. Only
  rely on APIs that are available in the browser.
- getInternalModule() bindings are implemented in the 
  client-boot.js file. Again, they are meant to be used 
  in the browser only.

## Dev environment tips
- Ignore files in the `modules` directory. They are built
  artifacts.

## Code style
- TypeScript strict mode
- Single quotes, no semicolons
- Use functional patterns where possible