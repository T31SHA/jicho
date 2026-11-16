# JICHO Product Specification

**Version:** Working specification, 2026-11-16

## Product intent

JICHO is an independent supervision and control surface for AI coding agents. It observes only events exposed by documented agent interfaces, displays the evidence and permissions it actually receives, and gives the user a safe way to resolve the original request. JICHO does not generate code or replace an agent.

## Current product baseline

The current usable slice is an Electron companion for Claude Code in terminal or IDE terminal sessions, with a separate command centre. Claude's HTTP hooks send events to a loopback Node server. The floating companion shows one request at a time, with a queue, raw tool input, working directory, deterministic risk flags, and allow/deny controls. Every card maps to one open hook response. The command centre shows current approval requests, persisted sessions, and a source-labeled timeline of actual hook events and local JICHO decisions. Sessions, supported hook observations, request states, decisions, and audit records persist in a versioned local SQLite database. A process restart marks in-flight requests failed because the original hook response cannot be restored; the native agent permission flow remains the safe fallback. The command centre renderer and IPC button flow passed a headless smoke check using a simulated snapshot; native window interactions and real Claude events remain unverified. An optional ntfy bridge can publish an alert and receive a signed action; it is not a native JICHO mobile application.

## Product principles

- The original agent remains the final executor of a decision.
- A request has one stable origin: agent, session, and originating hook interaction.
- Monitoring and approval capabilities are reported separately.
- Observed events, derived risk labels, and inferred summaries are visibly distinct.
- Security classification is deterministic and explainable; optional AI must never authorize an operation.
- Expiration, disconnection, process loss, or uncertainty never imply approval.
- Sensitive command/output content stays local unless the user enables a feature that sends it elsewhere.
- New adapters are added only after official protocol review and real integration verification.

## Target user journeys

### Local supervision

1. The user installs JICHO and explicitly reviews the Claude hook configuration change.
2. JICHO detects Claude sessions through supported hooks and displays observed lifecycle/tool events.
3. A permission request appears with its actual agent, project, session, operation, command, and risk details.
4. The user approves or denies that exact request.
5. JICHO records the decision and reports whether it was delivered to the original agent.

### Remote supervision

1. The user pairs a mobile device with a desktop using a short-lived authenticated pairing flow.
2. JICHO sends an opaque or end-to-end encrypted event envelope through a relay.
3. A push notification says only that an approval is waiting; it contains no bearer credential or executable authorization.
4. The mobile app authenticates the user, displays the original action, and submits a signed, expiring, single-use decision.
5. The desktop checks device authorization, request identity, state, expiry, replay, and session binding before settling the original hook response.
6. JICHO reports separately that the decision was submitted, accepted locally, delivered to the agent, and (where observable) followed by execution.

## Functional scope

### Desktop command centre

- Overview of online agents/sessions, pending approvals, actual recent events, and security alerts.
- Session list with agent type, project/workspace, directory, stable session ID, status, last event, timestamps, and pending count.
- Session detail timeline with source and event type, raw evidence where available, and explicit gaps where data is unavailable.
- Approval cards with the exact requested operation, source context, expiry, risk level and explanation, available responses, and link to the originating session.
- Device, integration, data retention, theme, notification, and policy settings.

### Floating companion

- Small bounded mascot window, always-on-top behavior where supported, draggable placement, persisted location, notification count, and quick approval entry point.
- Distinct observed states: idle, watching, working, permission needed, warning, error, completed, disconnected, and paused.
- No full-screen transparent overlay. Respect reduced-motion settings and keyboard access.
- Desktop shell and mascot remain available while the command centre is closed.

### Agent adapters

Each adapter declares monitoring and control capabilities separately, including discovery, lifecycle, tool, shell, file, completion, and genuine permission-control support. The adapter normalizes documented source events and returns decisions only through its supported protocol. Adapter failures preserve native agent behavior where possible.

Initial integration status:

| Agent | Supported mode today | Future acceptance condition |
| --- | --- | --- |
| Claude Code | Real HTTP hooks for documented lifecycle/tool events and `PermissionRequest` decisions | Verify the installed-version event payloads, configuration behavior, allow/deny behavior, timeout, and restart behavior against the installed CLI. |
| OpenAI Codex | None | Review official App Server protocol and compatibility per Codex surface; verify JSON-RPC lifecycle and true approval-response handling. |
| Cursor | None | Review official Hooks reference; implement only event/response forms that can actually block, allow, or deny. |
| Other agents | None | Per-adapter protocol and capability review; no implied support. |

### Approval and policy model

The target approval request has a globally unique request ID; one agent and session binding; workspace/project identity; creation and expiry timestamps; request type and source context; actual action details; deterministic risk and explanation; available decisions; delivery state; decision source; and audit metadata. The target state machine is `CREATED → PENDING → DELIVERED → VIEWED → APPROVED|DENIED|CANCELLED|EXPIRED|FAILED|SUPERSEDED`, subject to adapter semantics. One request can reach at most one terminal state. A terminal result from the agent takes precedence over a late JICHO response.

Automatic policy remains opt-in and limited to explicit deterministic rules. Critical, destructive, ambiguous, expired, unknown-identity, and unknown-session requests are never auto-approved.

## Non-functional requirements

- Session-scoped event and approval isolation under concurrency.
- Durable, versioned local data store and explicit recovery behavior.
- Bounded ingress, memory, audit growth, and log retention.
- Authenticated, TLS-protected remote transport with revocation and replay protection.
- No unnecessary inbound public desktop port.
- Graceful shutdown and reconnection; no busy loop while idle.
- Accessible contrast, keyboard navigation, responsive views, and reduced motion.
- Platform behavior is claimed only after platform-specific verification.

## Delivery sequencing

1. Audit and close the current hook-ingress identity/size-validation gaps.
2. Stabilize the local Claude permission slice and its verified installer semantics.
3. Add a typed domain/event contract and durable, versioned persistence without moving decision ownership away from the current core. **Local SQLite v1 and durable approval transitions are implemented; typed adapter contracts remain outstanding.**
4. Expand Claude's documented event timeline and approval detail. **Documented events are installed and persisted; real installed-CLI verification remains outstanding.**
5. Build the command centre and complete desktop lifecycle/position behavior. **The initial command centre is implemented; interaction and window behavior still need OS-specific verification.**
6. Add Codex and Cursor only after protocol review and real verification.
7. Design a relay and device identity system before building the native mobile approval flow.
8. Harden, test, package, and publish platform capability reports.

## Acceptance evidence

A UI screen is not evidence that an integration works. Each adapter requires captured/validated real protocol payloads and observed agent behavior. A remote approval requires a full pairing-to-agent round trip, including a negative replay/expiry test. A platform support claim requires build and interaction evidence on that OS and window system.
