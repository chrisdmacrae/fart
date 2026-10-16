# General art style (.gas) — v1.0

A `.gas` file, the General Art Style, is a small JSON document at a
project's root (`style.gas`) that says what the art is like, so that
every asset made after it, by a hand or an agent, belongs with the
others. It is to style what a palette file is to colour: named,
composable, and read by the tools. This document is the contract;
`gas.schema.json` beside it checks structure, `examples/` holds the
conformance cases, and the research that shaped it is at the end.

**The name.** `.gas` sits beside `.fart` and `.shart` and says what it
holds. The extension is one constant in core (`DIRECTION_EXT`) and the
root file's name another (`DIRECTION_FILE`, `style.gas`); the word
"direction" stays in the code and the tool names (`get_direction`,
`fart lint`'s `--direction`) for what the file does.

## The file

```json
{
  "version": 1,
  "name": "harbour",
  "extends": ["../house.gas"],
  "about": "A cold harbour town at dusk: heavy shapes, few colours, one warm light in every scene.",
  "palette_refs": ["palettes/town.fart"],
  "roles": {"outline": "ink", "skin": "pale", "danger": "ember", "ground": "slate"},
  "scale": {"unit": "a tenth of a metre", "sizes": {"character": [12, 20], "prop": [4, 30]}},
  "line": {"outline": 0.6, "where": "every closed shape; never inside a face"},
  "shapes": {"kinds": ["poly", "path", "circle", "line"], "corners": "rounded by 0.5 on buildings, sharp on tools", "budget": {"character": 60, "prop": 30, "*": 120}},
  "light": {"light": [-1, -2, -3], "ambient": 0.4, "bands": 3, "shade": "one band darker away from the light"},
  "motion": {"ease": "in-out", "idle": [0.8, 1.6], "names": ["idle", "walk", "hit", "die"], "max": 2},
  "names": {"parts": "snake_case, left and right as _l and _r", "pattern": "^[a-z][a-z0-9_]*$"},
  "references": [
    {"file": "ships/fighter.fart", "for": "the standard ship: its proportions, its outline, its thrust clip"},
    {"file": "props/crate.fart", "for": "how little a prop needs"}
  ],
  "rules": [
    {"say": "every asset links the town palette", "check": "palette.refs", "args": {"file": "palettes/town.fart"}},
    {"say": "no asset has more than three colours of its own", "check": "palette.max", "args": {"n": 3}},
    {"say": "nothing is pure black", "check": "token.never", "args": {"rgb": [0, 0, 0]}},
    {"say": "every character has idle and hit", "check": "states.has", "args": {"names": ["idle", "hit"]}},
    {"say": "outlines are the line width", "check": "line.width", "args": {"w": 0.6}}
  ],
  "avoid": ["gradients", "pure black", "a second light", "clips longer than two seconds"],
  "classes": {"prop": {"motion": {"max": 1}}}
}
```

- `version` is the style format's major, 1. Unknown fields are
  preserved and ignored, as everywhere in the family.
- **`about`** is the thematic statement, one paragraph: the only prose
  a reader needs every time. Tools put it in front of an agent.
- **`extends`** names directions to lay this one over, paths relative
  to this file: later keys win, lists (`palette_refs`, `references`,
  `rules`, `avoid`) append, objects merge one level down. Loops are an
  error; a file that cannot be read is reported, not fatal.
- **`palette_refs` and `roles`.** The palettes every asset should link
  (a new asset starts with them), and roles: a job's name mapped to the
  token that does it, so "outline" is `ink` here and `char` elsewhere.
- **`scale`** names the unit and the sizes (longest extent, in units,
  as `[min, max]`) a class of asset should have. **`line`** is the
  stroke width of outlines and where they go. **`shapes`** lists the
  kinds an asset may use, a word on corners, and a `budget` of shapes
  per class (`*` for the rest). **`light`** is the light vector,
  ambient and bands a 3D asset and its projections use. **`motion`**
  gives the default ease, the length of an idle, the clip names a class
  should have, and the longest clip. **`names`** says how things are
  named, with an optional `pattern` the linter applies to part names.
- **`references`** point at finished assets with a note on what to copy
  from each: the cheapest context there is, since a reader opens
  exactly the file it needs.
- **`rules`** are sentences, each with an optional `check` naming one
  of the fixed checks below and its `args`. A rule without a check is
  advice. **`avoid`** is the do-not-do list, prose.
- **`classes`** holds overrides by asset class: the direction for a
  class is the file with that class's object laid over it. An asset's
  class is `meta.class`, else its first folder with a trailing s
  dropped (`props/crate.fart` is a `prop`).

## The checks

A linter runs these against an asset; each answers yes or no.

| check | args | fails when |
|---|---|---|
| `palette.refs` | `{file}` | the asset does not link a palette whose path ends in `file` |
| `palette.max` | `{n}` | more than `n` colours of its own |
| `palette.only` | | colours of its own beside its palette refs |
| `token.never` | `{rgb: [r,g,b]}` | a token of its own has that colour |
| `shapes.max` | `{n}` | more than `n` shapes |
| `points.max` | `{n}` | more than `n` points over its shapes |
| `faces.max` | `{n}` | more than `n` faces over its meshes |
| `kinds.only` | `{kinds}` | a shape kind outside the list |
| `smooth.max` | `{n}` | a mesh subdivided more than `n` levels |
| `clip.max` | `{seconds}` | a clip longer than that |
| `states.has` | `{names}` | a named state is missing |
| `names.match` | `{pattern}` | a part, state or clip name off the pattern |
| `line.width` | `{w, tolerance?}` | a stroke more than `tolerance` (0.05) off `w` |
| `size.within` | `{min, max}` | the longest extent outside the range |

The numeric sections lint on their own: `shapes.budget` and
`shapes.kinds`, `motion.max`, `names.pattern`, `palette_refs`, and
`scale.sizes` for the asset's class. Lints are `direction.*` warnings,
advisory: direction is taste, the format is the contract, and a
validator never refuses a file for breaking taste.

## Who reads it

- **Agents.** The skill's workflow reads the project's direction first
  (`get_direction` in Uranus returns it merged with its `extends`
  resolved, a few hundred tokens). New assets take its palette refs;
  the statement goes into Uranus's chat prompt so Ask Claude designs in
  the project's voice.
- **`fart lint <dir>`** finds the direction at the root (or `--direction
  file`) and reports every asset's lints. `fart new <name> [--class c]`
  writes an asset with the direction's defaults.
- **Uranus** shows the direction in the inspector when nothing is open
  (the statement, the roles as swatches, the references as links), seeds
  a new asset from it, and marks an asset that breaks a rule.
- **Generators** (`@fastart/make`) take defaults from it the same way.

## Research notes

Game art bibles fix what must stay constant across assets: statement,
palette with roles, line, silhouette, proportion, perspective, light,
rendering treatment, budgets, a do-not-do list; the best advice is to
keep it to a few pages, to prefer one approved asset to pages of prose,
and to write only rules that a yes-or-no look at an asset can check.
The W3C Design Tokens format (2025.10) is the industry's JSON for design
decisions: named typed values, aliases, groups, layered sets; our palette
files are tokens for colour already, and `extends` with `classes` is its
layering. No animation format carries direction; design systems on the
UI side are the nearest thing, which is why the token format is the
borrow. The research behind the agent tooling is in `TOOLING.md`.
