# Scenes

Read this for a `.shart`: files placed, posed and recoloured in a tree.

## Scenes: .shart

A `.shart` (Scene Hierarchy of Art, dot-s-h-art) composes farts into a
scene and draws nothing of its own. `spec/SHART.md` is the contract.

```json
{"version": 1, "space": "3d", "name": "camp", "palette_refs": ["palettes/night.fart"],
 "nodes": [
   {"name": "hut", "ref": "cabin.fart", "at": [0, 0, 0], "state": "closed",
    "children": [{"name": "lamp", "ref": "lantern.fart", "attach": {"to": "hook", "by": "grip"}}]},
   {"name": "guard", "ref": "hero.fart", "at": [14, 0, 6], "rotate": [0, 1.2, 0], "clip": "idle", "t": 0.4, "palette": "palettes/red.fart"},
   {"name": "rocks", "at": [-20, 0, 0], "children": [{"name": "a", "ref": "rock.fart"}, {"name": "b", "ref": "rock.fart", "at": [4, 0, 2], "scale": 0.6, "mirror": true}]},
   {"name": "annex", "ref": "yard.shart", "at": [30, 0, 0]}]}
```

- A node is an instance (`ref` a `.fart`), a placed scene (`ref` a
  `.shart`), or a group (no `ref`). `at`, `rotate` (a number in 2D,
  `[x, y, z]` in 3D), `scale`, `mirror` pose it in its parent's frame.
  `state` or `clip` + `t` picks what it shows; `palette` recolours it;
  the scene's `palette_refs` recolour everything. `attach` hangs a child
  from a socket of its parent's art, positions and directions matched
  (`to` on the parent, `by` on the child; `by` absent = the child's
  origin). Names are unique among siblings; refs are relative; every
  ref is of the scene's space.
- Paint order in 2D: list order, children after their parent. 3D is by
  depth.
- Check: `npx fart validate camp.shart` (reads the files it names:
  `ref.state`, `ref.clip`, `ref.anchor`, `space`, `cycle`). See it:
  `npx fart flatten camp.shart` lists every instance placed; Uranus
  opens a scene on its shelf.
- Load: TypeScript `parseScene` → `loadScene(scene, read)` →
  `flattenScene(loaded, {time})` → for each `Placed`: draw its `doc`
  with its `poses` and `tokens`, the instance `xf` in front of the
  part's world map; `sceneCollision(placed)` for the solids. Odin:
  `load_scene` → `flatten_scene(&scene, resolver, user, &cache, &placed,
  time)` → each `Placed` has `doc`/`doc3`, `poses`/`poses3`, `tokens`
  (use `token_color`), `xf`/`xf3`. Keep the `Scene_Cache` for the
  scene's life; `destroy_placed` each frame if you re-flatten.
