# JICHO Threat Model

**Version:** Updated 2026-11-17

## Scope and assumptions

This model covers the checked-in Electron application, Node loopback hook server, authenticated Claude/Cursor/Codex CLI hook helpers, installation credential, local SQLite database/preferences/audit files, and optional ntfy generic-alert bridge. It does not assume a cloud account, JICHO relay, native mobile app, or verified Codex/Cursor session exists.

The desktop and the coding agent run as the same OS user. A fully compromised OS account can read local files, control the app, or interact with the agent; JICHO cannot defend against that. The relay (currently ntfy for optional notifications) is outside the desktop trust boundary.

## Assets

- Integrity and origin of each permission decision.
- Agent, session, and workspace identity.
- Commands, tool inputs, file paths, and project information.
- The optional ntfy topic, which identifies a generic alert subscription but does not authenticate a device.
- Hook configuration, local preferences, and decision audit metadata.
- The SQLite database, including bounded permission command/path details and observed event records.
- Availability of the agent's original permission prompt when JICHO is unavailable.

## Trust boundaries and actors

| Boundary / actor | Current relationship |
| --- | --- |
| Claude Code → local helper → `127.0.0.1:47821` | Command hook receives JSON on stdin, signs it with the installation credential, and relays the loopback response to stdout. The server requires HMAC authentication, freshness, installation/session binding, replay protection, exact loopback Host, and no browser-origin metadata. |
| Renderer → Electron main | Context-isolated, sandboxed preloads; IPC handlers accept only the expected local main frame, and both pages use a restrictive CSP and block popups/navigation away. |
| Local process on same user account | Can invoke the installed signing helper or access a same-user credential store. The protocol does not establish Claude Code process identity; the owner-only file fallback is readable by the same account. |
| Agent/project content | Commands and tool inputs are untrusted strings. Renderer uses text nodes for the shown request content. |
| ntfy.sh → mobile ntfy client | Third-party service sees generic alert notices and the subscription topic. No decision or reply stream is configured. |
| Local filesystem | Preferences, phone config, JSONL audit, and versioned SQLite history are local. POSIX SQLite files are restricted to owner access; the database is not encrypted and no retention/rotation policy exists. |

## Threats and current mitigations

| Threat | Current mitigation | Gap / disposition |
| --- | --- | --- |
| Approval response reaches the wrong concurrent request | Each held HTTP response owns its request resolver; `settle(id)` is single-use. Local harness covers 20 concurrent requests; durable rows bind agent and session. | Preserve this design. Approval transitions are transactional and insert at most one decision per request. |
| Missing session ID is treated as a shared identity | The server validates session IDs before event handling, and the signed session hash must match the body. Safe auto-allow requires a previously observed session. | Same-user processes with access to the signing helper can sign arbitrary session IDs; the protocol does not prove Claude process identity. |
| Oversized or malformed hook payload consumes memory or is silently ignored | Current receiver caps bodies at 1 MiB, validates the event/session schema, reports generic errors, and bounds header/body/keep-alive times. | Malformed requests are rejected before event handling. The wrapper emits no decision on failure, preserving Claude's native permission flow. |
| Unsigned process forges a Claude event | Loopback-only bind; exact Host validation; browser-origin rejection; mandatory HMAC-SHA256 over method, path, installation ID, timestamp, nonce, exact body hash, and session hash; constant-time MAC comparison; durable nonce uniqueness in SQLite. | A same-user process can invoke the local helper or read/use the account's credential store. Authentication proves key possession, not Claude process identity. |
| Hostile web page targets Jicho through loopback or DNS rebinding | Exact `127.0.0.1:<port>` Host check; reject Origin, Referer, and cross-site Fetch Metadata before parsing or storing the body. Mandatory HMAC is an additional boundary. | The browser checks do not authenticate native callers. See the same-user process limitation above. |
| ntfy subscriber or service infers private activity | Notification payload contains only a generic attention message and topic, with no project, command, request ID or action. | The relay and anyone with the topic can still learn that a generic alert occurred; do not treat the topic as user/device authentication. |
| ntfy notification triggers an approval | No action buttons, signed response values, reply topic, or inbound subscription exist. `PhoneBridge` cannot settle a request. | Remote phone decisions are unavailable until a device-authenticated protocol and native clients are implemented and verified. |
| Auto-approval of destructive operation | Default policy off; exact allowlist; deterministic risk flags prevent allowlist matches | Risk flags are not a complete command parser and currently do not replace all authorization. Unknown identity must never be allowlisted. |
| Renderer injection leads to main-process approval | Both windows use context isolation, sandbox, no Node integration, a restrictive CSP, local-only navigation, blocked popups, and sender-frame validation. Dynamic request/event fields are rendered with text nodes. | A compromised local application resource could still invoke intended allow/deny actions. Keep the preload API narrow and validate every new handler as the command centre grows. |
| App/server crash loses pending requests | Graceful quit settles every held response with no decision. On restart, persisted `PENDING` rows become `FAILED` with an audit record; no pending approval is re-presented. | The original HTTP response cannot survive process loss. Restart recovery and neutral fallback pass local tests; actual Claude crash behavior remains unverified. |
| Local database exposes project/command details | SQLite is created under Electron user data, uses WAL, and applies owner-only POSIX modes to the DB/WAL/SHM files. Prompt text, tool output, and raw failure text are omitted. | Database is not encrypted; bounded command, path, cwd, and session metadata may still reveal secrets. No retention, backup, or secure deletion control exists. Windows file protection relies on OS ACLs. |
| Duplicate, late, or expired decision resolves a request twice | SQLite conditional transition requires `state = PENDING`; request expiry is checked transactionally; `approval_decisions.request_id` is unique. | Cross-process multiple Jicho instances are prevented by Electron's single-instance lock, but direct local database tampering is outside the application boundary. |
| Audit leaks command secrets | JSONL audit stores decision metadata, cwd, tool, risk flags, and IDs, not raw command | SQLite approval/event rows retain bounded command/path details. CWD/session IDs can still reveal project information; no retention controls exist. |
| Hook configuration clobber or unsupported hook | Installer merges and backs up settings, removes only marked entries, and installs `SessionStart` only as a non-blocking command hook (never as an HTTP hook). | Current hook merge/idempotence checks cover SessionStart. The installed Claude CLI still needs a live check for the new SessionStart command entry. |
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

## Authenticated hook protocol (2026-11-17)

The installer provisions a 32-byte random key and installation UUID once. The key is stored in Linux Secret Service (`secret-tool`), macOS Keychain (`security`), or Windows Credential Manager. When native storage is unavailable, Linux/macOS use a `0700` directory and `0600` credential file; this protects against other OS accounts, not same-user processes. Windows fails closed if Credential Manager is unavailable. Only Linux's file fallback was exercised in this environment; macOS/Windows native integrations are unverified.

Claude, Cursor, and Codex CLI settings contain command references and no personal secret. Each collaborator provisions a local helper and credential. The helper signs the exact stdin bytes using the canonical newline-delimited fields `JICHO-HOOK-V1`, `POST`, `/`, installation UUID, Unix milliseconds, 24-byte random nonce (base64url), session-ID SHA-256 (hex), and body SHA-256 (hex). The server enforces a 30-second clock window, strict event/session fields, 1 MiB limit, HMAC-SHA256, timing-safe signature comparison, and durable one-use nonces (SQLite schema v2). For a supported synchronous permission hook, the helper forwards the JICHO response; on missing credential, connection failure, or non-200 response it emits no decision, leaving the agent's own permission flow. Codex's event and permission behavior remains unverified against a live task.

Credential rotation switches the active generation and invalidates the previous key on the next request. Revocation rejects new requests but does not cancel requests already accepted by JICHO. Authentication failures are logged by category only; signatures, credentials, and request bodies are not logged. The current Claude Code `2.1.325` command-hook path passed a temporary allow/deny/SessionEnd smoke test. This does not establish universal interception, protection from a compromised user account, or production readiness.

## Incident and residual-risk notes

The local HTTP service should not be exposed outside loopback. If the optional ntfy topic is disclosed, regenerate the alert topic; the only exposed data is a generic alert notice and its timing. Legacy ntfy action payloads are no longer published, and the bridge no longer subscribes to replies.

No independent security review, OS sandbox review, penetration test, or real-device remote approval test has been performed.
