# Daily Thrive — AI Assistant Guide

Reference for AI coding assistants working on this repo. Daily Thrive is a fork of [patdeg/dailydrive](https://github.com/patdeg/dailydrive) reworked to run on **GitHub Actions** instead of a Linux VPS with systemd/cron.

## What this project does

Recreates Spotify's discontinued "Daily Drive" feature: a playlist that mixes the latest podcast episodes with music, rebuilt on a schedule. Everything runs in a GitHub Actions cron job — no server, no laptop kept on.

## Tech stack

- **Runtime:** Node.js (v20 in CI; v18+ locally)
- **Spotify Library:** `spotify-web-api-node` (wraps the Spotify Web API)
- **Config:** YAML via `js-yaml`
- **Auth:** OAuth 2.0 Authorization Code flow; refresh token persisted in `.spotify-token.json`
- **Scheduling:** GitHub Actions `schedule:` (cron, UTC)
- **State persistence:** `episode-history.json` committed back to the repo by the workflow each run

## Project structure

```
index.js                       Main script: fetches podcasts + music, mixes, updates playlist
setup.js                       One-time OAuth setup: local server catches the callback, saves token
taste-profile.js               Genre detection via Demeterics
taste-profile-google.js        Genre detection via Google Gemini (free tier)
taste-profile-openai.js        Genre detection via OpenAI
config.example.yaml            Config template
config.yaml                    User config (gitignored; lives in SPOTIFY_CONFIG secret)
.env                           API keys for taste profiling (gitignored)
.spotify-token.json            OAuth tokens (gitignored; lives in SPOTIFY_TOKEN secret)
episode-history.json           Rolling list of placed episode URIs — committed back each run
state.json                     Per-run cache (gitignored)
.github/workflows/dailydrive.yml   The scheduled workflow
package.json                   Dependencies and npm scripts
.gitignore                     Aggressive ignore (PUBLIC REPO — protect secrets)
```

## Commands

```bash
npm install            # install deps
npm run setup          # one-time Spotify auth → .spotify-token.json
npm start              # build the playlist (same command the workflow runs)
npm test               # dry run
npm run taste:openai   # generate genres block via OpenAI
npm run taste:google   # generate genres block via Google Gemini (free)
npm run taste          # generate genres block via Demeterics
```

## Key behaviors in `index.js`

- **Token refresh:** access tokens are 1h; the script auto-refreshes using `refresh_token` and writes back to `.spotify-token.json`. In CI this write-back is discarded, which is fine — refresh tokens are long-lived.
- **Episode freshness filter (default 2 weeks):** in `fetchPodcastEpisodes`, episodes whose `release_date` is older than `DEFAULT_MAX_AGE_DAYS` (14) are skipped. A per-podcast `allow_older: true` flag opts out (use for evergreen / interview shows).
- **Episode history:** `loadHistory()` / `saveHistory()` track every URI ever placed (capped at `HISTORY_LIMIT = 1000`). `fetchPodcastEpisodes` filters candidates against this set so the same episode never appears twice across runs.
- **Pinned podcasts:** entries with `position: first` are prepended to the playlist *before* the mix pattern runs.
- **Podcast rotation order:** `arrangePodcasts()` (called before `fetchPodcastEpisodes`) keeps podcasts with `fixed: true` (or `position: first`) at their config-file slot, and shuffles every other podcast into the remaining slots. The mix pattern itself is unchanged — this only varies *which* podcast fills each P-slot from one run to the next.
- **Ephemeral shows:** `ephemeral: true` is for rolling-URI shows (tagesschau in 100 Sekunden, NPR News Now). These bypass the history filter (always fetch the current URI) AND are excluded from the history write (so URI churn doesn't pollute the 1000-entry cap). Pair with the hourly podcast-only schedule to keep them current.
- **Pattern + safety valve:** `mixContent` interleaves per `mix_pattern` (e.g. `PMMMM`). When one side runs out, the remaining items of the other side are appended in a block (`index.js:368-380`).

## The workflow (`.github/workflows/dailydrive.yml`)

1. `actions/checkout@v4` (with `permissions: contents: write` so the job can push).
2. `actions/setup-node@v4` (Node 20) + `npm install`.
3. **Restore secrets via `env:`** — `printf '%s' "$SPOTIFY_CONFIG" > config.yaml` etc. Always pass through `env:`, never inline `${{ secrets.X }}` into a shell command (apostrophes / ampersands in the secret will break shell quoting).
4. `npm start` — builds the playlist.
5. **Commit `episode-history.json` back** if it changed, using the `github-actions[bot]` identity and a `[skip ci]` commit message.

## Setup workflow (for AI assistants helping users)

When a user asks you to help set up Daily Thrive, the steps are:

1. **Fork/clone the repo** to the user's GitHub account.
2. **Create a Spotify Developer App** at https://developer.spotify.com/dashboard:
   - Redirect URI: `http://127.0.0.1:8888/callback` (NOT `localhost`).
   - Enable Web API and Web Playback SDK.
   - Add the user's Spotify email under Settings → User Management.
3. **Create an empty target playlist** in Spotify, grab its ID from the share link.
4. **Configure `config.yaml`** locally (copy from `config.example.yaml`).
5. **Run `npm run setup` locally** to authenticate — this writes `.spotify-token.json`.
6. **Add two GitHub secrets:** `SPOTIFY_CONFIG` (the full `config.yaml`) and `SPOTIFY_TOKEN` (the full `.spotify-token.json`).
7. **Push the code.** The workflow runs on the cron schedule and can be triggered manually from the Actions tab.

## Gotchas

- **Secrets and shell quoting:** GitHub interpolates `${{ secrets.X }}` *into* the shell command. A `'` or `&` in a config comment will break it. Always pass via `env:` and reference as `"$VAR"`. The current workflow does this correctly.
- **Spotify deprecated `localhost`:** the redirect URI must use `127.0.0.1` literally.
- **`localhost` vs `127.0.0.1`:** the redirect URI in Spotify Dashboard, `config.yaml`, and `setup.js`'s `app.listen("127.0.0.1", ...)` must all match.
- **Spotify `/tracks` is deprecated:** the script hits `/items` directly via `fetch` because `spotify-web-api-node`'s `getPlaylistTracks()` still uses the old endpoint (`index.js:198-203`).
- **Refresh-token rotation:** Spotify occasionally rotates refresh tokens. If a CI run starts failing auth, re-run `npm run setup` locally and update `SPOTIFY_TOKEN`.
- **Cron drift:** GitHub cron is UTC and has no DST. A `0 6 * * *` schedule = 08:00 Berlin in summer, 07:00 in winter.
