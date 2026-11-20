#!/usr/bin/env bash
set -e
echo "Running EntityResolver tests…"
swiftc -o /tmp/voice-entity-tests \
  tests/VoiceTestStubs.swift \
  tests/PillFixture.swift \
  JichoBot/Sources/App/Voice/VoiceIntent.swift \
  JichoBot/Sources/App/Voice/IntentParser.swift \
  JichoBot/Sources/App/Voice/VoiceQuery.swift \
  JichoBot/Sources/App/Voice/EntityResolver.swift \
  tests/EntityResolverTests.swift
/tmp/voice-entity-tests
