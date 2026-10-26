-- Installed in template1, so every database Backstage creates (one per
-- plugin) has them from the start, as on a managed Postgres where the
-- extensions are allow-listed ahead of time.
\c template1
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
