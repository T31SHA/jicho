#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jichobot-cli-relay-run.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
swiftc -swift-version 6 -strict-concurrency=complete \
    JichoBot/Sources/App/CLIRelay.swift JichoBot/Sources/App/CLIRelayRun.swift tests/CLIRelayRunTests.swift \
    -o "$TEST_DIR/cli-relay-run-tests"
"$TEST_DIR/cli-relay-run-tests" "$TEST_DIR"
