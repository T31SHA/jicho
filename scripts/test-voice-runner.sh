#!/usr/bin/env bash
set -e
echo "Running VoiceActionRunner tests…"
swiftc -o /tmp/voice-runner-tests \
  tests/VoiceTestStubs.swift \
  tests/PillFixture.swift \
  JichoBot/Sources/App/Voice/VoiceIntent.swift \
  JichoBot/Sources/App/Voice/IntentParser.swift \
  JichoBot/Sources/App/Voice/VoiceQuery.swift \
  JichoBot/Sources/App/Voice/EntityResolver.swift \
  JichoBot/Sources/App/Voice/VoiceActionRunner.swift \
  tests/VoiceActionRunnerTests.swift
/tmp/voice-runner-tests
