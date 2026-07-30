# DigitalOcean Spaces layout — `voicer/`

All Cinema Dub media lives in the **same bucket** as `digital_standarts`
(`digital-standart-lib`, region `fra1`), under the `voicer/` prefix. Public read
base:

```
https://digital-standart-lib.fra1.digitaloceanspaces.com/voicer/<key>
```

Reading is done exactly like `digital_standarts/products-library`: list folders
via `ListObjectsV2` + `Delimiter: "/"` (CommonPrefixes), then recurse into
`Contents`. See `src/lib/spaces.ts` and `src/app/api/library/route.ts`.

## Tree

```
voicer/
├── packs/
│   └── <pack-slug>/                 # e.g. cursed-cinema
│       ├── pack.json                # pack metadata (see below)
│       ├── cover.jpg                # pack tile art (public-read)
│       └── scenes/
│           └── <scene-slug>/        # e.g. the-reveal
│               ├── scene.json       # scene metadata (see below)
│               ├── audio.mp3        # STAGE 1 — reference line audio
│               ├── poster.jpg       # STAGE 2 — still frame
│               └── video.mp4        # STAGE 3 — full cinematic clip
│
├── takes/                           # raw player recordings — EPHEMERAL
│   └── <run-id>/
│       └── <scene-slug>.webm        # 24h lifecycle rule → auto-deleted
│
└── renders/                         # STAGE 4 — produced dubbed videos
    └── <run-id>/
        └── <scene-slug>.mp4         # player voice muxed onto the scene video
```

The game reads media **progressively** (see `docs/VIDEO_ROADMAP.md`): a scene is
playable with only `audio.mp3`; `poster.jpg` and `video.mp4` are added later
without any schema change — the loader just uses the richest media present.

## `pack.json`

```json
{
  "name": "Cursed Cinema",
  "subtitle": "Melodrama, dialed to eleven",
  "isOfficial": true
}
```

## `scene.json`

```json
{
  "title": "The Reveal",
  "filmLabel": "Cursed Cinema",
  "transcript": "It was you all along.",
  "emotionTag": "shock",
  "difficulty": 2,
  "durationMs": 3000,
  "media": { "audio": "audio.mp3", "poster": "poster.jpg", "video": "video.mp4" }
}
```

## ACL & lifecycle

- **`packs/**`** — `public-read`. The browser must `fetch()` + `decodeAudioData`
  the audio for scoring and stream the video, so these need public URLs (and CORS
  `GET` allowed on the Space).
- **`takes/**`** — upload with an **unguessable** `<run-id>` and set a **24-hour
  expiry lifecycle rule** on the `voicer/takes/` prefix. These are private-ish by
  obscurity; prefer a bucket lifecycle rule so cleanup is automatic (matches the
  build prompt's "24h lifecycle").
- **`renders/**`** — `public-read` only for clips the player chooses to share;
  otherwise keep private and hand out short-lived **signed URLs**.

## CORS (set once on the Space)

Allow `GET` (audio/video streaming + decode) and `PUT` (take uploads) from the
app origin:

```
AllowedOrigins: https://your-app-domain, http://localhost:3000
AllowedMethods: GET, PUT
AllowedHeaders: *
```

## Uploading (next step, not yet built)

Two paths, both using the same `S3Client` from `src/lib/spaces.ts`:

1. **Pack authoring** — an admin/creator uploads `pack.json` + scene folders.
2. **Take/render upload** — the app `PutObject`s the player's `.webm` to
   `takes/<run-id>/` and, at Stage 4, the muxed `.mp4` to `renders/<run-id>/`.

A `POST /api/library/import` route can then walk `voicer/packs/` and upsert
`Pack`/`Scene` rows so remote packs show up in solo/online exactly like the
seeded local ones.
