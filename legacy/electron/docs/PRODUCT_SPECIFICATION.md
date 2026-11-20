# JICHO Product Specification

**Version:** Working specification, 2026-11-17

## Product intent

JICHO is an independent supervision and control surface for AI coding agents. It observes only events exposed by documented agent interfaces, displays the evidence and permissions it actually receives, and gives the user a safe way to resolve the original request. JICHO does not generate code or replace an agent.

## Current product baseline

The current usable slice is an Electron companion for Claude Code in terminal or IDE terminal sessions, with the mascot island as its primary surface and a separate command centre for deeper history. Claude command hooks pass events to a local helper, which signs the exact request for a loopback Node server and relays the existing hook response. Per-installation credentials use an OS store where available, with a private-file fallback on Linux/macOS; shared settings contain no personal key. Allow, deny, and SessionEnd passed a live Claude Code 2.1.325 smoke test. Protocol v1 normalizes actual Claude hook events while retaining the source event and adapter provenance. The floating island shows observed activity, supported file paths, and evidence-based local reminders; it does not store prompt text, infer task progress, or offer unimplemented diffs or questions. Every permission card maps to one original hook response. Sessions, supported hook observations, decisions, and replay nonces persist in local SQLite. A process restart marks in-flight approvals failed because the original hook response cannot be restored; Claude's native permission flow remains the fallback. Same-user processes can invoke the helper or use a same-user credential store; authentication does not establish Claude process identity. An optional ntfy bridge is not a native JICHO mobile application.

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

Implementation status at 2026-11-17:

| Agent | Supported mode today | Future acceptance condition |
| --- | --- | --- |
| Claude Code | Authenticated command hooks for documented lifecycle/tool events and `PermissionRequest` decisions; real 2.1.325 allow/deny smoke passed | Verify broad event rendering, desktop-card delivery, timeout/recovery, and native credential stores on macOS/Windows. |
| OpenAI Codex CLI | Hook adapter and synchronous Bash/`apply_patch` permission route implemented through the existing core; live smoke timed out before hooks ran | Retry a real authenticated session and verify actual Allow/Deny response semantics. Codex desktop and question handling are unsupported. |
| Cursor | Authenticated activity-only hook adapter implemented; permissions and questions unsupported | Run a real Cursor agent session and verify lifecycle and file-edit observations. |
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

1. Verify OS credential-store behavior and packaged helper installation across desktop platforms; retain the documented same-user limitation.
2. Stabilize the local Claude permission slice and its verified installer semantics.
3. Add a typed domain/event contract and durable, versioned persistence without moving decision ownership away from the current core. **Local SQLite schema v2, durable approval transitions, and the protocol v1 adapter contract are implemented.**
4. Expand Claude's documented event timeline and approval detail. **Documented events are installed and persisted; real installed-CLI verification remains outstanding.**
5. Build the command centre and complete desktop lifecycle/position behavior. **The initial command centre is implemented; interaction and window behavior still need OS-specific verification.**
6. Complete real-session verification for Codex and Cursor; keep capability claims scoped to each adapter.
7. Design a relay and device identity system before building the native mobile approval flow.
8. Harden, test, package, and publish platform capability reports.

## Acceptance evidence

A UI screen is not evidence that an integration works. Each adapter requires captured/validated real protocol payloads and observed agent behavior. A remote approval requires a full pairing-to-agent round trip, including a negative replay/expiry test. A platform support claim requires build and interaction evidence on that OS and window system.
