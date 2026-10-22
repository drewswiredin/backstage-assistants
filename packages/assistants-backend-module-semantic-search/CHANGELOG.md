# Changelog

All notable changes to `@drewswiredin/backstage-plugin-assistants-backend-module-semantic-search`.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Ranking by source. `assistants.semanticSearch.types.<type>` sets a document type's `weight` (multiplies its fused score; 0 never returns it), `default` (false makes it opt-in), `maxResults` (a per-answer cap whose spare slots go to other types), `enabled` (false stops copying it and deletes its chunks on its next run), and a `description` for the model. `assistants.semanticSearch.maxResults` sets the default result count.
- `search-knowledge` takes `types` to search only named sources; an unknown name returns the list of types. The tool description lists the configured types and marks the opt-in ones. Each result carries its `type` and the short fields its collator attached (`metadata`: status, space, last update, …).
- `knowledgeRankingExtensionPoint` (from `./alpha`) lets a backend module replace the default ranker, for example to favour recent tickets. The ranker sees only candidates the caller may read.

### Changed

- Each retrieval list keeps its best chunks of every type, so a large source cannot fill a list on its own before ranking weighs the types. Filtered vector search uses pgvector 0.8 iterative scans when available.
- A run of a type named in `types` is stored under that type's name. Upgrading from 0.2.0 keeps the embeddings: each named type takes over its existing chunks on its next run without re-embedding.

## 0.2.0 - 2026-10-22

### Changed

- The index is a copy of everything Backstage search indexes, not a crawl of its own. A search decorator on every document type hands each finished collator run to the index, so Confluence, wikis, and any other collated source become searchable by meaning, and no source is read twice. Requires `@backstage/plugin-search-backend` in the same backend; the package's default export now adds two modules (`assistantsModuleSemanticSearch` and `searchModuleAssistantsKnowledge`).
- Catalog and TechDocs results stay filtered to entities the user can read; results from other sources are visible to every assistant user, as in Backstage search. `search-knowledge` results drop `source`, and `entityRef` is present only for entity-gated results. Locations are the search result locations (TechDocs `/docs/...` paths still go to `read-techdocs`).
- The index rebuilds on upgrade and refills as each collator next runs.

### Removed

- `assistants.semanticSearch.schedule`: the index refreshes when search does.

## 0.1.4 - 2026-10-22

### Changed

- Backstage dependency ranges track the 1.56 release line.

## 0.1.3 - 2026-10-15

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
