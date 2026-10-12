# Changelog

All notable changes to `@drewswiredin/backstage-plugin-assistants-backend-module-semantic-search`.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.1.0 - 2026-10-12

### Added

- Knowledge index: TechDocs sections and catalog entities embedded into the assistants plugin's Postgres database, refreshed incrementally on a schedule.
- `search-knowledge` action: semantic (pgvector), fuzzy (`pg_trgm`), and keyword (full-text) retrieval fused by reciprocal rank, filtered to entities the caller can read in the catalog.
