# ADR 0002: Electron security and project path authorization

- Status: Accepted
- Date: 2026-07-17

## Context

The application reads robot source code and launches local toolchains. A compromised renderer must
not gain general filesystem or process execution access.

## Decision

Use isolated Main, Preload, and Renderer layers. Renderer sandboxing and context isolation are
enabled; Node integration is disabled. Preload exposes frozen, task-specific, typed methods instead
of `ipcRenderer`. Main owns filesystem, dialogs, network, and process execution.

Every selected project directory becomes an explicit canonical path grant. File operations must
resolve the target and prove it remains within the grant. Child processes receive a validated
executable and argument array and always run with `shell: false`. Renderer content uses a restrictive
CSP, blocks navigation, and cannot create arbitrary windows.

## Consequences

New privileged capabilities require an explicit IPC contract and validation. This is more verbose
than a broad bridge, but the security boundary remains reviewable and testable.
