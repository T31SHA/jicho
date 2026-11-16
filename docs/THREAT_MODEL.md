# JICHO Threat Model

**Version:** Initial audit, 2026-11-16

## Scope and assumptions

This model covers the checked-in Electron application, Node loopback hook server, Claude Code HTTP hook configuration, local preferences/audit files, and optional ntfy bridge. It does not assume a cloud account, JICHO relay, native mobile app, or other agent adapter exists.

The desktop and the coding agent run as the same OS user. A fully compromised OS account can read local files, control the app, or interact with the agent; JICHO cannot defend against that. The relay (currently ntfy for optional notifications) is outside the desktop trust boundary.

## Assets

- Integrity and origin of each permission decision.
- Agent, session, and workspace identity.
- Commands, tool inputs, file paths, and project information.
- The optional ntfy topic and local HMAC secret.
- Hook configuration, local preferences, and decision audit metadata.
- Availability of the agent's original permission prompt when JICHO is unavailable.

## Trust boundaries and actors

| Boundary / actor | Current relationship |
| --- | --- |
| Claude Code → `127.0.0.1:47821` | Local HTTP hook input; optional bearer authentication. The service does not listen on external interfaces. |
| Renderer → Electron main | Context-isolated, sandboxed preload bridge; main currently accepts invocation arguments without sender-frame validation. |
| Local process on same user account | Can attempt to reach the loopback server. Without `JICHO_TOKEN`, hook requests are accepted. |
| Agent/project content | Commands and tool inputs are untrusted strings. Renderer uses text nodes for the shown request content. |
| ntfy.sh → mobile ntfy client → ntfy reply stream | Third-party service sees published content and signed action values; a topic acts like a password. |
| Local filesystem | Preferences, phone config, and JSONL audit are written locally with restrictive POSIX mode arguments where supported. No database encryption or rotation exists. |

## Threats and current mitigations

| Threat | Current mitigation | Gap / disposition |
| --- | --- | --- |
| Approval response reaches the wrong concurrent request | Each held HTTP response owns its request resolver; `settle(id)` is single-use. Baseline covers 20 concurrent requests. | Preserve this design. Add durable transition and adversarial tests before changing the core. |
| Missing session ID is treated as a shared identity | The current core rejects invalid IDs, and safe auto-allow requires a previously observed session. | The original code used a shared `unknown` ID; regression checks now cover missing IDs and first-seen sessions. Local hook spoofing remains possible when no bearer token is configured. |
| Oversized or malformed hook payload consumes memory or is silently ignored | Current receiver caps bodies at 1 MiB, validates JSON objects, reports errors, and bounds header/body/keep-alive times. | Malformed JSON gets a non-2xx response; Claude Code's default HTTP hook failure behavior is non-blocking, preserving the native flow. |
| Local process forges a Claude event | Loopback-only bind; optional bearer token | Token is optional, and no per-process or session proof exists. A local same-user attacker can spoof requests and potentially manipulate what the user sees. Keep remote-control endpoints absent until authenticated pairing exists. |
| Replay or duplicate ntfy action | HMAC binds the request ID and decision; only a pending ID can settle; settled IDs are removed. | No explicit timestamp/nonce in message. Pending request expiry and one-use map provide current practical replay bound; add durable replay state and device identity in a first-party protocol. |
| Unauthorized ntfy subscriber approves a pending request | Topic is 128-bit random; HMAC secret is local; desktop checks MAC. | A subscriber who can read a pending notification can see its signed action bodies. The shared topic is a bearer capability, not per-device authentication. Do not describe it as a secure first-party mobile approval system. |
| ntfy service reads request information | TLS to `ntfy.sh`; optional content-free mode; heuristic redaction/truncation | TLS protects transport, not message confidentiality from the relay. Signed action values are also included in the notification. Content-free mode should be used for sensitive commands. |
| Auto-approval of destructive operation | Default policy off; exact allowlist; deterministic risk flags prevent allowlist matches | Risk flags are not a complete command parser and currently do not replace all authorization. Unknown identity must never be allowlisted. |
| Renderer injection leads to main-process approval | `contextIsolation`, sandbox, Node integration off; request text is assigned with `textContent` | Add IPC sender/frame checks, restrictive navigation/window-open handlers, and CSP before expanding the UI. |
| App/server crash loses pending requests | Graceful quit settles every held response with no decision, returning to the native flow. A crash closes the socket, and no pending card is reconstructed. | No durable session/event history. Unexpected process death is not durably recorded yet. A restart cannot preserve the exact held HTTP response; recovery must mark requests interrupted/failed, never reapprove them. |
| Audit leaks command secrets | Audit record stores decision metadata, cwd, tool, risk flags, and IDs, not raw command | CWD/session IDs can still reveal project information. No rotation/retention controls. |
| Hook configuration clobber or unsupported hook | Installer merges and backs up settings, removes only marked entries, and no longer adds HTTP `SessionStart`. | Older marked `SessionStart` entries are removed by uninstall. The current installer is covered by merge/idempotence checks. |

## Security objectives for the next release

1. A permission decision is bound to exactly one original agent response and one validated session.
2. Invalid, missing, oversized, stale, duplicated, or expired inputs cannot cause approval.
3. Agent/tool-provided values are treated as untrusted and bounded before storage or display.
4. Failure returns to the agent's safe native permission path whenever the protocol permits.
5. Remote approval is not enabled until the request is authenticated to a registered device, request-scoped, expiring, replay-resistant, and revocable.
6. User-facing status distinguishes sent, delivered, accepted, and executed outcomes.
7. Audit information avoids unnecessary raw command/output persistence and has an explicit retention policy.

## Incident and residual-risk notes

The local HTTP service should not be exposed outside loopback. If the optional shared ntfy topic is disclosed, rotate the topic and local secret by resetting phone pairing; treat messages already published for pending approvals as compromised. A compromised ntfy subscriber can make the decision currently visible in an action message, but the desktop still limits it to an existing pending request and only one terminal settlement.

No independent security review, OS sandbox review, penetration test, or real-device remote approval test has been performed.
