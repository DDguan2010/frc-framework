# ADR 0004: Replaceable NT4 client in Electron Main

- Status: Accepted
- Date: 2026-07-17

## Context

The tuning workflow needs narrow NT4 prefix subscriptions, live values, writes, reconnect handling,
and clear diagnostics on Windows, macOS, and Linux. Renderer WebSocket access would weaken the
Electron boundary, while native `ntcore` bindings add ABI and packaging risk.

The authoritative protocol is WPILib's NetworkTables 4.1 specification. AdvantageScope demonstrates
a proven connection experience and uses a BSD-style license, but FRC Framework does not copy its
implementation. This client is implemented directly against the public protocol and tested with an
independent local protocol server.

## Decision

Implement a small `NtClient` interface in a dedicated package, backed initially by Node `ws` and
MessagePack in Electron Main. Prefer the `v4.1.networktables.first.wpi.edu` subprotocol, use `/nt/<client>`
and port 5810/5811, synchronize timestamps, send WebSocket PING/PONG heartbeats, resubscribe on
reconnect, and surface type changes instead of coercing them silently.

Only declared project prefixes are subscribed. The Renderer receives normalized, typed updates over
a narrow IPC service in the product phase. The transport remains replaceable if a maintained WPILib
WASM or official Node client becomes available.

## Consequences

The spike has no native dependency and can be tested identically on all platforms. Full protocol
coverage, robot address discovery, low-bandwidth scheduling, and UI writeback remain later product
work; the interface and behavior required for that work are stable.

## References

- WPILib `ntcore/doc/networktables4.adoc`, NetworkTables Protocol Specification 4.1
- WPILib NetworkTables documentation
- AdvantageScope NT4 source and connection UX (reference only; no copied implementation)
