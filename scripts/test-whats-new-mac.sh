#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jichobot-whats-new.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
swiftc JichoBot/Sources/App/MacUpdate.swift JichoBot/Sources/App/WhatsNew.swift tests/WhatsNewTests.swift -o "$TEST_DIR/whats-new-tests"
"$TEST_DIR/whats-new-tests"
python3 scripts/test-whats-new.py
