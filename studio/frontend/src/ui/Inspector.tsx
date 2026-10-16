// The inspector: the properties of whatever is selected. A shape gets its
// numbers and its fill; the part gets pivot, parent, anchors and chains;
// a pose gets offset, turn and size; nothing selected gets the document.

import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { cssColor, type Rgba, type Shape } from "@fastart/core";
import { InlineName } from "./Rename.tsx";
import { ColorPicker, hexOf, parseHex } from "./ColorPicker.tsx";
import { Slider } from "./Slider.tsx";
import { Button, Checkbox, Chip, ColorRow, Icon, InspectorSection, NumberField, Popover, Property, SegmentedControl, Select, TextField, cx } from "./ur.tsx";
import {
	doc,
	ed,
	parts,
	palette,
	curPart,
	curState,
	curClip,
	selShape,
	colShape,
	poseOfCur,
	constraints,
	renamePart,
	deleteSel,
	selOrder,
	selToPart,
	paintSel,
	setShapeNumber,
	setPivotNumber,
	setAnchorNumber,
	renameAnchor,
	deleteAnchor,
	parentCandidates,
	setParent,
	movePartInState,
	setPose,
	resetPose,
	toggleMembership,
	addToken,
	deleteToken,
	renameToken,
	setTokenColor,
	setDocName,
	addChain,
	deleteChain,
	renameChain,
	setChain,
	setChainBend,
	setClipLoop,
	freshName,
	linkPalette,
	unlinkPalette,
	overrideToken,
	anchorsIn,
	setAnchorAngle,
	likeCandidates,
	setLike,
	targetOf,
	clearTarget,
	setTokenEmissive,
	textures,
	addTexture,
	deleteTexture,
	renameTexture,
	setTextureCell,
	setTextureRelief,
	setMap,
	addMap,
	deleteMap,
	setSelTexture,
	setSelMapping,
	morphCount,
	resetMorph,
	setPathField,
	endGesture,
} from "../state/editor.ts";
import { TexturesPanel } from "./Textures.tsx";
import { renaming, menuAt, openMenuBelow, type MenuItem } from "../state/menu.ts";
import { paletteFiles } from "../state/project.ts";
import { askNewPalette } from "./fileMenu.ts";
import { basename, stripExt } from "../state/paths.ts";

const DEG = 180 / Math.PI;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A heading inside a section takes the keys of a row: Return renames, ⌫ deletes. */
const itemKeys = (rename: (() => void) | null, remove: (() => void) | null) => (e: KeyboardEvent) => {
	if (e.target !== e.currentTarget) return;
	if (e.key === "Enter" && rename) rename();
	else if ((e.key === "Backspace" || e.key === "Delete") && remove) remove();
	else return;
	e.preventDefault();
	e.stopPropagation();
};

/** The fill: a button showing the slot, opening the file's colours and the shared ones. */
function FillPick({ current, onPick }: { current: string | undefined; onPick: (t: string) => void }) {
	const [open, setOpen] = useState(false);
	const local = palette();
	const shared = ed.shared.value;
	const tok = ed.tokens.value.find((t) => t.name === current);
	const row = (t: { name: string; rgb: Rgba }, dim: boolean) => (
		<ColorRow
			key={t.name}
			name={t.name}
			color={cssColor(t.rgb)}
			hex={hexOf(t.rgb)}
			dim={dim}
			selected={t.name === current}
			onClick={() => {
				onPick(t.name);
				setOpen(false);
			}}
		/>
	);
	return (
		<span class="ur-anchor ed-fill">
			<button type="button" class="ed-fill-btn" aria-haspopup="dialog" aria-expanded={open} title="Fill: a colour slot of the palette" onClick={() => setOpen(!open)}>
				<span class={cx("ur-swatch", !tok && "ed-swatch-none")} style={tok ? { background: cssColor(tok.rgb) } : undefined} />
				<span class="ed-fill-name">{current ?? "None"}</span>
				<Icon name="chevrons-up-down" size={12} />
			</button>
			{open && (
				<Popover label="Fill" align="right" width={228} onClose={() => setOpen(false)}>
					<div class="ed-fill-list">
						{local.map((t) => row(t, false))}
						{shared.length > 0 && <div class="ed-sub">Shared</div>}
						{shared.map((t) => row(t, true))}
					</div>
				</Popover>
			)}
		</span>
	);
}

function ShapeSection({ sh, collision }: { sh: Shape; collision: boolean }) {
	const n = collision ? 1 : ed.sel.value.length;
	const elsewhere = !collision && ed.sel.value.some((r) => r.p !== ed.curPart.value);
	const num = (value: number, onChange: (v: number) => void, more: { axis?: "x" | "y"; min?: number; step?: number; suffix?: string; label?: string } = {}) => (
		<NumberField value={value} step={more.step ?? 0.1} min={more.min} axis={more.axis} suffix={more.suffix} label={more.label} stepper={!more.axis} onChange={onChange} onDone={endGesture} />
	);
	return (
		<InspectorSection title={collision ? "Collision shape" : n > 1 ? `${n} shapes` : "Shape"} hint="What is selected on the canvas" tail={sh.kind}>
			{!collision && (
				<Property label="Fill">
					<FillPick current={sh.color} onPick={paintSel} />
				</Property>
			)}
			{n === 1 && sh.kind === "circle" && (
				<>
					<Property label="Centre" layout="pair">
						{num(sh.at[0], (v) => setShapeNumber(sh, "at", 0, v), { axis: "x" })}
						{num(sh.at[1], (v) => setShapeNumber(sh, "at", 1, v), { axis: "y" })}
					</Property>
					<Property label="Radius">{num(sh.r, (v) => setShapeNumber(sh, "r", null, v), { min: 0 })}</Property>
				</>
			)}
			{n === 1 && sh.kind === "line" && (
				<>
					<Property label="Start" layout="pair">
						{num(sh.a[0], (v) => setShapeNumber(sh, "a", 0, v), { axis: "x", label: "Start x" })}
						{num(sh.a[1], (v) => setShapeNumber(sh, "a", 1, v), { axis: "y", label: "Start y" })}
					</Property>
					<Property label="End" layout="pair">
						{num(sh.b[0], (v) => setShapeNumber(sh, "b", 0, v), { axis: "x", label: "End x" })}
						{num(sh.b[1], (v) => setShapeNumber(sh, "b", 1, v), { axis: "y", label: "End y" })}
					</Property>
					<Property label={collision ? "Girth" : "Width"}>{num(sh.w, (v) => setShapeNumber(sh, "w", null, v), { min: 0 })}</Property>
				</>
			)}
			{n === 1 && sh.kind === "poly" && (
				<Property label="Points" title="Drag the corners on the canvas; Alt breaks a rect into a free quad">
					<span class="ur-prop-val ur-mono">{sh.points.length}</span>
				</Property>
			)}
			{n === 1 && sh.kind === "path" && !collision && (
				<>
					<Property label="Points" title="A path (1.7): drag a vertex to move it with its handles, a handle ring to bend the curve (Alt breaks the pair)">
						<span class="ur-prop-val ur-mono">{sh.points.length}</span>
					</Property>
					<Property label="" title="Closed fills; open strokes with a width">
						<Checkbox checked={!!sh.closed} label="Closed" onChange={(v) => setPathField(ed.sel.value[0], "closed", v)} />
					</Property>
					{!sh.closed && <Property label="Width">{num(sh.w ?? 1, (v) => setPathField(ed.sel.value[0], "w", v), { min: 0 })}</Property>}
				</>
			)}
			{n === 1 && !collision && (
				<Property label="Shade" title="Lighting on the slot's colour: 1 as is, below darker, above brighter. A palette swap keeps it.">
					{num(sh.shade ?? 1, (v) => setShapeNumber(sh, "shade", null, v), { min: 0 })}
				</Property>
			)}
			{!collision && textures().length > 0 && (
				<Property label="Texture" title="A texture of the file, tiled over the shape, over its colour">
					<Select value={sh.texture ?? ""} options={[{ value: "", label: "None" }, ...textures().map((t) => ({ value: t.name, label: t.name }))]} onChange={setSelTexture} />
				</Property>
			)}
			{n === 1 && !collision && sh.texture && (
				<>
					<Property label="Offset" layout="pair" title="Where the pattern's origin lands, in this shape's space">
						{num(sh.mapping?.at?.[0] ?? 0, (v) => setSelMapping({ at: [v, sh.mapping?.at?.[1] ?? 0] }, "map-x"), { axis: "x", label: "Texture x" })}
						{num(sh.mapping?.at?.[1] ?? 0, (v) => setSelMapping({ at: [sh.mapping?.at?.[0] ?? 0, v] }, "map-y"), { axis: "y", label: "Texture y" })}
					</Property>
					<Property label="Turn" title="The pattern's turn, in this shape's space">
						{num((sh.mapping?.angle ?? 0) * DEG, (v) => setSelMapping({ angle: v / DEG }, "map-angle"), { step: 5, suffix: "°" })}
					</Property>
					<Property label="Size" title="The pattern's size, in this shape's space">
						{num(sh.mapping?.scale ?? 1, (v) => setSelMapping({ scale: v }, "map-scale"), { min: 0.01 })}
					</Property>
					{sh.mapping?.xf && (
						<Property label="">
							<Chip title="An affine mapping, as a projection writes it; typing a number replaces it with a placement">Projected</Chip>
						</Property>
					)}
				</>
			)}
			<div class="insp-actions">
				{!collision && (
					<>
						<Button title="Raise (])" onClick={() => selOrder(true)}>
							Raise
						</Button>
						<Button title="Lower ([)" onClick={() => selOrder(false)}>
							Lower
						</Button>
						{elsewhere && (
							<Button title="Move into the current part" onClick={selToPart}>
								To part
							</Button>
						)}
					</>
				)}
				<Button variant="danger" title="Delete (X)" onClick={deleteSel}>
					Delete
				</Button>
			</div>
		</InspectorSection>
	);
}

function PoseSection() {
	const st = curState();
	const part = curPart();
	if (!part || !st) return null;
	const sp = poseOfCur();
	const at = sp ? (sp.offset ?? part.pivot ?? [0, 0]) : [0, 0];
	return (
		<InspectorSection title="Pose" hint={`How "${part.name}" sits in the state "${st.name}"`} tail={st.name}>
			{sp ? (
				<>
					<Property label="Offset" layout="pair" title="Where the pivot lands">
						<NumberField axis="x" label="Pose x" value={at[0]} step={0.1} stepper={false} onChange={(v) => setPose(sp, { offset: [v, (sp.offset ?? part.pivot ?? [0, 0])[1]] }, "pose-x")} onDone={endGesture} />
						<NumberField axis="y" label="Pose y" value={at[1]} step={0.1} stepper={false} onChange={(v) => setPose(sp, { offset: [(sp.offset ?? part.pivot ?? [0, 0])[0], v] }, "pose-y")} onDone={endGesture} />
					</Property>
					<Slider label="Turn" value={(sp.rotate ?? 0) * DEG} min={-180} max={180} step={1} show={(v) => `${Math.round(v)}°`} onInput={(v) => setPose(sp, { rotate: v / DEG }, "pose-turn")} />
					<Slider label="Size" value={sp.scale === undefined || sp.scale === 0 ? 1 : sp.scale} min={0.1} max={3} step={0.05} show={(v) => `${v.toFixed(2)}×`} onInput={(v) => setPose(sp, { scale: v }, "pose-size")} />
					<Property label="" title="Flipped left-to-right about the pivot, before the turn">
						<Checkbox checked={!!sp.mirror} label="Mirror" onChange={() => setPose(sp, { mirror: !sp.mirror })} />
					</Property>
					<div class="insp-actions">
						<Button onClick={() => resetPose(sp)}>Reset</Button>
						<Button onClick={() => toggleMembership(ed.curState.value, part.name)}>Leave out of this state</Button>
					</div>
				</>
			) : (
				<>
					<div class="insp-hint flush">Not drawn in this state</div>
					<div class="insp-actions">
						<Button onClick={() => toggleMembership(ed.curState.value, part.name)}>Add it</Button>
					</div>
				</>
			)}
		</InspectorSection>
	);
}

const BENDS = [
	{ value: "0", label: "Either" },
	{ value: "1", label: "CW" },
	{ value: "-1", label: "CCW" },
] as const;

function ChainSection({ k }: { k: number }) {
	const ps = parts();
	const cs = constraints();
	const part = ps[k];
	const mine = cs.map((c, i) => ({ c, i })).filter(({ c }) => c.chain[c.chain.length - 1] === part.name);
	const ren = renaming.value;
	const anchors = anchorsIn(part);
	const canStart = anchors.length > 0;
	const add = () => {
		const chain = part.parent ? [part.parent, part.name] : [part.name];
		addChain(freshName(`${part.name} reach`, cs.map((c) => c.name)), chain, `${part.name}/${anchors[0].name}`);
		renaming.value = { kind: "chain", index: constraints().length - 1 };
	};
	return (
		<InspectorSection
			title="IK"
			hint="Inverse kinematics: drag the ring on the canvas and the chain follows"
			actions={
				<button type="button" disabled={!canStart} aria-label="New chain" title={canStart ? "An IK chain reaching with this part's anchor" : "Give the part an anchor first: that is what a chain reaches with"} onClick={add}>
					<Icon name="plus" size={14} />
				</button>
			}
		>
			{mine.length === 0 && <div class="insp-hint flush">{canStart ? "No chain ends at this part" : "Give the part an anchor first: that is what a chain reaches with"}</div>}
			{mine.map(({ c, i }) => {
				const root = ps.find((p) => p.name === c.chain[0]);
				const pin = targetOf(c.name);
				const rename = () => (renaming.value = { kind: "chain", index: i });
				return (
					<div class="ed-block" key={c.name}>
						<div
							class="ed-item"
							tabIndex={0}
							title="Double-click to rename · right-click for more"
							onDblClick={rename}
							onKeyDown={itemKeys(rename, () => deleteChain(i))}
							onContextMenu={(e) =>
								menuAt(e, [
									{ label: "Rename", keys: "Enter", run: rename },
									{ label: "Delete chain", danger: true, sep: true, run: () => deleteChain(i) },
								])
							}
						>
							<Icon name="bone" size={14} />
							{ren?.kind === "chain" && ren.index === i ? (
								<InlineName value={c.name} onCommit={(n) => (renameChain(i, n), (renaming.value = null))} onCancel={() => (renaming.value = null)} />
							) : (
								<span class="ed-item-name">{c.name}</span>
							)}
							<Chip title={c.chain.join(" › ")}>{c.chain.join(" › ")}</Chip>
						</div>
						<Property label="Length">
							<Button disabled={!root?.parent} title="One more part toward the root" onClick={() => root?.parent && setChain(i, [root.parent, ...c.chain], c.end)}>
								Longer
							</Button>
							<Button disabled={c.chain.length < 2} onClick={() => setChain(i, c.chain.slice(1), c.end)}>
								Shorter
							</Button>
						</Property>
						<Property label="Reaches with" title="The anchor it reaches with">
							<Select value={c.end} options={anchors.map((a) => ({ value: `${part.name}/${a.name}`, label: a.name }))} onChange={(v) => setChain(i, c.chain, v)} />
						</Property>
						<Property label="Bend" title="Which way an elbow folds">
							<SegmentedControl label="Bend" options={[...BENDS]} value={String(c.bend ?? 0) as "0" | "1" | "-1"} onChange={(v) => setChainBend(i, v === "1" ? 1 : v === "-1" ? -1 : undefined)} />
						</Property>
						{pin && (
							<Property label="Pinned at" title="The chain keeps reaching this point while the pose changes; drag the ring to move it">
								<span class="ur-prop-val ur-mono">
									{pin.at[0]}, {pin.at[1]}
								</span>
								<Button title="Let go: the rotations stay, the pin is gone" onClick={() => clearTarget(c.name)}>
									Release
								</Button>
							</Property>
						)}
					</div>
				);
			})}
		</InspectorSection>
	);
}

function AnchorSection({ k }: { k: number }) {
	const part = parts()[k];
	const ren = renaming.value;
	const list = anchorsIn(part);
	if (!list.length) return null;
	return (
		<InspectorSection title="Anchors" hint="Named points a game or a chain reaches for; a direction makes one a socket" tail={part.like ? `${part.like}'s` : undefined}>
			{list.map((a, i) => {
				const rename = () => (renaming.value = { kind: "anchor", index: k, sub: i });
				return (
					<div class="ed-block" key={a.name}>
						<div
							class="ed-item"
							tabIndex={0}
							title="Double-click to rename · right-click for more"
							onDblClick={rename}
							onKeyDown={itemKeys(rename, () => deleteAnchor(k, i))}
							onContextMenu={(e) =>
								menuAt(e, [
									{ label: "Rename", keys: "Enter", run: rename },
									a.angle === undefined ? { label: "Give it a direction", run: () => setAnchorAngle(k, i, 0) } : { label: "Drop the direction", run: () => setAnchorAngle(k, i, undefined) },
									{ label: "Delete anchor", danger: true, sep: true, run: () => deleteAnchor(k, i) },
								])
							}
						>
							<Icon name="anchor" size={14} />
							{ren?.kind === "anchor" && ren.index === k && ren.sub === i ? (
								<InlineName value={a.name} onCommit={(n) => (renameAnchor(k, i, n), (renaming.value = null))} onCancel={() => (renaming.value = null)} />
							) : (
								<span class="ed-item-name">{a.name}</span>
							)}
						</div>
						<Property label="Position" layout="pair">
							<NumberField axis="x" label={`${a.name} x`} value={a.at[0]} step={0.1} stepper={false} onChange={(v) => setAnchorNumber(k, i, 0, v)} onDone={endGesture} />
							<NumberField axis="y" label={`${a.name} y`} value={a.at[1]} step={0.1} stepper={false} onChange={(v) => setAnchorNumber(k, i, 1, v)} onDone={endGesture} />
						</Property>
						<Property label="Direction" title="The direction an attached thing points">
							{a.angle === undefined ? (
								<Button title="Give it a direction: what attaches here points this way" onClick={() => setAnchorAngle(k, i, 0)}>
									Add direction
								</Button>
							) : (
								<>
									<NumberField value={Math.round(a.angle * DEG)} step={1} suffix="°" label={`${a.name} direction`} onChange={(v) => setAnchorAngle(k, i, v / DEG, `angle-${i}`)} onDone={endGesture} />
									<Button variant="toolbar" class="ur-btn-sm" icon="x" title="Drop the direction" onClick={() => setAnchorAngle(k, i, undefined)} />
								</>
							)}
						</Property>
					</div>
				);
			})}
		</InspectorSection>
	);
}

function PartSection() {
	const k = ed.curPart.value;
	const part = parts()[k];
	if (!part) return null;
	const preview = !!curClip();
	const morphs = morphCount(k);
	const ownShapes = !part.like && (!!part.shapes?.length || !!part.anchors?.length);
	return (
		<>
			<InspectorSection title="Part" hint="A layer with a pivot: the unit that poses" tail={part.name}>
				{morphs > 0 && (
					<Property label="Morph" title="A morph (1.6): this state reshapes the part's polys or paths; clips lerp the corners between states">
						<span class="ur-prop-val">{plural(morphs, "shape")} reshaped</span>
						<Button title="Draw the base shapes in this state again" onClick={() => resetMorph(k)}>
							Reset
						</Button>
					</Property>
				)}
				<Property label="Name">
					<div class="ur-tf ed-name">
						<InlineName key={part.name} value={part.name} focus={false} onCommit={(n) => renamePart(k, n)} onCancel={() => {}} />
					</div>
				</Property>
				<Property label="Pivot" layout="pair" title="The point the part turns about and is placed by">
					<NumberField axis="x" label="Pivot x" value={(part.pivot ?? [0, 0])[0]} step={0.1} stepper={false} onChange={(v) => setPivotNumber(k, 0, v)} onDone={endGesture} />
					<NumberField axis="y" label="Pivot y" value={(part.pivot ?? [0, 0])[1]} step={0.1} stepper={false} onChange={(v) => setPivotNumber(k, 1, v)} onDone={endGesture} />
				</Property>
				<Property label="Parent" title="The part this one rides">
					<Select value={part.parent ?? ""} disabled={parts().length < 2} options={[{ value: "", label: "None" }, ...parentCandidates(k).map((n) => ({ value: n, label: n }))]} onChange={(v) => setParent(k, v || undefined)} />
				</Property>
				<Property label="Drawn like" title={ownShapes ? "A part drawn like another has no shapes of its own: empty this one first" : "Draw another part's shapes and anchors (the left claw is the right one, mirrored in the state)"}>
					<Select value={part.like ?? ""} disabled={ownShapes ? true : likeCandidates(k).length === 0} options={[{ value: "", label: "Itself" }, ...likeCandidates(k).map((n) => ({ value: n, label: n }))]} onChange={(v) => setLike(k, v || undefined)} />
				</Property>
				{!preview && (
					<div class="insp-actions">
						<Button icon="target" active={ed.pending.value === "pivot"} title="The next canvas click places the pivot" onClick={() => (ed.pending.value = ed.pending.value === "pivot" ? "none" : "pivot")}>
							Set pivot
						</Button>
						<Button icon="anchor" active={ed.pending.value === "anchor"} title="The next canvas click places an anchor" onClick={() => (ed.pending.value = ed.pending.value === "anchor" ? "none" : "anchor")}>
							Add anchor
						</Button>
						<span class="ed-spacer" />
						<Button variant="toolbar" class="ur-btn-sm" icon="arrow-up" title="Raise: paints later in this state" onClick={() => movePartInState(part.name, true)} />
						<Button variant="toolbar" class="ur-btn-sm" icon="arrow-down" title="Lower: paints earlier in this state" onClick={() => movePartInState(part.name, false)} />
					</div>
				)}
			</InspectorSection>
			{!preview && <PoseSection />}
			<AnchorSection k={k} />
			<ChainSection k={k} />
		</>
	);
}

function ClipSection() {
	const c = curClip()!;
	const k = ed.curClip.value;
	return (
		<InspectorSection title="Clip" hint="States in time; the timeline below scrubs it" tail={c.name}>
			<Property label="">
				<Checkbox checked={!!c.loop} label="Loop" onChange={() => setClipLoop(k, !c.loop)} />
			</Property>
			<Property label="Keys">
				<span class="ur-prop-val ur-mono">{c.keys.length}</span>
			</Property>
			<div class="insp-hint flush">Keys name states · to change what a key looks like, pose that state</div>
		</InspectorSection>
	);
}

/** The picked colour's value, typed: `#rrggbb`, or `#rrggbbaa` for one that is not opaque. */
function HexField({ rgb, onCommit }: { rgb: Rgba; onCommit: (rgb: Rgba) => void }) {
	const shown = hexOf(rgb);
	const [v, set] = useState(shown);
	useEffect(() => set(shown), [shown]);
	const bad = !parseHex(v, rgb[3]);
	const commit = (text: string) => {
		const next = parseHex(text, rgb[3]);
		if (!next) return set(shown);
		if (hexOf(next) !== shown) {
			onCommit(next);
			endGesture();
		}
	};
	return <TextField mono value={v} invalid={bad} placeholder="#rrggbb" onChange={set} onSubmit={commit} onBlur={commit} />;
}

function DocumentSection() {
	const d = doc();
	const toks = palette();
	const shared = ed.shared.value;
	const refs = d.palette_refs ?? [];
	const missing = new Set(ed.unresolved.value);
	const local = new Set(toks.map((t) => t.name));
	const [pick, setPick] = useState<{ k: number; x: number; y: number } | null>(null);
	const ren = renaming.value;
	const linkItems = (): MenuItem[] => {
		const cur = ed.path.value;
		const linked = new Set(refs);
		const items: MenuItem[] = paletteFiles()
			.filter((f) => f !== cur)
			.map((f) => ({ label: stripExt(f), disabled: linked.has(f), run: () => linkPalette(f) }));
		items.push({
			label: "New palette…",
			sep: items.length > 0,
			run: () => void askNewPalette("", false).then((rel) => rel && linkPalette(rel)),
		});
		return items;
	};
	const addColour = () => {
		addToken(freshName("colour", toks.map((t) => t.name)));
		renaming.value = { kind: "token", index: palette().length - 1 };
	};
	const pickAt = (k: number, el: HTMLElement) => {
		const r = el.getBoundingClientRect();
		setPick({ k, x: r.left, y: r.bottom + 6 });
	};
	const collisions = d.collision?.length ?? 0;
	return (
		<>
			<InspectorSection title="Document" hint="The file itself">
				<Property label="Name">
					<TextField value={d.name ?? ""} placeholder="untitled" onChange={setDocName} onBlur={endGesture} onSubmit={() => (document.activeElement as HTMLElement | null)?.blur()} />
				</Property>
				<Property label="Collision">
					<span class="ur-prop-val">{plural(collisions, "shape")} · C to edit</span>
				</Property>
			</InspectorSection>
			<TexturesPanel
				api={{
					textures: textures(),
					rel: ed.path.value ?? "",
					add: addTexture,
					remove: deleteTexture,
					rename: renameTexture,
					cell: setTextureCell,
					relief: setTextureRelief,
					map: setMap,
					addMap,
					removeMap: deleteMap,
					freshName,
				}}
			/>
			<InspectorSection
				title="Colours"
				hint="The file's colour slots: a shape names a slot, this says what it means today. Change one and every shape follows."
				actions={
					<button type="button" aria-label="New colour" title="New colour" onClick={addColour}>
						<Icon name="plus" size={14} />
					</button>
				}
			>
				{toks.length === 0 && <div class="insp-hint flush">No colours yet</div>}
				<div class="ed-colors" role="listbox" aria-label="Colours">
					{toks.map((t, k) => {
						const sel = k === ed.curTok.value;
						const rename = () => (renaming.value = { kind: "token", index: k });
						return (
							<Fragment key={t.name}>
								<ColorRow
									name={ren?.kind === "token" && ren.index === k ? <InlineName value={t.name} onCommit={(n) => (renameToken(k, n), (renaming.value = null))} onCancel={() => (renaming.value = null)} /> : t.name}
									color={cssColor(t.rgb)}
									hex={sel ? "" : hexOf(t.rgb)}
									selected={sel}
									title="Click the swatch to edit the colour · double-click to rename"
									trailing={
										(t.emissive ?? 0) > 0 ? (
											<Chip mono title="Emissive: gives off light in a game that has it">
												<Icon name="sun" size={11} />
												{t.emissive}
											</Chip>
										) : undefined
									}
									onClick={() => (ed.curTok.value = k)}
									onDoubleClick={rename}
									onSwatch={(e) => pickAt(k, e.currentTarget as HTMLElement)}
									onContextMenu={(e) => {
										ed.curTok.value = k;
										const row = e.currentTarget as HTMLElement;
										menuAt(e, [
											{ label: "Rename", run: rename },
											{ label: "Edit colour…", run: () => pickAt(k, row) },
											{ label: "Delete colour", danger: true, sep: true, run: () => deleteToken(k) },
										]);
									}}
									onDelete={() => deleteToken(k)}
								/>
								{sel && (
									<div class="ed-color-edit">
										<HexField rgb={t.rgb} onCommit={(rgb) => setTokenColor(k, rgb)} />
										<Button variant="toolbar" class="ur-btn-sm" icon="trash-2" title="Delete colour (⌫)" onClick={() => deleteToken(k)} />
									</div>
								)}
							</Fragment>
						);
					})}
				</div>
			</InspectorSection>
			<InspectorSection
				title="Shared palettes"
				hint="Palette files this one draws from, by slot name. The file's own colours win."
				actions={
					<button type="button" aria-label="Link a palette" title="Draw from a palette file in this project" onClick={(e) => openMenuBelow(e.currentTarget as HTMLElement, linkItems(), { align: "right" })}>
						<Icon name="plus" size={14} />
					</button>
				}
			>
				{refs.length === 0 && <div class="insp-hint flush">No palette linked</div>}
				{refs.map((ref, i) => (
					<div
						class={cx("ed-item ed-item-row", missing.has(ref) && "dim")}
						key={ref}
						title={ref}
						tabIndex={0}
						onKeyDown={itemKeys(null, () => unlinkPalette(i))}
						onContextMenu={(e) => menuAt(e, [{ label: "Unlink", run: () => unlinkPalette(i) }])}
					>
						<Icon name="palette" size={14} />
						<span class="ed-item-name">{stripExt(basename(ref))}</span>
						{missing.has(ref) && (
							<Chip>
								<Icon name="triangle-alert" size={11} />
								Missing
							</Chip>
						)}
						<button type="button" class="ed-item-btn" aria-label="Unlink" title="Unlink: stop drawing from it" onClick={() => unlinkPalette(i)}>
							<Icon name="unlink" size={14} />
						</button>
					</div>
				))}
				{shared.length > 0 && (
					<>
						<div class="ed-sub" title="Slots the linked palettes supply: paint with them here, change them in their own file, or override one">
							From shared
						</div>
						<div class="ed-colors">
							{shared.map((t) => (
								<ColorRow
									key={t.name}
									name={t.name}
									color={cssColor(t.rgb)}
									hex=""
									dim
									title="From a shared palette: change it in its own file, or override it here"
									trailing={
										local.has(t.name) ? (
											<Chip title="This file has its own colour for the slot">Overridden</Chip>
										) : (
											<Button title="Copy the slot into this file, so it can be changed here" onClick={() => overrideToken(t.name)}>
												Override
											</Button>
										)
									}
								/>
							))}
						</div>
					</>
				)}
			</InspectorSection>
			{pick && toks[pick.k] && (
				<ColorPicker rgb={toks[pick.k].rgb} emissive={toks[pick.k].emissive ?? 0} onEmissive={(v) => setTokenEmissive(pick.k, v)} x={pick.x} y={pick.y} onChange={(rgb: Rgba) => setTokenColor(pick.k, rgb)} onClose={() => setPick(null)} />
			)}
		</>
	);
}

export function Inspector() {
	void ed.rev.value;
	const collide = ed.collide.value;
	const clip = curClip();
	const sh = collide ? colShape() : selShape();
	// a part chosen on purpose (a layer row, a hit, a grip) shows; an empty click on the canvas lets go of it
	const picked = ed.partPicked.value;
	return (
		<div class="inspector">
			{collide &&
				(sh ? (
					<ShapeSection sh={sh} collision />
				) : (
					<InspectorSection title="Collision" hint="Shapes a game may treat as solid; never drawn">
						<div class="insp-hint flush">Draw with the tools, or click a shape to select it</div>
					</InspectorSection>
				))}
			{!collide && clip && <ClipSection />}
			{!collide && !clip && sh && <ShapeSection sh={sh} collision={false} />}
			{!collide && (sh || picked) && <PartSection />}
			{!collide && !clip && !sh && !picked && <DocumentSection />}
		</div>
	);
}
