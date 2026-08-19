# Film Lab

A **film emulation darkroom that runs entirely in the browser**. Drop in a photo,
pick an emulsion, and watch it develop — characteristic curves per colour layer,
wavelength-dependent halation, grain that responds to exposure, scanner profiles.
Nothing is uploaded. There is no backend.

This is a self-driven portfolio project. After building a data pipeline and cloud
architecture in [SolarSurge](https://github.com/MarcelFelder-git), I wanted to go the
other way: **deep into the frontend**, into GPU programming and colour science, and
build something where the hard part is visible on screen.

> Built with an AI pair-programming workflow (Claude Code). I drove the architecture
> and can walk through every decision.

## Table of Contents

- [What It Does](#what-it-does)
- [The Interesting Part: How Film Actually Works](#the-interesting-part-how-film-actually-works)
- [The Pipeline](#the-pipeline)
- [Features](#features)
- [Where the Model Earns Its Place](#where-the-model-earns-its-place)
- [Technologies Used](#technologies-used)
- [Honesty](#honesty)
- [Challenges & Lessons Learned](#challenges--lessons-learned)
- [Getting Started](#getting-started)
- [Live Demo](#live-demo)

## What It Does

Load a photo — by drag & drop, paste, file picker, the built-in sample scene, or the
camera. Choose a film stock and a lab scanner. Everything renders live on the GPU;
the export runs at full resolution in a Web Worker.

<!-- TODO: Screenshots hier einfuegen -->

## The Interesting Part: How Film Actually Works

Most "film filters" apply one curve to all three channels and overlay a noise
texture. That is exactly why they look like filters.

Real film has **three separate emulsion layers**, each with its own density curve.
That is where the character comes from: Portra's shadows go slightly cool while its
highlights roll off warm. A single contrast slider cannot produce that, because it
keeps grey grey.

Four more things separate "film" from "filter", and this project models all of them:

| | What real film does | Why it matters |
|---|---|---|
| **Highlight rolloff** | Never reaches pure white, just responds ever more slowly | Digital clips with a hard edge; film compresses asymptotically |
| **Lifted blacks** | Base fog means density never reaches zero | A scan has no true `0,0,0` |
| **Halation** | Light scatters *inside* the emulsion, before development | Longer wavelengths travel further — the halo reddens outward |
| **Grain** | Peaks in the midtones, vanishes in blocked shadows and blown highlights | Uniform noise overlay is the classic tell |

## The Pipeline

Five GPU passes on a single fullscreen triangle. No three.js — for one triangle a
scene-graph library is pure overhead.

```
  sRGB in
     │
     ▼
┌──────────┐   linearise, exposure, white balance,
│  SCENE   │   channel crosstalk, optional monochrome mix
└────┬─────┘
     │  linear light (RGBA16F — a lamp sits well above 1.0)
     ├──────────────────────────┐
     │                          ▼
     │                   ┌─────────────┐
     │                   │  HIGHLIGHT  │  isolate what is bright enough to scatter
     │                   └──────┬──────┘
     │                          ▼
     │                   ┌─────────────┐
     │                   │ BLUR x2     │  narrow halo + wide halo, kept separately
     │                   └──────┬──────┘
     ▼                          │
┌─────────────────────────────────────────┐
│ DEVELOP                                 │
│  scattered light ADDED TO EXPOSURE      │  ← before the curve, not after
│  H&D curve per channel                  │
│  highlight desaturation                 │
│  grain (image-space, exposure-weighted) │
│  vignette                               │
│  scanner: saturation, normalise, fog    │
│  optional film border with perforation  │
└─────────────────────────────────────────┘
     │
     ▼
  final image
```

The ordering is the point. Halation is added to the *exposure* and then runs through
the curve, because in reality light scatters in the emulsion before development. Lay
it on the finished image instead and it sits flat on top and reads as an effect.

Film stocks are **pure data**. A new emulsion is one more object in `stocks.ts`, not
a line of code — including black and white, which needed no special case in the
pipeline at all: a spectral mix before development, then three identical curves.

## Features

**Emulation** — three stocks (Portra 400, Cinestill 800T, Tri-X 400), two lab
scanners (Frontier, Noritsu), push/pull processing, two-axis white balance with a
grey-point eyedropper, crop in film formats (35mm, 6×6, 6×7), film border with
sprocket holes and edge markings.

**Understanding what you see** — the characteristic curve drawn live from the same
parameters the shader is running, a histogram with clipping warning, a draggable
before/after split, and a 1:1 view (you cannot judge grain in a fitted preview).

**Workflow** — presets including your own, undo, multiple photos side by side, batch
export, a comparison sheet of every stock in one file, look sharing via URL, and
full-resolution export in a Web Worker with EXIF preserved.

## Where the Model Earns Its Place

The film suggestion measures the image — brightness, contrast range, colour
temperature, saturation, specular area, skin-tone area — and derives a recommendation
**with its reasoning**, one sentence per signal.

That approach has a hard limit, and testing found it: sand, wood and beige walls
occupy exactly the same colour range as skin. A beach photo measured **41 % skin-tone
area with no person in it**. A plausibility bound does not separate them; I tried.

This is precisely what a model is for — and only this. An optional, locally running
CLIP model answers *what is in the picture*; brightness and contrast are still
measured directly, because measuring them is more accurate than guessing.

With the model on, the same beach photo reads "Beach (59 %)" and the reasoning
becomes: *the 41 % skin-coloured area belongs to the scene, not to a face.* Portrait
and night scenes still score 96 % and 95 %.

The model is opt-in, loads once and then runs offline, and the suggestion always says
which basis it used. If loading fails the suggestion falls back to the colour
measurements instead of disappearing.

## Technologies Used

- **Rendering:** WebGL2, hand-written GLSL, RGBA16F intermediate buffers
- **Frontend:** TypeScript, React, Vite — no UI framework, no state library
- **Off-thread work:** Web Worker + OffscreenCanvas for full-resolution export
- **On-device ML:** transformers.js (CLIP, quantised) for scene classification
- **No backend.** No accounts, no uploads, no running costs.

## Honesty

- **The curve is a simplification.** It maps scene exposure directly to the finished
  image value — negative, development and scan combined — rather than modelling
  negative density and inversion separately. Visually equivalent, considerably
  simpler.
- **Parameters are tuned by eye, not measured off film.** They are derived from how
  these stocks are described and behave, not from densitometer readings.
- **Preview is capped at 2048 px, export at 4096 px.** The scene buffer is RGBA16F;
  a 6000×4000 image would need roughly 190 MB for that buffer alone, which is a
  reliable crash on a phone.
- **Browser camera has limits.** The frame arrives already processed by the phone's
  image pipeline, and Safari exposes no manual exposure control. Import is the path
  that produces the good results; capture is the flourish.

## Challenges & Lessons Learned

**Measuring beats assuming.** Almost every real defect in this project was found by
reading pixels back out of the canvas, not by looking at it. A few that mattered:

- **The preview was lying about grain.** Grain size was defined in absolute working
  pixels, so at 2048 px preview versus 4096 px export the grain in the output file
  was half as coarse as what you saw. Grain is a property of the film, not of the
  scan resolution — it has to stay a constant fraction of the frame. Same reasoning
  the halation already used.
- **The image was milky and I could name why.** Lifted blacks are correct. Compressed
  highlights are correct. Both at full strength meant the whole image lived between
  22 and 201 — 70 % of the available range, nothing ever brighter than 79 %. Real lab
  scanners normalise the scan back to the full range; that stage was missing. Adding
  it also finally made the two scanner profiles visibly different.
- **A monochrome image came out blue.** Colour film has three independently grainy
  layers, so grain is sampled three times. Black and white has one layer — sampling
  it three times tints a greyscale image. Channel deviation went from 13 to 0.
- **`UNPACK_FLIP_Y_WEBGL` is silently ignored for `ImageBitmap` sources.** No error,
  no warning; the flag simply does nothing and the image is upside down. Flipping in
  the shader instead makes orientation independent of how the caller loaded the image.
- **A 9-tap blur cannot make a wide halo.** Spreading the taps produces visible rings,
  not glow. Bloom is computed on a heavily downscaled buffer and smoothed by bilinear
  upsampling — which also makes the halo a constant fraction of the frame, exactly
  right for a physical scattering distance.
- **An element can have a perfect size and still be invisible.** The 1:1 view measured
  correct at 2048×1536 while showing nothing: the parent frame had collapsed to 0×0
  and `overflow: hidden` clipped everything. Tests now check the visible intersection,
  not just the element.

**Knowing where a model does not belong.** The temptation with an ML feature is to
hand it the whole problem. Brightness and contrast are better measured than inferred.
The model is confined to the one question numbers genuinely cannot answer, and the
failure that motivated it is documented in the code.

**Designing for a move that hadn't happened yet.** The renderer was written without
DOM access from the first commit, on the assumption that full-resolution export would
eventually have to leave the main thread. When that day came it needed one type
change — `OffscreenCanvas` alongside `HTMLCanvasElement`. Measured with a 50 ms
ticker during export: 100 of 100 expected ticks, the main thread never blocked.

## Getting Started

Requires Node 20+.

```bash
npm install
npm run dev
```

The dev server also listens on the local network, so the app can be tested from a
phone. Note that **camera access requires a secure context** — over `http://` on a
LAN address the browser will not grant it. Use the deployed HTTPS URL for that.

```bash
npm run build     # type-check and production build
npm run preview   # serve the production build locally
```

## Live Demo

<!-- TODO: Vercel-URL nach dem Deploy eintragen -->

The scene recognition is optional and downloads its model on first use. Everything
else works immediately and offline.
