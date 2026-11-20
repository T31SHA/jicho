#!/usr/bin/env bash
set -e
echo "Running IntentParser tests…"
swiftc -o /tmp/voice-intent-tests \
  tests/VoiceTestStubs.swift \
  tests/PillFixture.swift \
  JichoBot/Sources/App/Voice/VoiceIntent.swift \
  JichoBot/Sources/App/Voice/EntityResolver.swift \
  JichoBot/Sources/App/Voice/IntentParser.swift \
  JichoBot/Sources/App/Voice/VoiceQuery.swift \
  tests/IntentParserTests.swift
/tmp/voice-intent-tests
