# thinq

**3D Studio for Living Worlds**

A world-building studio where users conjure assets from AI prompts, arrange them into worlds, script NPC behaviors and dialogue, then play and share their creations.

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
Place assets in a 200m × 200m world with grid-based terrain. Edit elevation, paint textures, and transform objects with visual gizmos.

### Script
Configure NPC behaviors (idle, wander) and create branching dialogue trees with a visual node editor.

### Play
Explore your world in third-person. Walk, run, jump, and interact with NPCs to experience the dialogue you've authored.

### Share
Save worlds locally with auto-save. Export/import as JSON. (Cloud sharing coming in V2)

## Controls

### Editor
- **Terrain Tool:** Click to raise, right-click to lower
- **Place Tool:** Drag assets from library to viewport
- **Select Tool:** Click to select, use gizmo to transform
- **Delete Tool:** Click assets to remove
- **Undo/Redo:** Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z

### Play Mode
- **WASD:** Move
- **Shift:** Run
- **Space:** Jump
- **Right-click drag:** Orbit camera
- **Click NPC:** Talk
- **ESC:** Return to editor

## Tech Stack

- **UI:** Preact + Vite
- **3D:** Three.js
- **AI:** Gemini 3 Flash
- **Dialogue Editor:** React Flow
- **Storage:** IndexedDB

## Documentation

See [CLAUDE.md](./CLAUDE.md) for detailed architecture and development notes.

## License

MIT
