#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jichobot-flow-text.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
swiftc JichoBot/Sources/App/FlowText.swift tests/FlowTextTests.swift -o "$TEST_DIR/flow-text-tests"
"$TEST_DIR/flow-text-tests"
