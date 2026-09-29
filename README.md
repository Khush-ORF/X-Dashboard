# X account dashboard

This repository runs a bounded, metadata-only monitor for:

- `@orfonline`
- `@BrookingsInst`
- `@ChathamHouse`
- `@RANDCorporation`

The scheduled workflow starts at **22:00 Asia/Kolkata (16:30 UTC)** each day. It records at most ten distinct monitoring days, builds the static dashboard, commits public data, and deploys `docs/` to GitHub Pages.

## What is collected

Each post record contains the canonical X URL, author, publication timestamp, likes, reposts, replies, views, observation time, and whether the counters came from an exact numeric response. Post text and cookies are not saved.

Follower history accepts only integer `followers_count` values returned in X's structured response. Abbreviated page text such as `1.2M` is not added to the graph.

The imported January 2026 checkpoints are explicitly marked partial. Search results can omit deleted, protected, de-indexed, or otherwise unavailable posts, so this project does not claim a complete archive.

## One-time GitHub setup

1. Open **Settings → Secrets and variables → Actions** in the repository.
2. Add a repository secret named `X_COOKIES` containing the small JSON cookie array exported from an authenticated X session. Only `auth_token`, `ct0`, and optional `twid` are accepted at runtime.
3. Open **Settings → Pages** and set the source to **GitHub Actions**.
4. In **Settings → Actions → General**, allow workflows to read and write repository contents if the organization policy has not already enabled it.
5. Run **Daily X dashboard** once with **Run workflow** to verify authentication and Pages deployment.

Use a dedicated, low-privilege X account. GitHub stores the cookie value as an encrypted Actions secret, but an authenticated web scraper can still be challenged, rate-limited, or suspended by X. Delete the secret and revoke the X session after the ten-day monitor.

## Local commands

```powershell
npm install
npm run import:existing
npm run build
npm test
npm run preview
```

The preview listens only on `http://127.0.0.1:4191`. A local collection reads `X_COOKIES` from the process environment and clears that variable before opening the browser. Never commit cookies, session files, or an `.env` file.

## Incremental behavior

The first successful run starts at midnight India time for that monitoring day. Later runs search with a two-day overlap, merge by post ID, and advance a per-account cursor only after a successful search. The overlap protects against ordering changes and delayed indexing. If X returns HTTP 429, the collector stops sending further account searches for that run and retains all prior data.

GitHub schedules are best effort and may start later than 22:00 during periods of high load. The workflow is capped at 45 minutes; a normal daily run should usually be much shorter.
