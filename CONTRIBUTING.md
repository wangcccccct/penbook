# Contributing

Thank you for considering a contribution to Penbook.

## Before you start

- For bugs and feature ideas, open a GitHub issue and describe the Obsidian version, platform, and steps to reproduce. Do not attach private notebooks or personal data.
- For code changes, open a pull request with a focused description of the user-visible behavior and any limitations.
- Keep changes independent of Goodnotes or other proprietary code and assets. Penbook is independently implemented; the Goodnotes name is used only to describe the product inspiration.

## Build

Requirements: Node.js 20 or newer and npm.

```sh
npm install
npm run build
```

The plugin bundle is generated in `release/penbook/`. Do not commit generated output, `node_modules`, personal `.penbook` notebooks, or local reference material.

By submitting a contribution, you agree that it is provided under the license in this repository. Please do not submit code or assets you do not have the right to contribute.
