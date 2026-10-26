# Onboarding to team-b

1. Join `#podcast-help` and `#team-b`.
2. Run podcast-api locally with `docker compose up` in its repository; it
   seeds 20 sample shows.
3. Run queue-proxy with `yarn dev` and point it at your local podcast-api with
   `PODCAST_API_URL=http://localhost:8080`.

## Your first change

Good first changes are labelled `starter` on the team board. Most touch the
episode list page in queue-proxy or a field in the podcast-api responses.

## Releases

podcast-api deploys continuously from `main`. queue-proxy releases every
weekday at 14:00 UTC; anything merged after 13:30 waits for the next day.
