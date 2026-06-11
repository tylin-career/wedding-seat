# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-page wedding seat-finder web app (婚宴尋座) for guests at 林鼎元 & 陳蓓蓓's wedding (2026-07-18, 台北士林萬麗酒店). Guests type their name, see their table assignment, and watch an animated route from the ballroom entrance to their table on an SVG floor map. Little Prince (小王子) star-themed design.

The entire app — HTML, CSS, and JavaScript — lives in a single `index.html` file. There is no build step, no package manager, no dependencies (only Google Fonts via CDN), and no test suite.

All UI text and git commit messages are in Traditional Chinese (zh-Hant); keep that convention.

## Development

Edit `index.html` directly and preview in a browser. To serve locally:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

There are no lint, build, or test commands.

## Architecture

The `<script>` block in `index.html` is organized into commented sections (`/* ===== 名稱 ===== */`):

- **設定 (`CONFIG`)** — LINE official-account URL (empty hides the buttons) and `mPerPt`, the PDF-point→meter scale used to compute the "約 X 公尺" walking distance (calibrated against the 732cm stage edge and 180cm round tables).
- **名單資料 (`TABLES`)** — the guest list: `{no, name, guests[]}` per table. **A name repeated N times in `guests[]` means that party has N reserved seats** — search collapses duplicates into one entry with a ×N badge. A table with an empty `guests[]` renders as a dashed "備" (spare) circle and is excluded from search.
- **場地幾何 (`GEO`)** — venue geometry in PDF-point coordinates taken from the hotel floor-plan PDF:
  - `tables`: `no: [x, y, r]` positions. Tables 9/10/17/27/30/32 are intentionally absent (hidden/unused).
  - `corridors`: four horizontal walking lanes (B/M/C/T), each a fixed `y` with an `x0–x1` extent.
  - `links`: vertical connections between corridor pairs at listed x positions.
  - `weights`: per-corridor cost multipliers for routing — C (the red carpet, 紅毯) is cheapest (0.45) so routes prefer it as the main artery.
  - `approach`: per-table `{c, ax, tail}` — which corridor to leave from, at what x, and the final point(s) to the table. `ax` must fall within that corridor's `x0–x1` range or the node is filtered out.
  - `wall`/`carpet`/`stage`/`equip`/`screens`: static decoration geometry.
- **搜尋** — names are normalized (NFKC, lowercase, punctuation/space stripped) into multiple tokens per guest: full name, parenthetical nickname (e.g. `(Andy)`), name without parens, and text after a colon (e.g. `協理：陳明堂` → `陳明堂`). Prefix matches outrank substring matches. Table number or table name also matches. Typing a complete, uniquely-matching name auto-navigates after 600ms.
- **Dijkstra 路徑 (`buildPath`)** — builds a graph from corridor nodes (at link x's, approach x's, and the entrance), runs Dijkstra with corridor weights, appends the table's `tail`, removes collinear points, and `roundedPathD` converts it to an SVG path with rounded corners.
- **地圖繪製 (`drawBase`)** — renders the whole map programmatically into `<svg id="map">` via the `el()` helper. Only tables present in **both** `TABLES` and `GEO.tables` are drawn — adding or removing a table requires updating `TABLES`, `GEO.tables`, and `GEO.approach` together.
- **動畫 (`animateRoute`)** — a camera-choreographed phase sequence: full map → zoom to entrance → pulse/pause at entrance → dot follows the drawing route → hold at target table → zoom back out. Respects `prefers-reduced-motion` (shows the static end state) unless `force` is passed (the 重播路線 button).
- **縮放/拖曳** — pinch-zoom/drag/double-click implemented by mutating the SVG `viewBox`, clamped by `clampVB`. The `FULL` constant must match the `viewBox` attribute on `<svg id="map">`.
- **UI 流程** — two views (`#viewSearch`, `#viewResult`) toggled via the `.active` class; no router.

## Coordinate System

All map coordinates are PDF points from the hotel's floor-plan PDF (and a 32桌桌圖.jpg / Google Sheet for table-number calibration). When repositioning tables or corridors, stay in that coordinate space; route lengths convert to meters via `CONFIG.mPerPt`.
