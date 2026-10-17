// The inspector's Sculpt section, while sculpt mode is on: the brushes by
// kind, the brush's radius, strength, falloff and auto-smooth, how a
// stroke lays its dabs, symmetry, auto-masking, the mask, the mesh
// filters and Subdivide. The settings are this device's (state/sculpting.ts).

import { md, selShape } from "../state/model.ts";
import { run } from "../state/commands.ts";
import { BRUSHES, FALLOFFS, FILTERS, brushInfo, type BrushInfo, type Falloff, type Filter } from "../state/sculpt.ts";
import { sculpt, setSculpt, setBrush, setBrushField, strengthOf, falloffOf, autoSmoothOf, maskAct, maskOf, maskRev, type StrokeMethod } from "../state/sculpting.ts";
import { Button, Checkbox, InspectorSection, NumberField, Property, SegmentedControl, Select } from "./ur.tsx";

const GROUPS: BrushInfo["group"][] = ["Add / subtract", "Smooth / flatten", "Move", "Mask"];
const KEYS: Partial<Record<string, string>> = { draw: "X", clayStrips: "C", crease: "⇧C", layer: "L", inflate: "I", smooth: "S", flatten: "⇧T", pinch: "P", grab: "G", snakeHook: "K", mask: "M" };
const AXES = ["X", "Y", "Z"] as const;

export function SculptSection() {
	void maskRev.value;
	const set = sculpt.value;
	const b = brushInfo(set.brush);
	const sel = md.sel.value;
	const sh = selShape();
	const masked = sel ? maskOf(sel) : null;
	const held = masked ? masked.reduce((n, v) => n + (v > 0.5 ? 1 : 0), 0) : 0;
	const pts = sh && sh.kind === "mesh" ? sh.points.length : 0;
	return (
		<InspectorSection title="Sculpt" hint="shape the mesh like clay: drag over it with a brush. ⌘ turns the brush the other way, ⇧ smooths, F sizes it, ⇧F sets its strength; orbit with two fingers, the middle button or ⌥-drag" tail={b.label}>
			{GROUPS.map((g) => (
				<Property key={g} label={g === "Add / subtract" ? "Add" : g === "Smooth / flatten" ? "Smooth" : g} title={g}>
					<div class="insp-actions">
						{BRUSHES.filter((x) => x.group === g).map((x) => (
							<Button key={x.kind} active={x.kind === set.brush} title={`${x.label}${KEYS[x.kind] ? ` (${KEYS[x.kind]})` : ""}: ${x.hint}`} onClick={() => setBrush(x.kind)}>
								{x.label}
							</Button>
						))}
					</div>
				</Property>
			))}
			<div class="insp-hint flush">{`${b.label}: ${b.hint}`}</div>
			<Property label="Radius" title="the brush's size on the screen, in pixels: F, or [ and ]">
				<NumberField value={set.radius} min={2} max={1000} step={5} suffix="px" label="Radius" onChange={(v) => setSculpt({ radius: Math.max(2, Math.round(v)) })} />
			</Property>
			<Property label="Strength" title="how hard the brush works, 0 to 1 (⇧F); a pen's pressure scales it">
				<NumberField value={strengthOf()} min={0} max={1} step={0.05} label="Strength" onChange={(v) => setBrushField("strength", Math.max(0, Math.min(1, v)))} />
			</Property>
			<Property label="Falloff" title="how the brush's force fades from its middle to its rim">
				<Select value={falloffOf()} options={FALLOFFS.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))} onChange={(v) => setBrushField("falloff", v as Falloff)} />
			</Property>
			{b.group !== "Mask" && set.brush !== "smooth" && (
				<Property label="Auto-smooth" title="a smoothing pass after every dab, 0 to 1">
					<NumberField value={autoSmoothOf()} min={0} max={1} step={0.05} label="Auto-smooth" onChange={(v) => setBrushField("autoSmooth", Math.max(0, Math.min(1, v)))} />
				</Property>
			)}
			{!b.drag && (
				<>
					<Property label="Stroke" title="Space lays a dab every Spacing of the radius along the stroke; Dots lays one wherever the pointer is each time it moves">
						<SegmentedControl
							label="Stroke"
							options={[
								{ value: "space", label: "Space" },
								{ value: "dots", label: "Dots" },
							]}
							value={set.method}
							onChange={(v) => setSculpt({ method: v as StrokeMethod })}
						/>
					</Property>
					{set.method === "space" && (
						<Property label="Spacing" title="how far apart the dabs are, as a share of the radius">
							<NumberField value={set.spacing} min={0.02} max={2} step={0.05} label="Spacing" onChange={(v) => setSculpt({ spacing: Math.max(0.02, v) })} />
						</Property>
					)}
				</>
			)}
			<Property label="Stabilize" title="lazy mouse: the brush trails the pointer on a string this many pixels long, for a steadier line (0 is off)">
				<NumberField value={set.stabilize} min={0} max={400} step={5} suffix="px" label="Stabilize" onChange={(v) => setSculpt({ stabilize: Math.max(0, Math.round(v)) })} />
			</Property>
			<Property label="Symmetry" title="mirror each stroke across the part's own axes, through its origin">
				<div class="insp-actions">
					{AXES.map((a, i) => (
						<Button
							key={a}
							active={set.mirror[i]}
							title={`Mirror strokes across ${a}`}
							onClick={() => {
								const m = [...set.mirror] as [boolean, boolean, boolean];
								m[i] = !m[i];
								setSculpt({ mirror: m });
							}}
						>
							{a}
						</Button>
					))}
				</div>
			</Property>
			<Property label="Radial" title="repeat each stroke this many times round an axis: wheels, flowers, ornaments (1 is off)">
				<NumberField value={set.radial} min={1} max={64} step={1} label="Radial count" width={64} onChange={(v) => setSculpt({ radial: Math.max(1, Math.min(64, Math.round(v))) })} />
				<SegmentedControl label="Radial axis" options={AXES.map((a, i) => ({ value: String(i), label: a }))} value={String(set.radialAxis)} onChange={(v) => setSculpt({ radialAxis: Number(v) as 0 | 1 | 2 })} />
			</Property>
			<Property label="Only" title="what a stroke may touch">
				<div class="insp-actions">
					<Checkbox checked={set.frontOnly} label="Front faces" title="leave the side of the mesh that looks away from you" onChange={(v) => setSculpt({ frontOnly: v })} />
					<Checkbox checked={set.topology} label="Connected (topology)" title="auto-masking: only the geometry joined to what is under the brush" onChange={(v) => setSculpt({ topology: v })} />
				</div>
			</Property>
			<Property label="Mask" title={`what the mask holds still, painted with the Mask brush (M): ${held} of ${pts} points. ⌘I inverts, ⌥M clears. The mask is the studio's, never the file's`}>
				<div class="insp-actions">
					<Button title="Invert the mask (⌘I)" onClick={() => maskAct("invert")}>
						Invert
					</Button>
					<Button disabled={!masked} title="Clear the mask (⌥M)" onClick={() => maskAct("clear")}>
						Clear
					</Button>
					<Button disabled={!masked} title="Grow the mask by a ring of neighbours" onClick={() => maskAct("grow")}>
						Grow
					</Button>
					<Button disabled={!masked} title="Shrink the mask by a ring of neighbours" onClick={() => maskAct("shrink")}>
						Shrink
					</Button>
					<Button disabled={!masked} title="Soften the mask's edge" onClick={() => maskAct("smooth")}>
						Smooth
					</Button>
					<Button disabled={!masked} title="Harden the mask's edge" onClick={() => maskAct("sharpen")}>
						Sharpen
					</Button>
				</div>
			</Property>
			<Property label="Filter" title="a deformation of the whole mesh at once, or of what the mask leaves free">
				<Select value={set.filter} options={FILTERS.map((f) => ({ value: f.kind, label: f.label }))} onChange={(v) => setSculpt({ filter: v as Filter })} />
			</Property>
			<Property label="Amount" title={FILTERS.find((f) => f.kind === set.filter)?.hint}>
				<NumberField value={set.filterAmount} step={0.05} label="Filter amount" onChange={(v) => setSculpt({ filterAmount: v })} />
				<Button title={`${FILTERS.find((f) => f.kind === set.filter)?.hint ?? ""}: one undo step`} onClick={() => run("sculpt.filter")}>
					Apply
				</Button>
			</Property>
			<Property label="Detail" title="how much geometry there is to sculpt: Subdivide adds a level of Catmull-Clark into the file, every face becoming quads, like a Multires level applied">
				<span class="ur-prop-val">{`${pts} points`}</span>
				<Button title="Subdivide the mesh once (Catmull-Clark): four times the faces to sculpt; a smoothing level it had is one fewer, so it looks the same" onClick={() => run("sculpt.subdivide")}>
					Subdivide
				</Button>
			</Property>
		</InspectorSection>
	);
}
