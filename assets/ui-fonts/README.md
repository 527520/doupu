# Pinned UI font sources

- Noto Sans SC variable: version 2.004, upstream `notofonts/noto-cjk@f8d157532fbfaeda587e826d4cd5b21a49186f7c`, `Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf`; OFL-1.1.
- ChillRoundF: version 3.000, upstream `Warren2060/ChillRound@46dda1602729b58de96e3fdee9f918d7aaa64727`, `ChillRoundF v3.0.ttf`; OFL-1.1 with reserved font names.

Source checksums are pinned in `scripts/build-ui-font-subset.mjs` and emitted in `public/fonts/ui/manifest.json`. Upstream license texts remain intact beside both sources and distributed files. Derivatives are named **DouPu Text** and **DouPu Round**; upstream names are attribution, not names of modified fonts.

Explicit offline regeneration: install `fonttools==4.60.1` in an isolated Python environment, then run `node scripts/build-ui-font-subset.mjs --python /path/to/that/python`. This uses the existing locked subset-font/HarfBuzz tooling. Commit generated WOFF2, CSS and manifest together. Ordinary development and production build run only `node scripts/check-ui-fonts.cjs`; they never download fonts or need Python.
