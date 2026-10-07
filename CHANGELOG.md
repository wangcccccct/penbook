# Changelog

## 0.3.0

- Preserve standard annotation subtypes, original appearance streams, comments, attachments, popup/reply relationships, and form values when importing and exporting PDFs.
- Select, move, resize, rotate, copy, delete, and edit comments on native annotations. Keep their source PDF embedded when copying them to another notebook.
- Preserve FreeText appearances until text/style changes; regenerate the appearance and retain font size/color when edited.
- Preserve complex/native annotations as movable objects with their original data and a preview. This does not add media playback, 3D interaction, form filling, digital signing, or applying redactions.
- Add regression coverage for 26 subtypes at four page rotations, plus links/popups, attachment bytes, replies, hidden fields, radio groups, deletion, and transformed copies.
- Package installable release assets with local PDF resources, licenses, and SHA-256 checksums.

## 0.2.0

- Keep every imported PDF embedded in the notebook, including files above 150 MB. Use chunked encoding, bounded caches, and shared PDF export resources.
- Copy and cut selections across notebooks, including their image resources and groups.
- Edit table cells and change row/column counts.
- Export strokes, text, shapes, tables, and tape as SVG vectors.
- Import PDF outlines and follow native PDF links; preserve destinations when merging pages.
- Convert common standard PDF annotations into editable objects and export standard annotation objects. Preserve Penbook-specific details in an embedded annotation archive.
- Crop PDF pages with support for rotated pages and native text selection.
- Bundle PDF.js 6.4.299; keep the PDF parser and its assets local.
