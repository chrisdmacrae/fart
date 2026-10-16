# How agents work the format: findings and a plan

Research notes (October 2026) on making an agent's work with `.fart`
files cheaper and better: fewer tokens, fewer turns, less rewriting. The
measurements are of this repository's own files with Anthropic's
tokenizer; the field notes are what others have found. **Built** (October
2026): items 1–8 of the plan below, as `fart fmt`, `fart outline`,
`fart tokens`, the `get_document` details, `apply_patch`, the verbs
`pose`, `morph`, `clip`, `make`, `render` sheets, `@fastart/make`,
Regenerate in Uranus, the split skill, and `fart lint`/`fart new` with
the direction file (`DIRECTION.md`). The evaluation set (item 8) is
`evals/` and runs through Claude Code by hand.

## What the tokens are spent on

The 39 example files, as written to disk today, cost **327k tokens** to
read in full. The same files, laid out with number arrays inline
(`"pivot": [-1.7, 9]` instead of one number per line), cost **257k**: the
one-number-per-line layout `stringifyDoc` writes spends a fifth of every
file on indentation and brackets. Point-heavy files lose the most: the
flag is 33k on disk and 21k inline; the head 25k and 17k.

| what | tokens | saving |
|---|---|---|
| the examples as on disk | 327k | |
| inline number arrays | 257k | 21% |
| inline, without `tris` and `bake` | 231k | 29% |
| minified | 189k | 42% (and unreadable) |

Bakes (`tris`, path and smooth `bake`) are a further 8%: output a
reader recomputes anyway, and that an agent never needs to see.

The bigger cost is not reading but **writing back**. The in-app tool
`apply_document` takes the whole document, so a change to one pivot in
a 20k-token file is a 20k-token reply, at output prices and output
speed. Every edit a user asks Claude for inside Uranus pays this.

The generator route is the cheap one. `examples/space/generate.mjs` is
**9.1k tokens** and writes sixteen files worth **19.8k**; more to the
point, a change to the fleet is a one-line edit to the generator and a
rerun, where the JSON route is sixteen rewrites. Users who run their own
generators found this on their own. The skill tells agents to script
sets, but the repository gives them no library beyond the solid helpers
and no way to keep a generator with the project it feeds.

The skill itself is **8.3k tokens**, read at the start of every session
that touches the format, and `FORMAT.md` is 11.4k.

## What the field has found

- **Changing notation is not the win.** TOON and TRON compress JSON by
  18–27% in agentic benchmarks but cost 9–14 points of accuracy, and
  TOON "cascades on multi-turn parsing failures" ([Notation Matters,
  2026](https://arxiv.org/abs/2605.29676)). The format stays JSON. The
  21% from layout costs nothing in accuracy.
- **Patches beat rewrites.** JSON Whisperer ([2025](https://arxiv.org/abs/2510.04717))
  has the model emit RFC 6902 patches instead of whole documents: **31%
  fewer tokens at edit quality within 5%** of regeneration, with the
  gains largest on complex and list-heavy edits. Its one trick matters
  to us: arrays addressed by index trip models up, so it rewrites arrays
  as dictionaries with stable keys. Our parts, states, clips, tokens
  and textures already have names; shapes within a part do not.
- **Few tools, around workflows, with response formats.** Anthropic's
  tool guidance ([2025](https://www.anthropic.com/engineering/writing-tools-for-agents)):
  a handful of high-leverage tools that each do a whole job, consistent
  name prefixes, a `response_format` of concise or detailed, pagination
  and truncation with a note when it happens, and an evaluation loop of
  realistic multi-call tasks used to improve the tools.
- **Commands, not state; a screenshot as eyes.** The Blender MCP
  servers that work expose commands over a live scene and a screenshot
  tool, and never ask the model to hold the whole scene. Uranus already
  has `render`; its editing tool is still "send the whole scene".

## The plan, ranked by payoff over effort

1. **Inline number arrays in `stringifyDoc`.** Every point, pivot,
   colour and face on one line, three decimals, objects one key per
   line as now. 21% off every read, by every reader, with files that
   are easier for people to scan too. A pure formatting change; the
   corpus and examples get rewritten once.
2. **Lean views from the app.** `get_document` grows a `detail`
   argument: `outline` (the parts tree with shape counts and kinds, the
   states, the clips with key counts, the palette: a few hundred tokens
   for any file), `lean` (the default: the document without `tris` and
   `bake`), `full`, and `part: name` to fetch one part. The skill tells
   agents to start from the outline.
3. **`apply_patch`.** RFC 6902 operations addressed by **name**:
   `/parts/hull/pivot`, `/states/open/parts/lid/rotate`,
   `/clips/walk/keys/2/t`, with shapes by index under their part
   (`/parts/hull/shapes/2/points/4`). One undo step, validated, the
   reply a one-line diff and any issues. `apply_document` stays for new
   files. Bakes are stripped on the way in and rebaked on save, so no
   patch ever touches one.
4. **Verb tools over the patch.** Three or four tools that do a job:
   `uranus_pose` (a part in a state: offset, turn, scale, mirror, or a
   morph from a list of corner moves), `uranus_make` (a shape from a
   recipe: ellipse, rounded rect, lathe, extrude, box, with the
   format's words as arguments, into a part), `uranus_clip` (keys from
   a list of state names and times), and the existing `render`,
   `validate`, `open_file`. Fewer than ten tools in all, one prefix.
5. **Generators as a first-class path.** A small authoring library,
   `@fastart/make`, with the helpers the generators keep reinventing
   (`doc`, `part`, `mirrorOf`, `ellipse`, `roundedRect`, `state`,
   `clip`, `morph`, `write` with validation), a `fart new --recipe`
   for the common starts, and the convention that a project keeps its
   generators in `assets/gen/*.mjs`. Uranus shows "from gen/ships.mjs"
   on a generated asset and offers **Regenerate**, which runs it and
   reloads through the watcher. The skill's first instruction becomes:
   anything with symmetry, a set, or a parameter you might change is a
   generator.
6. **The skill on a diet.** A 2k-token core (words, the rules that
   bite, the workflow) with the 3D, textures, scenes, loaders and
   curves sections as files the skill names and the agent reads when
   the task needs them, the way skills are meant to disclose.
7. **A contact sheet from `render`.** One PNG with every state, or a
   clip's frames in a row, so one call shows a whole file.
8. **Measure.** `fart tokens <file>` for the numbers, and an evaluation
   set of ten real tasks ("give the dog a blink clip", "widen the
   fighter's wings in the thrust state") run through Claude Code before
   and after each of the above, counting tokens and turns, Anthropic's
   loop.

Items 1–3 are a day and remove most of the waste; 4 and 5 are the
ones that change how the work feels; 6–8 keep it honest.
