# Kaiju Destroyer 3D

An offline third-person city destruction game. Move the kaiju, breathe fire, stomp, and destroy buildings to recover health while fighting tanks, helicopters, Bloom Hero, and rooftop Bosses. Workers are friendly allies who cheer you on.

## Run

Open `kaiju-destroyer.html` in a browser, keeping the model scripts and `vendor/` alongside it. All game resources are local; no dependency installation is needed.

For a local preview server:

```sh
node serve.cjs
```

Open <http://127.0.0.1:4399/kaiju-destroyer.html>. Use `PORT=4400 node serve.cjs` to select another port. The server binds only to `127.0.0.1`.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Move relative to the camera |
| Shift | Sprint |
| Mouse movement | Aim; fire breath is automatic |
| Space | Stomp shockwave; 2-second cooldown |
| P / Esc | Pause or resume |
| M | Mute or unmute |
| H | Open How to Play; Esc closes it |
| Drag on the left side of a touch screen | Move with the joystick; push fully to sprint |
| Drag / tap on the right side of a touch screen | Aim / stomp |
| Buttons on narrow screens or touch devices | Pause, sound, and stomp |

Losing window focus or moving the page to the background pauses the game automatically. Press P or Esc, or select Resume, to continue.

How to Play is available from the start screen, game HUD, and Kaiju Down results screen. It explains objectives, controls, healing, combos, allies, and enemies. Opening it pauses simulation and audio; closing it restores the previous state unless the game lost focus or moved to the background. Bloom Hero practice includes an Auto fire toggle.

## Gameplay

- Destroy buildings to recover health and earn points. Combos reach a maximum multiplier of 10. Survival adds 10 points per second without creating a combo.
- Fire reaches up to 24 cells and deals 2 damage every 3 simulation frames. The first eligible enemy or intact building blocks targets behind it. Fire stays near street level at close range and rises farther away.
- Stomps reach 4 cells and deal 8 damage to ground enemies and 5 to buildings. Allies, airborne helicopters, and rooftop Bosses are immune.
- Workers within 8 unobstructed cells extend the combo window by 0.5 seconds each, up to 4 Workers. Player attacks cannot hurt them, but enemy stray projectiles can.
- After wave 10, enemy health, damage, and score increase by 12% per wave. Each spawn batch has a size cap.
- The city has eight building styles on a 72 × 72-cell map. Each building cell can take damage and collapse independently.
- Sound effects are synthesized locally. High scores are saved in the browser, with an in-memory fallback if storage is unavailable.

| Enemy | Behavior and weaknesses |
| --- | --- |
| Tank | Pursues on the ground and fires shells. Drops a small health pack when defeated. |
| Helicopter | Flies and fires at a height of about 5 cells. Can cross buildings below its flight height. |
| Bloom Hero | Charges within 8 unobstructed cells, locks its attack direction, and fires backward. Dodge sideways, then attack its open back weak point during recovery for five times normal fire damage. Stomps interrupt charging or attacking and open the weak point. Gas slows movement by 40% for 1.5 seconds. |
| Boss | Spawns on roofs and fires word projectiles that briefly reduce fire damage by 40%. Tall buildings can block the projectiles. Destroy its roof to bring it into stomp range. Drops 5 health packs. |

Bloom Hero first appears from wave 3 and joins regular spawn batches from wave 6, with at most 2 alive. Its charge lasts 0.7 seconds, attack 0.3 seconds, and recovery 1.2 seconds. A kill awards 1,000 base points and a health pack restoring 15 HP. Open `kaiju-destroyer.html?heroPractice=1` to practice dodging, interruption, and weak-point attacks.

## Previews

- `city-preview.html`: Eight buildings, district layouts, lighting, and cell destruction.
- `boss-preview.html`: Boss model rotation, zoom, views, and animation modes.
- `hero-preview.html`: Bloom Hero views, attack phases, weak point, and practice entry.
- `tests/character-check.html`: Character views and animations using the game models.
- `tests/scene-check.html`: A fixed-seed scene for inspecting buildings, units, and the HUD.
- `tests/hero-responsive-check.html`: Bloom Hero preview, practice, and start screens at narrow widths.
- `tests/city-responsive-check.html`: Building preview and game at narrow widths.

## Code structure

```text
kaiju-destroyer.html       Game, scene, HUD, and input
boss-model.js             Boss geometry, materials, and animation
city-visual.js            Buildings, facade textures, and streets
unit-visual.js            Workers, tanks, helicopters, and Bloom Hero
kaiju-visual.js           Kaiju geometry and animation
boss-preview.html         Boss preview
city-preview.html         Building and district preview
hero-preview.html         Bloom Hero preview and practice entry
serve.cjs                 Optional local preview server
vendor/three.min.js        Local Three.js r160
tests/                    Regression tests and browser checks
```

Keep all four model modules and `vendor/` when copying the game. Geometry, facades, and text textures are generated locally.

## Checks

Run the dependency-free regression tests with Node.js:

```sh
node tests/gameplay.test.cjs
node tests/boss-visual.test.cjs
node tests/city-visual.test.cjs
node tests/city-layout.test.cjs
node tests/unit-visual.test.cjs
node tests/kaiju-visual.test.cjs
node tests/english-only.test.cjs
```

For optional browser checks, install Playwright separately, including its Chromium browser, or provide an installed browser with `CHROME_BIN`. Start `node serve.cjs` in another terminal, then run:

```sh
node tests/browser-check.cjs
```

If Playwright is installed outside this project, point `NODE_PATH` at that installation's `node_modules` directory:

```sh
NODE_PATH=/absolute/path/to/node_modules node tests/browser-check.cjs
```

`PREVIEW_URL` overrides the default server URL (`http://127.0.0.1:4399`). `CHROME_BIN` selects a browser executable. Screenshots and results are written to a new directory under the system temporary directory by default; set `TEST_OUTPUT_DIR` to choose another output directory. Generated check outputs are not part of the source tree.

## Implementation limits

- Buildings use individual cell meshes with shared geometry and texture caches. Complex scenes and physical-phone performance require device measurement.
- Enemies use local obstacle avoidance and may take detours around complicated corners.
- Player collision uses a torso circle with radius 1.1; the tail is excluded.
- The game uses classic scripts and the bundled Three.js r160, which emits a console deprecation warning.
