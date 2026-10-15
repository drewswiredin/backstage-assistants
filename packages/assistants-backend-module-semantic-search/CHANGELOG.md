# Changelog

All notable changes to `@drewswiredin/backstage-plugin-assistants-backend-module-semantic-search`.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Fixed

- A rare exact term, such as a name or acronym mentioned once in a paragraph about something else, is no longer outranked by sections that are only near the question in meaning. Fusion gives one vote per method: the phrasings share the meaning vote, so alternatives broaden recall without outvoting exact matches. Words found in three chunks or fewer get a list of their own, and a term written as two words ("tally up") also matches its one-word form.
- Identical text indexed at two locations takes one result slot, not two.

### Changed

- The `search-knowledge` description states the search order (this tool first, keyword search when the results don't clearly answer, nothing reported missing until both come back empty), so MCP clients that drop server instructions still follow it. The index-building error points at keyword search.

## 0.1.2 - 2026-10-14

### Changed

- The `search-knowledge` description and the README use a neutral name in the misspelling example.

## 0.1.1 - 2026-10-14

### Changed

- The README and config schema descriptions cover the index scope, the startup extension check, and the schedule default.

## 0.1.0 - 2026-10-12

### Added

- Knowledge index: TechDocs sections and catalog entities embedded into the assistants plugin's Postgres database, refreshed incrementally on a schedule.
- `search-knowledge` action: semantic (pgvector), fuzzy (`pg_trgm`), and keyword (full-text) retrieval fused by reciprocal rank, filtered to entities the caller can read in the catalog.
