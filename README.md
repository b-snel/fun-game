# TETHER

Split-screen co-op anti-grav combat racer built with Three.js. Two pilots fly a collapsing trench at 300+ km/h, joined by a high-voltage tether that slices through anything caught between them.

## Play

```bash
npm install
npm run dev
```

Open the printed URL. Plug in one or two Xbox controllers (or any standard gamepad) and press **A** to join. If you have only one controller, the other player can use the keyboard.

Playing alone? Join, then press **Start** (or **P**). An AI wingman flies the other ship.

## Controls

| Action | Xbox | Keyboard P1 | Keyboard P2 |
| --- | --- | --- | --- |
| Fly | Left stick / D-pad | WASD | Arrow keys |
| Fire (auto-aim) | RT (or X) | F | / |
| Boost | A (or LB) | Left Shift | . |
| Barrel roll (dodge, brief invulnerability) | B (or RB) | R | , |
| Air-brake | LT | Q | M |
| Pause | Start | Esc | Backspace |
| Swap split (horizontal/vertical) | View | Tab | Tab |
| Invert vertical (title screen) | Y | I | I |

Controllers rumble on hits, kills, tether snaps and sync bursts.

## How it works

- **The tether** connects both ships. Any enemy that crosses it is severed: worth double points, and it refills both boost meters. The tether also blocks enemy fire, so you can shield each other. Get more than about 80 m apart and it snaps; fly back within about 40 m to relink.
- **Sync Burst**: both players hit boost within 0.35 s of each other, with at least 30% boost each. You get a huge speed surge, a shockwave and three seconds of invulnerability. With an AI wingman, double-tap boost instead.
- **Revive**: if a ship's hull hits zero it goes down. Its partner flies close for 1.5 s to bring it back. If both go down, you restart from the last sector checkpoint.
- **The Collapse**: the trench is being destroyed behind you. Slow down too much and it catches you.

### Sectors

1. **Launch Bay**: countdown in the hangar.
2. **The Trench**: open canyon in the rain. Drone sweeps teach you to cut with the tether.
3. **Undercity**: a covered megastructure with pillars, beams you must fly over or under, laser gates (barrel-roll through) and wall turrets.
4. **Collapse**: the canyon comes down around you. Falling rock, mines and heavy waves.
5. **The Warden**: a heavy gunship boss. Its four cores are shielded against guns. Wait for its low pass, bracket a core between your two ships and cut it with the tether.
6. **Extraction**: punch it into the daylight.

## Tech

- Three.js (WebGL), built with Vite. No external assets: all geometry, textures and audio are generated at runtime.
- Each split-screen view has its own post-processing chain: bloom, radial speed blur, chromatic aberration, damage vignette and film grain.
- The course is a 34 km procedural spline. All gameplay runs in track space (distance along the track, lateral offset, height), so steering and collision stay simple and robust at speed.
- Procedural Web Audio: engines, weapons, explosions, tether hum and a 140 BPM synth score whose intensity follows the action.

## Deploy (Vercel)

`vercel.json` is included. Import the repo in Vercel (framework preset: Vite, build command `npm run build`, output directory `dist`). Then add the custom domain under Project → Settings → Domains.
