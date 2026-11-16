# JICHO Threat Model

**Version:** Initial audit, 2026-11-16

## Scope and assumptions

This model covers the checked-in Electron application, Node loopback hook server, Claude Code HTTP hook configuration, local SQLite database/preferences/audit files, and optional ntfy bridge. It does not assume a cloud account, JICHO relay, native mobile app, or other agent adapter exists.

The desktop and the coding agent run as the same OS user. A fully compromised OS account can read local files, control the app, or interact with the agent; JICHO cannot defend against that. The relay (currently ntfy for optional notifications) is outside the desktop trust boundary.

## Assets

- Integrity and origin of each permission decision.
- Agent, session, and workspace identity.
- Commands, tool inputs, file paths, and project information.
- The optional ntfy topic and local HMAC secret.
- Hook configuration, local preferences, and decision audit metadata.
- The SQLite database, including bounded permission command/path details and observed event records.
- Availability of the agent's original permission prompt when JICHO is unavailable.

## Trust boundaries and actors

| Boundary / actor | Current relationship |
| --- | --- |
| Claude Code → `127.0.0.1:47821` | Local HTTP hook input; optional bearer authentication. The service does not listen on external interfaces. |
| Renderer → Electron main | Context-isolated, sandboxed preloads; IPC handlers accept only the expected local main frame, and both pages use a restrictive CSP and block popups/navigation away. |
| Local process on same user account | Can attempt to reach the loopback server. Without `JICHO_TOKEN`, hook requests are accepted. |
| Agent/project content | Commands and tool inputs are untrusted strings. Renderer uses text nodes for the shown request content. |
| ntfy.sh → mobile ntfy client → ntfy reply stream | Third-party service sees published content and signed action values; a topic acts like a password. |
| Local filesystem | Preferences, phone config, JSONL audit, and versioned SQLite history are local. POSIX SQLite files are restricted to owner access; the database is not encrypted and no retention/rotation policy exists. |

## Threats and current mitigations

| Threat | Current mitigation | Gap / disposition |
| --- | --- | --- |
| Approval response reaches the wrong concurrent request | Each held HTTP response owns its request resolver; `settle(id)` is single-use. Local harness covers 20 concurrent requests; durable rows bind agent and session. | Preserve this design. Approval transitions are transactional and insert at most one decision per request. |
| Missing session ID is treated as a shared identity | The current core rejects invalid IDs, and safe auto-allow requires a previously observed session. | The original code used a shared `unknown` ID; regression checks now cover missing IDs and first-seen sessions. Local hook spoofing remains possible when no bearer token is configured. |
| Oversized or malformed hook payload consumes memory or is silently ignored | Current receiver caps bodies at 1 MiB, validates JSON objects, reports errors, and bounds header/body/keep-alive times. | Malformed JSON gets a non-2xx response; Claude Code's default HTTP hook failure behavior is non-blocking, preserving the native flow. |
| Local process forges a Claude event | Loopback-only bind; optional bearer token | Token is optional, and no per-process or session proof exists. A local same-user attacker can spoof requests and potentially manipulate what the user sees. Keep remote-control endpoints absent until authenticated pairing exists. |
| Replay or duplicate ntfy action | HMAC binds the request ID and decision; only a pending ID can settle; settled IDs are removed. | No explicit timestamp/nonce in message. Pending request expiry and one-use map provide current practical replay bound; add durable replay state and device identity in a first-party protocol. |
| Unauthorized ntfy subscriber approves a pending request | Topic is 128-bit random; HMAC secret is local; desktop checks MAC. | A subscriber who can read a pending notification can see its signed action bodies. The shared topic is a bearer capability, not per-device authentication. Do not describe it as a secure first-party mobile approval system. |
| ntfy service reads request information | TLS to `ntfy.sh`; optional content-free mode; heuristic redaction/truncation | TLS protects transport, not message confidentiality from the relay. Signed action values are also included in the notification. Content-free mode should be used for sensitive commands. |
| Auto-approval of destructive operation | Default policy off; exact allowlist; deterministic risk flags prevent allowlist matches | Risk flags are not a complete command parser and currently do not replace all authorization. Unknown identity must never be allowlisted. |
| Renderer injection leads to main-process approval | Both windows use context isolation, sandbox, no Node integration, a restrictive CSP, local-only navigation, blocked popups, and sender-frame validation. Dynamic request/event fields are rendered with text nodes. | A compromised local application resource could still invoke intended allow/deny actions. Keep the preload API narrow and validate every new handler as the command centre grows. |
| App/server crash loses pending requests | Graceful quit settles every held response with no decision. On restart, persisted `PENDING` rows become `FAILED` with an audit record; no pending approval is re-presented. | The original HTTP response cannot survive process loss. Restart recovery and neutral fallback pass local tests; actual Claude crash behavior remains unverified. |
| Local database exposes project/command details | SQLite is created under Electron user data, uses WAL, and applies owner-only POSIX modes to the DB/WAL/SHM files. Prompt text, tool output, and raw failure text are omitted. | Database is not encrypted; bounded command, path, cwd, and session metadata may still reveal secrets. No retention, backup, or secure deletion control exists. Windows file protection relies on OS ACLs. |
| Duplicate, late, or expired decision resolves a request twice | SQLite conditional transition requires `state = PENDING`; request expiry is checked transactionally; `approval_decisions.request_id` is unique. | Cross-process multiple Jicho instances are prevented by Electron's single-instance lock, but direct local database tampering is outside the application boundary. |
| Audit leaks command secrets | JSONL audit stores decision metadata, cwd, tool, risk flags, and IDs, not raw command | SQLite approval/event rows retain bounded command/path details. CWD/session IDs can still reveal project information; no retention controls exist. |
| Hook configuration clobber or unsupported hook | Installer merges and backs up settings, removes only marked entries, and no longer adds HTTP `SessionStart`. | Older marked `SessionStart` entries are removed by uninstall. The current installer is covered by merge/idempotence checks. |
| Hook settings are applied to the wrong projects, unexpectedly shared, or truncated during update | Install/status/uninstall require an explicit project scope flag; user scope remains the default. The installer prints the selected path and warns before applying the change. Project-local configuration warns that a hand-created file must be Git-ignored; shared configuration warns that committing it affects collaborators. Changes use a temporary file and atomic rename after a timestamped backup. | Scope, preservation, and simulated rename-failure behavior are tested in a temporary project. The installer currently treats the caller's current working directory as the project root; run it from the project root and verify Claude's loaded settings in `/status`. Windows ACL behavior remains unverified. |
| User assumes JICHO approval covers every Claude tool action | README and verifier state that only a genuine `PermissionRequest` is approvable. | A live Claude Code 2.1.325 test showed Auto mode issuing `PreToolUse` and running a command without `PermissionRequest`; `PreToolUse` remains observation-only. Users who require a prompt must select a Claude permission mode that surfaces one. |

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
