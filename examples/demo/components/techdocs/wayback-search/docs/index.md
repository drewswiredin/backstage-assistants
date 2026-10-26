# Wayback Search

**wayback-search** provides full-text search over archived pages through the
[wayback-search API](/catalog/default/api/wayback-search). It consumes the
[wayback-archive API](/catalog/default/api/wayback-archive) to fetch page
content. Owned by **team-a**.

## Query syntax

- Words and phrases: `"release notes" 2008`
- Restrict to a site: `site:example.com`
- Restrict to a period: `before:2010-01-01 after:2005-01-01`

## Freshness

New captures become searchable within a day. The index covers text only;
images and scripts are not indexed.
