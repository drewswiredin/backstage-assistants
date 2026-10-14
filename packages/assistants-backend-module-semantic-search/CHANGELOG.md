# Changelog

All notable changes to `@drewswiredin/backstage-plugin-assistants-backend-module-semantic-search`.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
