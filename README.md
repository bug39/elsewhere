# elsewhere

**3D Studio for Living Worlds** — Built for the Gemini API Hackathon

A world-building studio where users conjure assets from AI prompts, arrange them into worlds, script NPC behaviors and dialogue, then explore their creations.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

## Requirements

- Node.js 18+
- Modern browser with WebGL support
- Gemini API key (free at [Google AI Studio](https://aistudio.google.com/apikey))

## Features

### Generate
Create 3D assets from natural language prompts. AI generates complete Three.js code with materials, animations, and proper pivot groups for procedural animation.

### Arrange
Place assets in a 200m x 200m world with grid-based terrain. Edit elevation, paint textures, and transform objects with visual gizmos.

### Script
Configure NPC behaviors (idle, wander) and create branching dialogue trees with a visual node editor.

### Director Mode
Describe a scene in natural language and get an AI-directed animated sequence with camera work, transitions, and effects.

### Theme Packs
Generate cohesive sets of assets around a theme (e.g. "haunted graveyard") with a single prompt.

## Controls

### Editor
- **Terrain Tool:** Click to raise, right-click to lower
- **Place Tool:** Drag assets from library to viewport
- **Select Tool:** Click to select, use gizmo to transform
- **Delete Tool:** Click assets to remove
- **Undo/Redo:** Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z

## Tech Stack

- **UI:** Preact + Vite
- **3D:** Three.js
- **AI:** Gemini 3 Flash / Pro
- **Dialogue Editor:** React Flow
- **Storage:** IndexedDB

## License

MIT
