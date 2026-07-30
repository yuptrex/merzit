# Dice Merge

A polished, touch-friendly dice-merging puzzle game built with vanilla HTML5, CSS3, and JavaScript (Canvas API). No build tools, no dependencies — just open `index.html`.

## How to Play

- Drag the **next die** (shown in the tray) onto any empty cell on the 5×5 board.
- When two or more dice of the **same value** end up touching (orthogonally), they merge into a single die of the next value — this can chain into combos for bonus score.
- Reach the max die (10) for a celebration burst!
- The game ends when the board is full and no more merges are possible.

### Power-ups

| Power  | Effect |
|--------|--------|
| 💣 Bomb   | Tap a die on the board to remove it. |
| ↩ Undo   | Reverts your last placement/merge. |
| 🎯 Cannon | Clears an entire row in one blast. |

## Project Structure

```
DiceMerge/
├── index.html      Entry point / DOM & overlays
├── style.css        All styling, responsive layout
├── board.js          Grid data model (Board class)
├── dice.js            Dice values, image cache, spawn queue
├── merge.js          Merge/combo resolution logic (flood-fill)
├── effects.js        Particle system (sparks, shockwaves, confetti, text)
├── ui.js               Overlay/menu/button wiring
├── game.js           Main engine: render loop, input, state, save/load
├── assets/
│   ├── dice/            Generated die face PNGs (values 1–10)
│   ├── board/           Board frame + cell states
│   ├── ui/               Buttons, icons, logo
│   ├── backgrounds/    Game & menu background art
│   └── particles/       Sparks, glows, confetti, smoke
└── README.md
```

## Technical Notes

- **Rendering**: HTML5 Canvas, redrawn every frame via `requestAnimationFrame`. DPR-aware for crisp rendering on high-density displays.
- **Input**: Unified mouse + touch handling; drag-and-drop to place dice.
- **State**: Board and dice-queue are plain serializable JS objects/classes, decoupled from the animated "visual" sprite layer so merges/placements can animate smoothly without desyncing game logic.
- **Persistence**: Progress and best score are saved to `localStorage` automatically; closing and reopening resumes your game.
- **Assets**: All PNG/JPG art is procedurally generated (no external images or licensed assets).

## Running

Just open `index.html` in a modern browser, or serve the folder with any static file server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Possible Extensions

- Sound effects / music toggle (UI hook already present, currently silent).
- Leaderboard / daily challenge mode.
- Additional power-ups (shuffle, swap, hint).
- Theming (alternate board/dice skins).
