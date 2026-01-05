# Splat Time Toggle Template

**PlayCanvas viewer for switching between aligned 3DGS temporal captures.**

Toggle between two 3D Gaussian Splat scans of the same location captured at different times. Perfect for seasonal comparisons, construction progress, before/after documentation, and environmental change visualization.

<!-- TODO: Add screenshot/GIF showing time toggle in action -->

## Features

- **Time toggle UI** — Button to switch between temporal states
- **ICP alignment support** — Apply transforms from [SplatAlign](https://github.com/terminusfilms/splatalign)
- **WASD + mouse look** — First-person navigation
- **Mobile support** — Touch joystick and gestures
- **LOD streaming** — Efficient loading of large splats
- **Optional collision** — GLB-based collision boundaries
- **Keyboard shortcuts** — `[` and `]` to cycle times, `H` to hide UI

## Prerequisites

You need:
1. **Two 3DGS captures** of the same location at different times
2. **LOD-converted splats** (using [@playcanvas/splat-transform](https://www.npmjs.com/package/@playcanvas/splat-transform))
3. **Alignment transform** from [SplatAlign](https://github.com/terminusfilms/splatalign) (if captures aren't pre-aligned)

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/terminusfilms/splat-time-toggle-template.git
cd splat-time-toggle-template
npm install
```

### 2. Add Your Splat Data

Create folders for your two temporal captures:

```
splat-time-toggle-template/
├── splats/
│   ├── primary/
│   │   └── lod-meta.json (+ chunk files)
│   └── secondary/
│       └── lod-meta.json (+ chunk files)
```

### 3. Generate Alignment Transform

Use [SplatAlign](https://github.com/terminusfilms/splatalign) to align your secondary capture to the primary:

```bash
# GUI
python splat_align.py

# CLI
python splat_align.py --cli primary.ply secondary.ply
```

Copy the `matrix_column_major_flat` from the output JSON.

### 4. Configure

Edit `config.js`:

```javascript
timeToggle: {
    times: [
        { id: 'primary', label: 'October 2025', path: './splats/primary/' },
        { id: 'secondary', label: 'December 2025', path: './splats/secondary/' }
    ],
    transforms: {
        primary: null,  // Reference, no transform
        secondary: [
            // Paste your SplatAlign matrix_column_major_flat here:
            0.9316, 0.3623, -0.0274, 0.0,
            -0.3627, 0.9317, -0.0157, 0.0,
            0.0198, 0.0246, 0.9994, 0.0,
            -2.101, -2.570, -0.102, 1.0
        ]
    }
}
```

Also update:
- `startPosition` — Where camera starts
- `startRotation` — Initial view direction
- `collisionMesh` — Path to decimated GLB (or `null` to disable)

### 5. Run

```bash
npm run dev
```

Open http://localhost:5173

## Controls

### Desktop

| Key | Action |
|-----|--------|
| W/A/S/D | Move |
| Q/E | Up/Down |
| Mouse | Look around |
| Shift | Sprint |
| [ / ] | Toggle time |
| H | Hide UI |
| R | Reset position |
| O | Fly mode (no collision) |

### Mobile

- **Single finger** — Look around
- **Joystick** — Move
- **Up/Down buttons** — Vertical movement
- **Time button** — Toggle between captures

## Preparing Your Splats

### 1. Capture

Use PortalCam, Luma, Polycam, or similar to capture your scenes.

### 2. Export to PLY

Export as standard 3DGS PLY format.

### 3. Align with SplatAlign

```bash
python splat_align.py --cli capture_october.ply capture_december.ply --bake
```

This outputs:
- `alignment_*.json` — Transform matrix
- `capture_december_aligned.ply` — PLY with transform baked in (optional)

### 4. Convert to LOD Chunks

```bash
# Install splat-transform
npm install -g @playcanvas/splat-transform

# Convert each capture
splat-transform -O 0,1,2,3,4,5 -C 256 -X 8 capture_october.ply splats/primary/lod-meta.json
splat-transform -O 0,1,2,3,4,5 -C 256 -X 8 capture_december.ply splats/secondary/lod-meta.json
```

### 5. Configure and Run

Update `config.js` with paths and transforms, then `npm run dev`.

## Build for Production

```bash
npm run build
```

Output in `dist/`. Deploy to any static host (Cloudflare Pages, Vercel, Netlify, etc.).

## How Transform Application Works

The `time-toggle-system.js` applies alignment transforms like this:

1. **Z-up to Y-up rotation** — 3DGS captures are typically Z-up; PlayCanvas is Y-up
2. **ICP alignment matrix** — From SplatAlign, aligns secondary to primary coordinate space
3. **Combined transform** — Applied to the secondary splat entity

```javascript
// From time-toggle-system.js
const zToYMat = new pc.Mat4();
zToYMat.setFromEulerAngles(-90, 0, 0);

const alignmentMat = new pc.Mat4();
alignmentMat.set(transformData);  // Column-major from SplatAlign

const combinedMat = new pc.Mat4();
combinedMat.copy(zToYMat);
combinedMat.mul(alignmentMat);  // rotation * alignment

entity.setLocalPosition(pos);
entity.setLocalRotation(rot);
```

## Related Projects

- [SplatAlign](https://github.com/terminusfilms/splatalign) — ICP alignment tool that generates the transform matrices
- [PlayCanvas Engine](https://github.com/playcanvas/engine) — WebGL engine with GSplat support
- [@playcanvas/splat-transform](https://www.npmjs.com/package/@playcanvas/splat-transform) — LOD conversion CLI

## Credits

Template by [Steve Bransford](https://github.com/terminusfilms) at [Emory Center for Digital Scholarship](https://ecds.emory.edu).

Based on the [Atlanta Space Machine](https://atlantaspacemachine.com) temporal viewer implementation.

## License

MIT License — see [LICENSE](LICENSE)
