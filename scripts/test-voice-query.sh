#!/usr/bin/env bash
set -e
echo "Running VoiceQuery tests…"
swiftc -o /tmp/voice-query-tests \
  tests/VoiceTestStubs.swift \
  tests/PillFixture.swift \
  JichoBot/Sources/App/Voice/VoiceIntent.swift \
  JichoBot/Sources/App/Voice/EntityResolver.swift \
  JichoBot/Sources/App/Voice/IntentParser.swift \
  JichoBot/Sources/App/Voice/VoiceQuery.swift \
  tests/VoiceQueryTests.swift
/tmp/voice-query-tests
