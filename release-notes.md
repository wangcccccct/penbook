# Penbook 0.3.0

This is a prerelease for Obsidian UI testing; the automated PDF and regression checks listed below pass.

This release expands standard PDF annotation round-tripping and includes all features from 0.2.0, including embedded PDFs, editable tables, cross-notebook selection copy/cut, vector object SVG export, bookmarks, links, and page cropping.

Native annotation types and appearances are retained, including stamps, caret annotations, file attachments, text markup, polygons, polylines, and complex annotation data. You can select, move, resize, rotate, copy, delete, and edit their comments. FreeText edits update the visible appearance and retain font size/color. Embedded attachment bytes, popup/reply relationships, and form values are covered by regression tests.

Complex annotations retain their original data and preview. Media playback, 3D interaction, form filling, digital signing, and applying redactions are not added by this release. Obsidian UI verification remains separate from the automated PDF tests.

## Installation

Download **penbook.zip**, extract the `penbook` folder, and copy its contents into your vault's `.obsidian/plugins/penbook/` folder. Keep the `cmaps`, `standard_fonts`, `wasm`, and `licenses` directories. Reload Penbook in Obsidian.

The separate `main.js`, `manifest.json`, and `styles.css` assets are also provided. The ZIP is the complete installation package, including local PDF resources and licenses. `SHA256SUMS.txt` contains checksums for these downloads.

## Validation

- 26 annotation subtypes at 0°, 90°, 180°, and 270°, plus native links and popup annotations.
- Appearance comparisons, embedded attachment bytes, replies, hidden fields, radio groups, deletion, edited FreeText, and rotated/resized cross-notebook copies.
- 72 eraser pixel cases, geometry holes, split strokes, save/reload, shortcut and save lifecycle regressions.
- A 151 MB PDF saved entirely inside a notebook, reopened without its original file, checked for byte equality, and exported.
- Bundled PDF.js 6.4.299; production dependency audit reports no known vulnerabilities.
