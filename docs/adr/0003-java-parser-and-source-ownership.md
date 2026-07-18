# ADR 0003: Tolerant Java parsing and source ownership

- Status: Accepted
- Date: 2026-07-17

## Context

FRC Framework must understand standard robot structure without becoming a Java IDE or overwriting
arbitrary user logic. Robot files are often temporarily incomplete while an editor is saving them.
Native parser modules also make three-platform Electron packaging harder.

## Decision

Use Tree-sitter Java through `web-tree-sitter` and a packaged WASM grammar. Build a tolerant source
index containing packages, imports, types, fields, methods, Command factories, controller fields,
bindings, enum state/goal declarations, and exact source ranges.

Every file receives one of three ownership classifications:

- **Managed** when explicit FRC Framework markers establish ownership;
- **Recognized** when known IronPulse/WPILib patterns are parsed without syntax errors;
- **Custom** when ownership is unknown or the source cannot be edited safely.

Classification includes confidence and reasons. Syntax errors do not discard the remaining index.
Targeted editors must refuse an edit when comments or unknown text make the affected range unsafe.
Final Java formatting remains the project's Spotless responsibility.

## Consequences

The application can degrade gracefully for complex Java and during normal IDE edits. WASM avoids
native Node ABI packaging. Tree-sitter is a structural index rather than a semantic Java compiler,
so type resolution and compilation diagnostics still come from Gradle/WPILib.
