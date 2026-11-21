#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jichobot-desktop.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
swiftc JichoBot/Sources/App/DesktopKitoLogic.swift \
    tests/DesktopKitoTests.swift -o "$TEST_DIR/desktop-kito-tests"
"$TEST_DIR/desktop-kito-tests"
