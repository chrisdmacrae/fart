# @fastart/make

The authoring library for `.fart` generators. Anything with symmetry, a
set, or a number you may change is a generator: a `.mjs` in your
project's `assets/gen/` that builds documents with this library and
writes them; change a line, rerun, and the set follows.

```js
import { doc, part, mirrorOf, state, clip, morph, ellipse, path, write } from "@fastart/make";

const d = doc("bat", { palette: [{ name: "fur", rgb: [60, 50, 70, 255] }, { name: "eye", rgb: [255, 220, 80, 255] }] });
part(d, "body", { pivot: [0, 0], shapes: [ellipse("fur", [0, 0], 4, 3)] });
part(d, "wing_l", { parent: "body", pivot: [-3, 0], shapes: [path("fur", [[-3, 0], [-10, -4], [-9, 2]], { closed: true, out: [[-3, -3], [0, 0], [0, 0]], in: [[0, 0], [1, -1], [0, 0]] })] });
mirrorOf(d, "wing_l", "wing_r");
state(d, "glide");
state(d, "flap", { wing_l: { rotate: -0.7 }, wing_r: { rotate: -0.7, mirror: true } });
morph(d, "flap", "body", { shape: 0, scale: [0.9, 1.1] });
clip(d, "fly", "0:glide 0.15:flap 0.3:glide", { loop: true });
write(d, "assets/bat.fart", import.meta.url);
```

`write` validates, bakes, writes the canonical layout, and records the
generator in `meta.gen` so Uranus can offer **Regenerate**.
