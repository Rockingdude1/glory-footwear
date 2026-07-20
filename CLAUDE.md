# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-file, mobile-first product catalog web app ("GLORY FOOTWEAR — Live Catalog") that displays live footwear inventory sourced from a published Google Sheets CSV feed. The entire application — CSS, markup, and JavaScript — lives in `index.html`. There is no build system, package manager, framework, or test suite.

## Running

Open `index.html` directly in a browser, or serve it locally (e.g. `python -m http.server`). Fetching the Google Sheets CSV requires network access; if the fetch fails, the app falls back to `DEMO_ITEMS` (currently empty) and shows a warning toast.

## Architecture

Everything is in `index.html`, organized as:

- **Configuration** (top of the `<script>`): `GOOGLE_SHEET_CSV_URL` — the published Google Sheets CSV endpoint that is the app's data source — and `LOW_STOCK_THRESHOLD` (stock ≤ this shows the amber "Low" badge; 0 shows "Out of stock").
- **State + render loop**: A single global `state` object and a `render()` function that rebuilds the whole app as an HTML string into `#app` on every change (no virtual DOM, no diffing). All event handlers (`setSearch`, `setCategory`, `openDetail`, etc.) mutate `state` and call `render()`, and are wired via inline `onclick`/`oninput` attributes, so they must remain global functions.
- **Data pipeline**: `loadCatalog()` fetches the CSV → `parseCSV()`/`splitCSVLine()` (hand-rolled, quote-aware CSV parser) map rows to item objects. Header names are lowercased with spaces stripped, so the sheet columns "NAME", "STOCK", "CATEGORY", "COLOR", "SIZE", "IMAGE URL" map to `name`, `stock`, `category`, `color`, `size`, `imageurl`. `NAME` and `STOCK` columns are required; an item's `name` doubles as its unique `code`/ID.
- **Auto-refresh**: The catalog reloads every 25 seconds via `setInterval`, skipped while a detail sheet is open (`state.selectedCode` set).

## Conventions

- All dynamic values interpolated into HTML must go through `esc()` (HTML-escaping) — and additionally `.replace(/'/g,"\\'")` when embedded inside inline `onclick` string arguments.
- The category filter chips are a hardcoded list in `getCategories()` (`Hawai`, `Fabrication`, `PU`, `School Shoe`, `Sports Shoe`), not derived from the data — update it there if the sheet's categories change.
- Colors, fonts, and radii are defined as CSS custom properties in `:root` (dark green background, cream cards, brass accent; Oswald/Inter/JetBrains Mono via Google Fonts).
