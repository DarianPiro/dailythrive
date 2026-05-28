# Daily Thrive

**Bring back Spotify's Daily Drive — your personal mix of podcasts and music, refreshed automatically by GitHub Actions.**

Spotify [killed Daily Drive](https://community.spotify.com/t5/Music-Discussion/Is-Daily-Drive-gone/td-p/7377710) on March 17, 2026. This project brings it back. Unlike the original (which required a Linux box, cron, and SSH), **Daily Thrive runs entirely on GitHub Actions** — no server, no laptop kept on. The workflow ships your Spotify playlist on a schedule for free.

> **You need Spotify Premium.** Since Feb 2026, Spotify requires Premium to register a Developer app. Using the API is free; you just need the Premium account.

---

## How it works

```
GitHub Actions cron  →  npm start  →  Spotify Web API  →  your playlist
        ▲                                                       │
        └──────────────  commits episode-history.json  ◄────────┘
```

Every run:
1. Pulls fresh episodes from each podcast in `config.yaml` — **skipping anything older than 2 weeks** (overridable per show), and skipping episodes you've already played (tracked in `episode-history.json`).
2. Pools your top tracks, source playlists, and genre discovery; shuffles and trims to `total_songs`.
3. Interleaves podcasts and music using your `mix_pattern`.
4. Replaces your target playlist via the Spotify API.
5. Commits the updated `episode-history.json` back to the repo so the next run knows what's already been played.

---

## Setup

### 1. Fork or clone this repo

Push it to a private GitHub repo of your own — the workflow runs from there.

### 2. Create a Spotify Developer App

1. Go to **[developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)** → **Create App**.
2. **Redirect URI:** `http://127.0.0.1:8888/callback` (exactly — `127.0.0.1`, **not** `localhost`, which Spotify removed in Nov 2025).
3. Enable both **Web API** and **Web Playback SDK**.
4. In **Settings → User Management**, add the email tied to your Spotify account (required since Feb 2026, even for the app owner — without this, playlist writes return `403`).
5. Copy your **Client ID** and **Client Secret**.

### 3. Create an empty target playlist

In Spotify, create the playlist that Daily Thrive will overwrite each run. Right-click → **Share → Copy link to playlist**, and grab the ID after `/playlist/`.

### 4. Configure locally

```bash
cp config.example.yaml config.yaml
```

Fill in `client_id`, `client_secret`, `playlist_id`, and your podcasts/music settings. The file has inline comments for every field.

### 5. Authenticate once (locally)

```bash
npm install
npm run setup
```

A browser opens; log in and click **Agree**. This writes `.spotify-token.json` with a long-lived refresh token. Tokens persist for months — you only do this once.

> **No browser on the machine running the auth?** Use SSH port forwarding: `ssh -L 8888:127.0.0.1:8888 user@server` and open the URL in your local browser.

### 6. (Optional) Dry-run to confirm it works

```bash
npm test
```

This prints the mix it would build without touching the playlist.

### 7. Add GitHub secrets

In your GitHub repo: **Settings → Secrets and variables → Actions**, add:

| Secret | Contents |
|---|---|
| `SPOTIFY_CONFIG` | Paste the entire contents of `config.yaml` |
| `SPOTIFY_TOKEN` | Paste the entire contents of `.spotify-token.json` |

Both files are gitignored — they live only in secrets. The workflow recreates them on each run.

### 8. Push and let the workflow run

The workflow at [`.github/workflows/dailydrive.yml`](.github/workflows/dailydrive.yml) is already wired up. By default it runs daily at **06:00 UTC** (08:00 Berlin in summer). You can:

- Adjust the `cron:` line to taste (GitHub cron is UTC, no DST).
- Trigger it manually from the **Actions** tab → **Daily Thrive** → **Run workflow**.

---

## What's in `config.yaml`

### Podcasts

```yaml
podcasts:
  - name: "NPR News Now"
    id: "6BRSvIBNQnB68GuoXJRCnQ"
    episodes: 1
    position: first         # always at the top, before the mix pattern

  - name: "Die Filmanalyse"
    id: "2yFO6qxFx7L2oqPdWv9DtM"
    episodes: 1
    allow_older: true       # opt out of the 2-week freshness filter
```

Per-show flags:

| Flag | Meaning |
|---|---|
| `episodes` | how many episodes to pull (default `1`) |
| `position: first` | pin this show to the top |
| `allow_older: true` | disable the 14-day cutoff for evergreen shows (interviews, film analysis, etc.) |

Episodes already placed on a previous run are tracked in `episode-history.json` (capped at 1000 most-recent URIs) and skipped automatically.

### Music sources

```yaml
music:
  top_tracks:
    enabled: true
    time_range: "short_term"   # short_term (~4w), medium_term (~6mo), long_term (all-time)
    count: 50                  # pool size before shuffle

  genres:
    - hyperpop
    - synth pop
    - electronic

  playlists:
    - name: "2026 Megamix"
      id: "3VQKTI0HQbMOlr8drD7W7h"

  total_songs: 50
  shuffle: true
```

When genres are set, the music pool is split 50/50 between **familiar** (top tracks + source playlists) and **discovery** (genre search).

### Mix pattern

| Pattern | Behavior |
|---|---|
| `PMMMM` | 1 podcast, 4 songs, repeat |
| `MMMP` | 3 songs, 1 podcast, repeat |
| `PM` | strict alternation |

Once one side runs out, the rest of the other side is appended in a block.

---

## Auto-generate your genres

If you don't want to think about genre tags, an LLM can read your listening history and write the `genres:` block for you.

```bash
# OpenAI (default model: gpt-4o-mini)
echo "OPENAI_API_KEY=sk-..." > .env
npm run taste:openai

# Google Gemini (free tier)
echo "GEMINI_API_KEY=AIza..." > .env
npm run taste:google
```

Both write the result directly into `config.yaml`. After running, update the `SPOTIFY_CONFIG` secret so the workflow sees it.

---

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | One-time Spotify login (writes `.spotify-token.json`) |
| `npm start` | Build/refresh the playlist (used by the workflow) |
| `npm test` | Dry run — prints the mix it would build |
| `npm run taste:openai` | Auto-detect genres via OpenAI |
| `npm run taste:google` | Auto-detect genres via Google Gemini (free tier) |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Workflow step `Restore secret files` fails with `command not found` | Almost always a shell-quoting collision in the secret. The repo workflow already passes secrets via `env:` to dodge this; if you changed it, revert to the `env:`/`"$VAR"` pattern. |
| `403 Forbidden` on playlist write | In the Spotify Dashboard → your app → Settings → User Management, add your Spotify email. |
| `404 Not Found` | Wrong podcast/playlist ID in `config.yaml`. |
| Token expired | Re-run `npm run setup` locally, then update the `SPOTIFY_TOKEN` secret. |
| Playlist empty | `npm test` to inspect; usually a config typo or a market-restricted show. |
| Workflow can't push `episode-history.json` | Check that the job has `permissions: contents: write`. |

---

## Background

Spotify launched **Your Daily Drive** on June 12, 2019 — a rotating playlist mixing music with news and podcast clips, ~25 items total (19 songs + 5–6 podcast segments), updated multiple times daily. The feature was fully removed on March 17, 2026.

Daily Thrive recreates the format — but *you* control the inputs, the cadence, and the mix.

---

## License

MIT. Originally forked from [patdeg/dailydrive](https://github.com/patdeg/dailydrive); reworked to run on GitHub Actions instead of a Linux VPS.
