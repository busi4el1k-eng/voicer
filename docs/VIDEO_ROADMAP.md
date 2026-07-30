# Video roadmap — from audio to a full dubbed clip

Goal: reproduce *The Choicer Voicer* gameplay end to end — a game-show where you
perform lines — but evolve the media in stages so each stage ships something
playable. Visual language stays **Gartic Phone** (chunky, hard shadows, sound
motifs) the whole way; only the media under the ribbon gets richer.

The one screen that carries every stage is `<Ribbon>`. The scene media sits
*above* it; the ribbon is always the meter/clock/score.

---

## Stage 0 — Audio only ✅ DONE

- Reference is `audio.mp3`. Reveal plays it aloud; perform replays it **muted**
  while recording; the robot judge (`src/lib/judge`) scores f0/rhythm/timbre.
- Media on screen: the scene card (title + transcript) + the ribbon waveform.
- Files: `scenes/<slug>/audio.(mp3|wav|ogg)`.

## Stage 1 — Poster + audio

- Add `poster.jpg`. Show the still above the ribbon during reveal/perform so the
  scene has a face. Zero logic change — loader shows poster if present.
- Solo `ScenePlayer` gains an `<img>` slot; everything else identical.

## Stage 2 — Muted-video perform (the core dub mechanic)

- Add `video.mp4`. This is the mechanic that makes it "cinema dub":
  - **Reveal:** play `video` **with** its audio (watch + hear the original).
  - **Perform:** replay the **same video muted** while recording — you dub over
    the picture, timed to the cut. This is exactly the original game's dub loop.
- Implementation: one `<video>` element; toggle `muted`. Drive the perform
  countdown from `video.duration`. The ribbon still shows your live level +
  playhead. Prefer short clips (2–6s) so takes stay ~25KB Opus.
- Loader rule: `video ?? poster ?? audioOnly` — richest media wins.

## Stage 3 — Playback with your voice dubbed in (preview)

- On the verdict/showcase screen, play `video` **muted** + the player's recorded
  audio in sync (two elements, common `play()`), so you *see your dub*.
- Nothing is rendered/exported yet — it's a live A/V preview in the browser.
- This is where the payoff lands: hearing your take over the real picture.

## Stage 4 — Export one full dubbed video (the "final video")

Mux the player's audio onto the scene video into a single shareable `.mp4`,
uploaded to `voicer/renders/<run-id>/<scene>.mp4`.

Three ways, pick per constraints:

| Approach | Where | Notes |
|---|---|---|
| **ffmpeg worker** | server (Node) | Most reliable. Download `video.mp4` + take, `ffmpeg -i video -i take -map 0:v -map 1:a -c:v copy -shortest out.mp4`, `PutObject` to `renders/`. Needs an ffmpeg binary / a small worker (Fly/Railway), not a serverless route. |
| **MediaRecorder + canvas** | browser | Draw `<video>` to a canvas, capture `canvas.captureStream()` + the take's audio track, record to webm, upload. No server compute; quality/codec varies by browser. |
| **WebCodecs** | browser | Best quality client-side, more code; Chrome-first. |

Recommended: start with the **ffmpeg worker** (deterministic, same box as the
Socket.IO server later). Store the result public-read only if the player shares.

## Stage 5 — Full video packs + shareable recaps

- Ship a real video pack (e.g. `cursed-cinema`) of short **public-domain** clips
  in `voicer/packs/`, imported to the DB via `POST /api/library/import`.
- Online mode's podium offers "Copy recap link" → the Stage-4 render.
- Optional: a compilation render stitching all 6 scenes of a run into one reel.

---

## What copies directly from the original game

- **Game-show framing** — host intro, reference clip, perform, judges score.
  We already have the judge + verdict; add host/studio dressing as art.
- **Dub mode** = Stage 2–4 above.
- **Content packs from a folder** — their "drop files in a folder" becomes our
  `voicer/packs/<slug>/scenes/<slug>/...` on Spaces (`docs/SPACES_STRUCTURE.md`).
- **Customizable studio/judges/host** — later, as additional pack asset types
  (`studio/`, `judges/`, `host/` folders) read the same way.

## Design guardrails (keep it Gartic, not corporate)

- Media sits in a chunky rounded frame with the hard offset shadow; no glassy UI.
- The ribbon remains the hero; video is the guest, not the star.
- Phase changes are the 180ms wipe, confetti only on the podium.
- Everything degrades: no video? show poster. No poster? show the waveform.
