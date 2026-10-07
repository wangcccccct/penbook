# Changelog

## 0.2.0

- Keep every imported PDF embedded in the notebook, including files above 150 MB. Use chunked encoding, bounded caches, and shared PDF export resources.
- Copy and cut selections across notebooks, including their image resources and groups.
- Edit table cells and change row/column counts.
- Export strokes, text, shapes, tables, and tape as SVG vectors.
- Import PDF outlines and follow native PDF links; preserve destinations when merging pages.
- Convert common standard PDF annotations into editable objects and export standard annotation objects. Preserve Penbook-specific details in an embedded annotation archive.
- Crop PDF pages with support for rotated pages and native text selection.
- Bundle PDF.js 6.4.299; keep the PDF parser and its assets local.
