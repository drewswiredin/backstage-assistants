# Development

```sh
yarn install
PODCAST_API_URL=http://localhost:8080 yarn dev
```

## Configuration

| Variable          | Meaning                                |
| ----------------- | -------------------------------------- |
| `PODCAST_API_URL` | Where podcast-api runs                 |
| `CDN_BASE_URL`    | Where show artwork is served from      |
| `FLAGS_ENV`       | Which feature flag environment to read |

## Testing

- `yarn test` for unit tests.
- `yarn e2e` runs Playwright against a local podcast-api with seed data.

## Accessibility

Every page is checked with axe in CI; a new violation fails the build.
