# OVERTIME

*you never clocked out.*

A browser horror game built with three.js. First-person exploration of a liminal
office floor at 3:33 AM — flickering fluorescents, a hallway that loops, a phone
that rings for you, and something tall from the lower floors that only freezes
while your flashlight is on it.

## Run it

ES modules need an HTTP server (three.js loads from CDN, everything else is local):

```sh
cd overtime
python3 -m http.server 8000
# then open http://localhost:8000
```

or `npx serve .` — any static server works.

## How to play

| Key | Action |
| --- | --- |
| WASD | move |
| Mouse | look |
| Shift | sprint (stamina) |
| F / right-click | flashlight (battery — pick up cells to recharge) |
| E | interact |

Find **3 fuses**, insert them at the breaker by the elevator, then survive until
the elevator arrives. The flashlight pins the thing in place — hold the beam on
it long enough and it flees, but the beam burns battery fast while it does.

## Tech

- three.js (CDN import map), no build step, no downloaded assets
- All textures generated at runtime on `<canvas>`
- All audio synthesized with WebAudio (hum, whispers, heartbeat, the phone…)
- Hand-authored tile map (`src/map.js`) with BFS pathfinding for the entity
- One real shadow-casting light (the flashlight); ceiling fixtures are an
  instanced emissive mesh lit by a pool of 6 roaming point lights
- Film grain / vignette / chromatic-aberration post pass that tightens with fear
