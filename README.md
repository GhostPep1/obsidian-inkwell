# Inkwell — Obsidian Handwritten Notes Plugin

Native Apple Pencil handwriting inside Obsidian with ruled paper backgrounds.

## Status: Phase 1 — Scaffold

This is the initial buildable scaffold. The critical first test is whether PointerEvent palm rejection works correctly in Obsidian's iOS webview.

## Quick Start

```bash
# Install dependencies
npm install

# Dev build (watches for changes, rebuilds on save)
npm run dev

# Production build
npm run build
```

## Development Setup

1. Clone/copy this folder
2. `npm install`
3. `npm run dev` (starts esbuild in watch mode)
4. Symlink or copy to your vault's plugin directory:

```bash
# Option A: Symlink (Mac/Linux)
ln -s /path/to/obsidian-inkwell /path/to/vault/.obsidian/plugins/obsidian-inkwell

# Option B: Copy built files
mkdir -p /path/to/vault/.obsidian/plugins/obsidian-inkwell
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/obsidian-inkwell/
```

5. In Obsidian: Settings → Community Plugins → Enable "Inkwell"
6. Use command palette: "Inkwell: New handwritten note"

## Testing on iPad

The critical Phase 1 test:

1. Build the plugin on desktop
2. Sync to your iPad vault (iCloud / Obsidian Sync)
3. Open a `.inkwell` file
4. Test with Apple Pencil — does it draw?
5. Test with finger — does it scroll instead of draw?

If YES to both → palm rejection works → proceed to Phase 2.
If NO → we need to investigate Obsidian's webview PointerEvent support.

## Architecture

```
Three-canvas stack:
┌─────────────────────────┐
│   Active Canvas (z:3)   │ ← Current stroke being drawn (60fps)
│   Stroke Canvas (z:2)   │ ← All completed strokes
│   Background Canvas (z:1)│ ← Paper lines (ruled/grid/dot)
└─────────────────────────┘
```

- **File format:** `.inkwell` (JSON) — diffable, syncable
- **Palm rejection:** `PointerEvent.pointerType === "pen"` → draw, `"touch"` → scroll
- **Stroke rendering:** `perfect-freehand` library for pressure-sensitive paths
- **Dependencies:** 1 (`perfect-freehand`, 4KB)

## Project Structure

```
src/
├── main.ts                # Plugin entry point
├── InkwellView.ts         # Obsidian TextFileView
├── canvas/
│   ├── InkCanvas.ts       # Main canvas controller
│   ├── PaperRenderer.ts   # Paper backgrounds
│   ├── StrokeRenderer.ts  # Pressure-sensitive strokes
│   └── InputHandler.ts    # Pointer events + palm rejection
├── model/
│   └── types.ts           # File format + data types
└── ui/
    └── Toolbar.ts         # Tool/color/width selection
```

## Paper Types

- **Ruled** — horizontal lines + red margin (notebook paper)
- **Grid** — square grid (graph paper)
- **Dot** — dot grid (bullet journal style)
- **Blank** — custom background color only

## License

MIT
