#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jichobot-notetaker.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
swiftc JichoBot/Sources/App/NoteModels.swift JichoBot/Sources/App/NoteEcho.swift tests/NoteModelsTests.swift -o "$TEST_DIR/notetaker-tests"
"$TEST_DIR/notetaker-tests"
