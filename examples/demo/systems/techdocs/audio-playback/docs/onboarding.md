# Onboarding to team-c

Welcome! This page gets a new engineer from zero to shipping a change to the
audio-playback system in their first week.

## Day one

1. Join `#playback-help`, `#playback-incidents`, and `#team-c`.
2. Ask your onboarding buddy to add you to the **team-c** group in the
   catalog; that grants deploy rights to all three services.
3. Clone the repositories for playback-order and shuffle-api and run their
   test suites (`./gradlew test`).

## First week

- Pair on one on-call shift as shadow.
- Pick a ticket labelled `good-first-change` from the team board.
- Read the [architecture](architecture.md) page and the playback-sdk
  integration guide.

## Deploying

Services deploy through the standard pipeline: merge to `main`, canary at 5%
for 30 minutes, then full rollout. A canary that raises playback start
failures by more than 0.05 points rolls back on its own.

## Glossary

- **Session**: one listener on one device, from first play to 24 hours idle.
- **Queue**: the ordered list of items a session will play.
- **TTFA**: time to first audio, measured from the play tap to the first
  rendered sample.
