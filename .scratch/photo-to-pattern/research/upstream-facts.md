# Upstream Research Fact Sheet — Perler Bead Pattern Generators

> Scope: `Zippland/perler-beads` (intended base) and `liangdabiao/perler-beads-ai` (reference; AI features excluded, non-AI features candidate).
>
> Method: primary sources only. Both repos were downloaded as source tarballs and read directly (raw `README.md`, `package.json`, `LICENSE`, source under `src/`, `functions/`, etc.). GitHub API was rate-limited, so repo metadata (stars, last commit) came from the `commits/*.atom` feed and the repo HTML page via a Node fetch (pwsh `Invoke-WebRequest`/`curl` were blocked by the local sandbox — TLS schannel failure; Node `fetch` worked). Anything not directly observed is marked **unverified**.

---

## Facts relevant to product decisions (top-level)

1. **License is the biggest risk.** `Zippland/perler-beads` is **AGPL-3.0** — both its `README.md` (badge + "许可证 AGPL-3.0" section) and its `LICENSE` file (full AGPL-3.0 text, plus a Chinese preamble explicitly forbidding "包装为闭源商业产品" / packaging as a closed-source commercial product). A derivative of it is strong-copyleft: it must be open-sourced under AGPL-3.0, and if served over a network it must offer its source to users (AGPL §13). The repo's `CLAUDE.md` footer says "许可证 Apache 2.0" — that is **stale/incorrect**; the authoritative file is AGPL-3.0. **Verify this before adopting the base.**
2. **The fork's Apache-2.0 claim is a red flag.** `liangdabiao/perler-beads-ai` ships an Apache-2.0 `LICENSE` with `Copyright 2024 Zippland`, even though it is derived from Zippland's AGPL code. That relicense lacks a basis in the upstream license; do not rely on it as cover. (Its own README also says "Apache 2.0".)
3. **Both apps are fully client-side.** No accounts, no auth, no backend database in either. All pixelation, color-matching, background removal, and export run in-browser via the Canvas API. `liangdabiao` adds exactly one serverless function — and it is *only* for the AI feature (excluded from scope).
4. **Shared, high-value assets are identical in both repos** (byte-identical): `src/app/colorSystemMapping.json` (palette data), `colorSystemUtils.ts`, `floodFillUtils.ts`, `pixelEditingUtils.ts`. The **base is the more current** of the two for the algorithm (`Zippland` upgraded color distance to perceptual Oklab; `liangdabiao` still uses plain Euclidean RGB — it is an *older* fork snapshot).
5. **Gaps to fill in a derivative product** (absent in both): no dithering (only on Zippland's roadmap), no PDF export, no native project save format (only a hex-grid CSV), no i18n (Chinese-only), no test suite, and — in the current code — **no 168/144/96 preset palettes** (the README/CLAUDE.md claim them, but the code only supports "all 291 colors or a custom subset").
6. **Candidate non-AI features from the fork:** image cropping (react-cropper / cropperjs). Everything else in the fork's non-AI surface already exists in the base.

---

## Project 1 — `Zippland/perler-beads` (intended base)

Repo: <https://github.com/Zippland/perler-beads> · branch `master` (observed in README raw URLs and tarball).

### License
- **AGPL-3.0** (`LICENSE`, full GNU AGPLv3 text). The file is prefixed with a Chinese "开源共创声明" (open-source co-creation statement) warning against turning it into a closed-source commercial product and requiring attribution.
- README badge and "许可证" section both say AGPL-3.0, © Zippland.
- ⚠️ `CLAUDE.md` (footer) incorrectly says "Apache 2.0". Treat AGPL-3.0 as authoritative.

### Tech stack
| Concern | Finding |
|---|---|
| Framework | Next.js **15.3.6** (App Router), React **19**, TypeScript **5** |
| Language | TypeScript |
| Build tool | Next.js (`next build`); `server.js` + `scripts/generate-cert.js` for a custom local Node/HTTPS server |
| Styling | Tailwind CSS **4** (`@tailwindcss/postcss`) |
| State management | **None** (plain React Hooks — `useState`/`useRef`/`useEffect`/`useMemo`) |
| UI library | **None** (hand-rolled components under `src/components/`); Tailwind only |
| Test framework | **None** — no test files, no test runner, no `test` script |
| PWA | `next-pwa` (service worker, manifest, generated icons) |
| Analytics | `@vercel/analytics` |
| Image lib | `sharp` (devDependency only; runtime image work is Canvas API) |
| Deployment | Vercel (README); live at `perlerbeadsold.zippland.com` (mobile) / `perlerbeads.zippland.com` (desktop) |

`package.json` scripts: `dev`, `build`, `start`, `lint` only.

### Feature list
- **Photo upload**: drag-and-drop or file picker, JPG/PNG (client-side Canvas loading).
- **Palette / brand selection**: 5 brand color-number systems — **MARD, COCO, 漫漫, 盼盼, 咪小窝** — via a color-system selector (`colorSystemOptions` in `colorSystemUtils.ts`). All 291 colors active by default; a custom palette editor (`CustomPaletteEditor.tsx`) lets users toggle individual colors; selection persists to `localStorage` (key `customPerlerPaletteSelections`).
- **Quantization method**: per-cell representative color with two modes — **Dominant** ("卡通/主色", most frequent opaque RGB in the cell) or **Average** ("真实/平均色") — then **nearest-palette-color** linear scan using **Oklab perceptual distance** (`colorDistance` ×100, `findClosestPaletteColor`). Transparent pixels (alpha < 128) ignored.
- **Dithering**: **not implemented** (listed on roadmap: "Floyd-Steinberg 抖动").
- **Pixel editing tools**: single-pixel paint, **flood-fill erase**, **color replace** (batch), eraser, color exclusion/remapping, **one-click background removal**, undo/redo edit history. (`pixelEditingUtils.ts`, `floodFillUtils.ts`, `usePixelEditingOperations.ts`, `useManualEditingState.ts`.)
- **Background removal**: border-most-frequent-color detection + stack-based flood fill (`handleAutoRemoveBackground` in `page.tsx`).
- **Export formats**: **PNG** (grid with optional cell numbers, grid lines, coordinate axes, color-count stats block, QR/watermark, title bar) via `canvas.toDataURL`; **CSV** (hex-grid, `TRANSPARENT` for external cells) via Blob. **No PDF, no other raster formats.**
- **Save/load**: CSV import (`importCsvData` → restores the hex grid), CSV export; palette selections in `localStorage`. **No native project-file format, no server persistence.**
- **i18n**: **none** (hardcoded Chinese UI strings; no i18n library).
- **Accounts/backend**: **none** (fully client-side; no auth, no DB).
- **Extras**: focus/beading mode (`focus/page.tsx`), magnifier tool, floating toolbar/palette, PWA install, donation modal, grid hover tooltip with color key.

### Bead brand palettes
- **Brands**: MARD, COCO, 漫漫, 盼盼, 咪小窝 (5).
- **Data location**: `src/app/colorSystemMapping.json` (single JSON object: hex string → `{ MARD, COCO, 漫漫, 盼盼, 咪小窝 }`). 29,063 bytes.
- **Format**: hex-keyed object; each brand value is a color-number string (e.g. `"#FFFFFF": {"MARD":"T01","COCO":"L14","漫漫":"L6","盼盼":"155","咪小窝":"51"}`).
- **Color count**: **291 hex colors**; every color maps to **all 5 brands** (291 entries per brand). Verified by parsing the file.
- Also present at repo root: `色号对应表.csv` (a color-number mapping CSV) — **could not extract its contents** in this sandbox (Chinese filename broke `tar` extraction); existence confirmed, contents **unverified**. README also references `paletteOptions` (168/144/96 presets) in `page.tsx`, but **no such preset arrays exist in the current code** (init uses `presetToSelections(allHexValues, allHexValues)` = all 291). Treat 168/144/96 presets as **documentation drift / not implemented**.

### Image → pattern algorithm
Source files: `src/utils/pixelation.ts`, `src/utils/colorSystemUtils.ts`, `src/utils/floodFillUtils.ts`, `src/utils/pixelEditingUtils.ts`, and the orchestration in `src/app/page.tsx` (`pixelateImage`, ~lines 818–1049).

1. **Downscaling / grid**: `N = granularity` (slider, horizontal cell count); `M = round(N × aspectRatio)`. Each cell maps to a source rectangle; `calculateCellRepresentativeColor` picks the most-frequent opaque RGB (Dominant) or the mean RGB (Average). Alpha < 128 ignored. (`calculatePixelGrid`.)
2. **Palette matching**: `findClosestPaletteColor` = linear scan for minimum **Oklab** distance (`colorDistance` = sqrt(ΔL²+Δa²+Δb²) × 100, with an Oklab cache; `rgbToOklab`/`srgbChannelToLinear`). Early-exits on exact match. Fallback color for empty cells: `T1` / `#FFFFFF` / palette[0].
3. **Color merging** (note: code differs from docs): sorts colors by frequency, then for each higher-frequency color replaces every lower-frequency color whose Oklab distance is `< similarityThreshold` (default 30). This is a **global frequency-based merge**, *not* the BFS connected-region merge described in README/CLAUDE.md (doc drift).
4. **Background removal**: `handleAutoRemoveBackground` — count colors on the grid border, pick the most frequent, flood-fill from all border cells of that color and mark them transparent/external (`isExternal`). (README describes a `BACKGROUND_COLOR_KEYS` list like T1/H1, but the code auto-detects the dominant border color.)
5. **Exclusion/remap**: excluding a color remaps its non-external cells to the nearest color in the still-present/unexcluded subset; re-including triggers full reprocess.

### Export implementation
`src/utils/imageDownloader.ts` (`downloadImage`, `exportCsvData`, `importCsvData`), options in `src/types/downloadTypes.ts` (`GridDownloadOptions`: `showGrid, gridInterval, showCoordinates, showCellNumbers, gridLineColor, includeStats, exportCsv`).
- **PNG**: draws onto a temp `<canvas>` (cell size 30 px, white background, branded title bar "七卡瓦", QR code, optional coordinate axes, per-cell color + color key text, optional grid interval lines, optional stats block with swatch/color-key/count "N 颗" and total "总计: N 颗", watermarks), then `canvas.toDataURL('image/png')` and triggers an `<a download>`.
- **CSV**: comma-joined grid of hex values (`TRANSPARENT` for external), filename `bead-pattern-{N}x{M}-{system}.csv`; Blob + object URL download. Import parses it back into `MappedPixel[][]` (validates hex format and column counts).
- **No PDF** (grep for `pdf`/`jsPDF` returned nothing).

### Tests
- **None.** No `*.test.*`/`*.spec.*`, no `__tests__`, no test runner in `package.json`. Lint (ESLint 9 + `eslint-config-next`) is the only static check. (Also present: `final_review_gate.py` and `.cursor/rules/` — agent-oriented review scaffolding, not a test suite.)

### Recency / maintenance
- **Last commit (branch `master`)**: **2026-05-14** (via commits atom feed).
- **Stars**: **~863** (parsed from repo HTML).
- **Status**: actively maintained; mobile and desktop deployments live; README has a roadmap (CIEDE2000, dithering, Web Workers, palette upload, WeChat mini-program).

---

## Project 2 — `liangdabiao/perler-beads-ai` (reference)

Repo: <https://github.com/liangdabiao/perler-beads-ai> · branch `main`. Fork of `Zippland/perler-beads` ("我基于开源项目：Zippland/perler-beads" per its README), with AI + deployment + UX additions.

### License
- Ships **Apache-2.0** `LICENSE` with `Copyright 2024 Zippland`; README says "Apache 2.0".
- ⚠️ Legal inconsistency: upstream is AGPL-3.0; this fork is an Apache-2.0-labeled derivative with no demonstrated relicense right. Flag for legal review; do not treat as permissive cover.

### Tech stack (deltas vs base)
Same Next.js 15.3.6 / React 19 / TS 5 / Tailwind 4 / no state lib / no UI lib / no tests.
- **Added**: `cropperjs` 2.1.0 + `react-cropper` 2.3.3 (image cropping); `wrangler` 4.83.0 (Cloudflare Pages); `functions/` (Pages Functions).
- **Removed vs base**: `next-pwa`, `@vercel/analytics`, `sharp`.
- **Deployment**: Cloudflare Pages **static export + one Pages Function** (`next.config.ts` static export to `out/`, `wrangler.toml`, scripts `pages:dev`/`pages:deploy`). Also a `no-backend` branch for pure-static hosting.

### AI features — **EXCLUDED from the product** (classification)
- **AI "optimize" (image → chibi/pixel-art restyle)**: the only AI capability.
  - `src/utils/aiOptimize.ts` — client helper: `imageToBase64` (resize ≤2048, ≤4 MB), `optimizeImageWithAI` (POST to `/api/ai-optimize`), `downloadImageAsDataURL`. Default prompt: "chibi画风，背景白底。pixel art style, 16-bit…".
  - `functions/api/ai-optimize.ts` — Cloudflare Pages Function `onRequestPost` calling 火山引擎 (Volcano Engine) 即梦/Jimeng (`req_key: jimeng_t2i_v40`), async submit (`CVSync2AsyncSubmitTask`) + poll (`CVSync2AsyncGetResult`), HMAC-SHA256 signing, needs `VOLC_ACCESS_KEY_ID`/`VOLC_SECRET_ACCESS_KEY`.
  - `src/lib/volcEngineClient.ts` — browser-direct variant of the same signing/call for static deployment.
  - `src/components/AIOptimizeModal.tsx` — the modal; `api.md` — the (vendored) Volcano API doc.
  - **All of the above = AI-based → exclude.** It is a paid/external image-generation service (risk-screening, QPS limits, 1–3 min latency, API keys in env).

### Non-AI features — **candidates to adopt** (classification)
- **Image cropping (plain UX)** ✅ candidate — `src/components/ImageCropperModal.tsx` using `react-cropper`/`cropperjs`: free aspect ratio (`aspectRatio={NaN}`), rotate ±90°, reset, then re-pixelate.
- **Everything else non-AI** (pixelation modes, brand selection, custom palette, exclusion/remap, background removal, manual editing, PNG/CSV export, focus mode, magnifier, floating toolbar/palette) — **already present in the base** and byte-identical or near-identical; adopt from the base, not the fork.
- Note: the fork's README advertises "导出采购清单（支持CSV格式）" but the only CSV code is the same hex-grid `exportCsvData` as the base — there is **no separate brand-number purchase-list CSV** in the code.

### Algorithm (fork vs base)
- `colorSystemUtils.ts`, `floodFillUtils.ts`, `pixelEditingUtils.ts`, `colorSystemMapping.json` are **byte-identical** to the base.
- `pixelation.ts`, `imageDownloader.ts`, `page.tsx` differ. Notably, the fork's `colorDistance` is **plain Euclidean RGB** (`sqrt(dr²+dg²+db²)`), not Oklab — i.e. the fork is based on an **older Zippland snapshot** before the Oklab upgrade. Same Dominant/Average modes and nearest-color linear scan otherwise.
- No dithering (same as base; only Zippland's roadmap mentions it).

### Tests
- **None** (no test files/runner). The only "test" is `test-api.js` — a **standalone Node script to smoke-test the Volcano Engine AI API** (signing + submit + poll), not a unit/integration suite. AI-only relevance anyway.

### Recency / maintenance
- **Last commit (branch `main`)**: **2026-04-17** (via commits atom feed).
- **Stars**: **~250** (parsed from repo HTML).
- **Status**: maintained; README documents Cloudflare/Vercel deployment and links a companion WeChat mini-program repo (`liangdabiao/perlerBeadsApplet`).

---

## Cross-project comparison (quick table)

| Dimension | Zippland/perler-beads (base) | liangdabiao/perler-beads-ai (reference) |
|---|---|---|
| License (authoritative file) | AGPL-3.0 | Apache-2.0 (attributed "Zippland"; legally questionable) |
| Palette data | 291 hex × 5 brands (identical file) | identical |
| Color distance | **Oklab** (newer) | Euclidean RGB (older fork) |
| Pixelation modes | Dominant / Average | same |
| Merge | global frequency-based | same (older snapshot) |
| Dithering | none (roadmap) | none |
| Export | PNG + CSV | PNG + CSV |
| Backend/accounts | none | one AI-only serverless function |
| Cropping | none | ✅ react-cropper |
| PWA | ✅ next-pwa | ✗ removed |
| Deployment | Vercel | Cloudflare Pages (+ no-backend branch) |
| Tests | none | none (`test-api.js` is AI smoke test) |
| i18n | none (zh only) | none (zh only) |
| Stars / last commit | ~863 / 2026-05-14 | ~250 / 2026-04-17 |
