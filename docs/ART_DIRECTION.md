# ROOTWORKS art direction

**Premium handcrafted isometric pixel art, Cozy Industrial Fantasy.** Warm timber, cream plaster, terracotta and
copper living inside a green, overgrown valley. Machines are friendly and well-kept, never grimy or neon.

All art is painted procedurally in code (`src/game/render/sprites/*`), pixel by pixel, from one palette
(`src/game/render/palette.ts`). These rules keep every asset in the same game.

## Grid and pixels
- 2:1 isometric. A tile is 64 x 32 px; one elevation step is 10 px (`core/iso.ts`).
- One art pixel = one texture pixel; textures use nearest filtering and are never scaled by fractions
  inside a sprite. Camera zoom levels are whole numbers (1-4) so pixels stay square and crisp.
- Sprites anchor at their ground point (the centre of their footprint's ground), not their image corner.

## Proportions
- A robot is about 1 tile wide and 1.6 tiles tall (head included) and must read at zoom 1.
- Doors are ~24 px tall: everything a robot uses is scaled to it (workbench top at 15 px, windows ~16 px).
- Buildings fill their footprint: a 2x2 machine stands on its whole 2x2 (a yard, floor or apron fills what the
  structure itself does not), so nothing looks like it floats on empty tiles.

## Light, shadow, outline
- Light comes from the upper left. Ramps run dark to light; faces use a fixed bias: top 3.3, left 2.4, right 1.2.
- Shadows lean warm-purple (`SHADOW`), never black; ground shadows are dithered and fall to the lower right.
- Outlines are selective: edges that touch transparency are darkened (`edgeDarken`), never a 1 px black line.
- Glow is rare and warm (windows, lanterns, the kiln mouth); teal glow only for research.

## Materials
- Wood: `P.wood` boards with visible seams every 4-8 px; bark is `P.bark`.
- Masonry: bricks 7 x 3 px with cream mortar; stone is `P.stone`/`P.concrete`.
- Metal: `P.steel` (warm grey, never blue) and `P.copper`, which weathers to `P.verdigris` in thin streaks only.
- Moss and ivy grow in tidy clumps that follow the structure (whole roof tiles, wall columns): never screen-space noise.

## Construction rules (what broke before)
- Paint back to front. Anything taller that stands *under* a roof is painted before the roof; anything in front of
  a roof (benches, saw tables) stands outside the roof's footprint. Nothing may poke through a roof.
- Roof add-ons (domes, chimneys) sit on a visible base (drum, collar) that meets the roof.
- Every machine shows its job at a glance: inputs stacked beside it, the working part in the open.

## Characters
- Seedling: a round cream body on two treads, a wicker basket on its back (cargo shows in it), one big eye under a
  copper brow plate, and a sprout in a copper socket that grows with every programming skill.
- Every pose keeps the same silhouette and proportions; animation moves parts (arms, brow, eye, sprout), not the
  whole sprite. Timing: idle 3 fps, walk 9, work 7, celebrate 8, error 6.

## Animation
- Animate only what has a purpose: walking, working parts of busy machines, water, smoke, wind in leaves.
- Machines move only while working; idle machines are still.
- No blinking pixels as "life"; use slow cycles (wind waves, breathing) instead.

## UI ("workshop ledger")
The world is pixel art; the interface is a calm, modern game UI laid over it. All tokens live at the top of
`src/ui/styles.css`; every screen uses them, and older class names are aliases on the shared rules.
- Surfaces: dark walnut (`--surface`, `--raised`, `--inset`), 1px warm borders, one shadow level. No coloured stripes:
  hierarchy comes from headings, spacing and dividers. Not everything is a card.
- Colour roles: honey `--accent` = focus and the one primary action; sage `--go` = run / done / learned;
  copper = industry and warnings; `--danger` = destructive; `--info` = system messages and paused state.
- Type: Segoe UI Variable (UI), Cascadia Mono (code, numbers). Scale 11 / 12 / 13 / 15 / 18 / 24 px; nothing smaller.
- Space: 4 px grid (4, 8, 12, 16, 24, 32). Controls are 30 px (small 26 px); radius 3 px controls, 6 px panels.
- Buttons: primary (honey), go (sage, Run), secondary, ghost/icon, danger. Every one has hover, pressed, focus-visible
  (2 px honey ring) and disabled states. Transitions are 120 ms; panels fade in over 160 ms; Reduce Motion stops all.
- Layout: top bar (identity + navigation left, storage right) at one height; left column = commissions and the robot;
  inspector and build menu always stay inside the free map area, also with the editor open and at 1280 x 720.
- Icons: item art from `sprites/items.ts`, the Spark as an SVG; no emoji.
