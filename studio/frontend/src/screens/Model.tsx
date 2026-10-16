// The model screen's parts of the workspace: a 3D file. Parts, states and
// clips for the sidebar, the solids' tools for the floating bar, the model
// turned under the view on the canvas, the timeline below when a clip is
// chosen, the inspector. The frame is screens/Workspace.tsx.

import { useEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { clipDuration3, cssColor, VIEWS, type Ease, type StatePart3 } from "@fastart/core";
import { InlineName } from "../ui/Rename.tsx";
import { ColorPicker } from "../ui/ColorPicker.tsx";
import { ModelCanvas } from "../canvas/ModelCanvas.tsx";
import { TexturesPanel } from "../ui/Textures.tsx";
import { project } from "../state/project.ts";
import { gizmoStatus } from "../canvas/gizmo3.ts";
import { meshStatus } from "../canvas/meshtool3.ts";
import { shell } from "../shell/shell.ts";
import { ask } from "../state/prompt.ts";
import { dirname } from "../state/paths.ts";
import { work, shading, setShading, mirrorOn, setMirror, setRef, refFailed, refForget, REF_VIEWS, type RefView } from "../state/workspace.ts";
import { ToolBar, Transport, gridMode, keyReadout, type ToolSpec } from "../ui/Tools.tsx";
import { Button, Checkbox, Chip, ColorRow, GroupHeader, Icon, InspectorSection, NumberField, Property, SegmentedControl, Select, Sheet, SidebarRow, TextField, cx, type IconName, type NumberFieldProps } from "../ui/ur.tsx";
import { showIssues } from "../ui/ProjectBar.tsx";
import { renaming, menuAt, type MenuItem } from "../state/menu.ts";
import { sidebar } from "../state/sidebar.ts";
import { openSheet, closeSheet } from "../state/prompt.ts";
import { busy, logActivity } from "../state/activity.ts";
import { run, keysFor } from "../state/commands.ts";
import { ShapeRow, folding, opens, shapeLabels, revealShapeRow, type ShapeRowActs } from "../ui/ShapeRows.tsx";
import { basename } from "../state/paths.ts";
import {
	md,
	parts,
	states,
	clips,
	palette,
	curPart,
	curState,
	curClip,
	poseOfCur,
	selShape,
	freshName,
	addPart,
	deletePart,
	renamePart,
	parentCandidates,
	setParent,
	setLike,
	setPivotAxis,
	selectState,
	selectClip,
	addState,
	deleteState,
	renameState,
	toggleMembership,
	movePartInState,
	setPose,
	resetPose,
	addClip,
	deleteClip,
	renameClip,
	setClipLoop,
	seek,
	addKey,
	deleteKey,
	setKeyTime,
	setKeyState,
	setKeyEase,
	paintSel,
	setShapeNumber,
	setShapeCoord,
	setVertexAxis,
	setSmoothField,
	setSweepField,
	creaseOf,
	setCreaseSel,
	setPick,
	liveOp,
	adjustOp,
	chooseMannequin,
	morphCount,
	resetMorph,
	selShapePosed,
	deleteSel,
	addToken,
	deleteToken,
	renameToken,
	setTokenColor,
	setDocName,
	setView,
	setTurn,
	projectViews,
	hullOfPart,
	textures,
	addTexture,
	deleteTexture,
	renameTexture,
	setTextureCell,
	setMap,
	endGesture,
	addMap,
	deleteMap,
	setSelTexture,
	setSelMappingScale,
	setTextureRelief,
	unwrapSel,
	boxMapSel,
	paintToken,
	faceToken,
	modsOf,
	addMod,
	removeMod,
	moveMod,
	setModField,
	modToken,
	applyMod,
	mirrorModOn,
	isPipe,
	pipeTwin,
	setPipeField,
	setPipeRadiusAt,
	setPipeRound,
	setPipePoint,
	setPipeSymmetry,
	selected,
	sameSel,
	selectShapes,
	chooseVerts,
	chooseEdges,
	chooseFaces,
	type Tool3,
	type Sel3,
	type Pick3,
	type ModOp,
} from "../state/model.ts";
import type { Mod, Part3, Shape3, Vec3 } from "@fastart/core";

const DEG = 180 / Math.PI;
const TOOLS: ToolSpec<Tool3>[] = [
	{ tool: "select", label: "Select", key: "V", icon: "mouse-pointer-2" },
	{ tool: "rect", label: "Box", key: "R", icon: "square", makes: "drag a rectangle in the view plane: a box, as deep as the depth field" },
	{ tool: "circle", label: "Ball", key: "O", icon: "circle", makes: "drag from the centre: a ball" },
	{ tool: "line", label: "Rod", key: "L", icon: "slash", makes: "drag a line: a rod, half the depth wide" },
	{ tool: "poly", label: "Prism", key: "P", icon: "pentagon", makes: "click a profile, close it: a prism, as deep as the depth field" },
	{ tool: "pipe", label: "Pipe", key: "U", icon: "route", makes: "click points along a path: a pipe through them, half the depth wide" },
];
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const EASES: Ease[] = ["linear", "in", "out", "in-out", "step"];

// ------------------------------------------------------------- top

/** The status bar's line: the mode, and what a gesture does in it. */
export function modelStatus(): string {
	const moving = meshStatus() ?? gizmoStatus();
	if (moving) return moving;
	const tool = md.tool.value;
	const st = curState();
	const clip = curClip();
	const vn = md.viewName.value || "free";
	if (clip) return `Previewing ${clip.name} · ${vn} · Space plays · keys name states, pose those to change a key`;
	if (md.pending.value === "pivot") return "Click the canvas to place the pivot";
	if (tool === "poly") return "Click a profile in the view plane · click the first point or press Enter to close it into a prism · Esc drops it";
	if (tool === "pipe") {
		const n = md.pipePts.value.length;
		const where = md.onSurface.value ? `on the surface under the pointer, lifted ${md.lift.value}` : "on the view plane";
		return `${vn} · Pipe: ${n ? plural(n, "point") : "click its first point"} · each click lands ${where}${md.pipeTwin.value ? " · with a mirrored twin across x" : ""} · Return or a click on the last point finishes · Esc drops it`;
	}
	if (tool !== "select") return `${vn} · ${TOOLS.find((t) => t.tool === tool)?.makes ?? ""}`;
	const sh = selShape();
	if (st && md.painting.value && sh?.kind === "mesh") return `${st.name} · ${vn} · painting faces ${paintToken()} · click or drag over the mesh · B or Esc stops`;
	if (st && isPipe(sh) && !md.also.value.length) {
		const twin = md.sel.value && pipeTwin(md.sel.value) ? " · its twin follows, mirrored across x" : "";
		return `${st.name} · ${vn} · a pipe of ${plural(sh.path?.points.length ?? 0, "point")} · drag a point to move it${md.onSurface.value ? " along the surface" : " in the view plane"}${twin} · ⌫ takes the chosen point out`;
	}
	if (st && sh?.kind === "mesh" && !md.also.value.length) {
		const what = md.pick.value === "corner" ? "corners" : md.pick.value === "edge" ? "edges" : "faces";
		const sym = mirrorOn(parts()[md.sel.value!.part]?.name ?? "", md.sel.value!.shape) && !mirrorModOn(sh) ? " · mirrored across x" : "";
		const cage = sh.mods?.length ? ` · the cage under ${plural(sh.mods.length, "modifier")}` : "";
		return `${st.name} · ${vn} · choosing ${what}${sym}${cage} · ⇧ adds · E extrudes, I insets, K cuts a loop, M merges, B paints · G T S move, turn and size what is chosen`;
	}
	if (st) return `${st.name} · ${vn} · Arrows move along an axis, rings turn about one · G T S move, turn and size by key · middle-drag orbits`;
	return "";
}

/** The path bar's right side: the tools and modes, the depth new solids get, then the clip's transport. */
export function ModelTools() {
	void md.rev.value;
	const clip = curClip();
	const dur = clip ? clipDuration3(clip) : 0;
	return (
		<>
			<ToolBar
				tools={TOOLS}
				current={md.tool.value}
				disabled={(t) => !!clip && t !== "select"}
				why="A clip is a preview; pick a state to edit"
				modes={[
					{ id: "deform", command: "edit.deform", label: "Deform: corner drags reshape the part in this state only", icon: "spline", key: "D", on: md.deform.value, disabled: !!clip, why: "A clip is a preview; pick a state to deform" },
					{ id: "outline", command: "model.outline", label: "Silhouettes, the way Project draws them", icon: "square-dashed", on: md.outline.value },
					{ id: "collision", command: "view.collision", label: "Collision solids", icon: "shield", key: "C", on: md.collide.value },
					gridMode(),
					...(md.tool.value === "pipe"
						? [
								{ id: "surface", command: "model.onSurface", label: "On surface: each point lands on the mesh under the pointer, lifted along its normal", icon: "magnet" as const, on: md.onSurface.value },
								{ id: "twin", command: "model.pipeTwin", label: "Symmetry: the pipe gets a mirrored twin across x", icon: "flip-horizontal-2" as const, on: md.pipeTwin.value },
							]
						: []),
				]}
			/>
			{md.tool.value === "pipe" && md.onSurface.value && (
				<>
					<span class="ur-pathbar-sep" />
					<NumberField value={md.lift.value} step={0.05} min={0} width={72} suffix="lift" stepper={false} title="How far off the surface a pipe's points sit, along its normal" label="Lift" onChange={(v) => (md.lift.value = Math.max(0, v))} />
				</>
			)}
			<span class="ur-pathbar-sep" />
			<NumberField value={md.thick.value} step={0.5} min={0.1} width={78} suffix="deep" stepper={false} title="How deep a new box, prism, ball or rod is, along the view axis" label="Depth" onChange={(v) => (md.thick.value = Math.max(0.1, v))} />
			{clip && (
				<>
					<span class="ur-pathbar-sep" />
					<Transport name={clip.name} playing={md.playing.value} onPlay={() => run("clip.play")} onRewind={() => seek(0)} readout={keyReadout(clip.keys, md.clipTime.value)} progress={dur > 0 ? md.clipTime.value / dur : 0} />
				</>
			)}
		</>
	);
}

const CAMERAS = Object.keys(VIEWS).filter((v) => v !== "side");

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const REF_NAMES: Record<RefView, string> = { front: "Front", side: "Side", top: "Top" };
/** the pin the section is showing, by view: it lasts the session */
const refTab = signal<RefView>("front");

/** Choose an image of the project for a view's pin: the platform's dialog in the app, a path where there is none. */
async function pinReference(v: RefView) {
	const root = project.root.value ?? "";
	let rel: string | null;
	if (shell.kind === "wails") rel = await shell.pickFile(root, dirname(md.path.value ?? ""), `Reference image for the ${v} view`, "Pin", IMAGE_EXTS);
	else
		rel = await ask("Reference image", work.value.refs?.[v]?.path ?? "", {
			ok: "Pin",
			mono: true,
			hint: `An image of the project, by its path from the project's root (refs/helm-${v}.png). It shows behind the model in the ${v} view only.`,
			validate: (p) => (IMAGE_EXTS.some((e) => p.toLowerCase().endsWith(`.${e}`)) ? null : "A png, jpg, webp or gif"),
		});
	if (!rel) return;
	refForget(root, rel);
	setRef(v, { path: rel });
	refTab.value = v;
	// the view it is pinned to, so it shows at once
	setView(v === "side" ? "right" : v);
}

/** The View tab's reference images: one per straight-on view, behind the model, kept in the studio's notes and never in the file. */
function ReferenceSection() {
	const v = refTab.value;
	const ref = work.value.refs?.[v];
	const failed = ref ? refFailed(project.root.value ?? "", ref.path) : false;
	const pinned = REF_VIEWS.filter((k) => work.value.refs?.[k]);
	return (
		<InspectorSection title="Reference images" hint="an image pinned behind the model in the front, side or top view, to model over; kept with the studio, never in the file" tail={pinned.length ? `${pinned.length} pinned` : undefined}>
			<Property label="View" title="which view's image this is; it shows only when the canvas looks from there">
				<SegmentedControl label="Reference view" options={REF_VIEWS.map((k) => ({ value: k, label: REF_NAMES[k] }))} value={v} onChange={(k) => (refTab.value = k)} />
			</Property>
			{ref ? (
				<>
					<Property label="Image" title={ref.path}>
						<span class="ur-prop-val model-grow" title={ref.path}>
							{basename(ref.path)}
						</span>
					</Property>
					{failed && <div class="insp-hint flush">Could not read {ref.path}: it has moved, or is not an image</div>}
					<Property label="Position" layout="pair" title="where the image's middle sits, in the canvas's units">
						<N axis="x" value={ref.x} step={0.5} stepper={false} onChange={(x) => setRef(v, { x })} />
						<N axis="y" value={ref.y} step={0.5} stepper={false} onChange={(y) => setRef(v, { y })} />
					</Property>
					<Property label="Width" title="how wide the image is, in the canvas's units; its height follows">
						<N value={ref.w} min={0.1} step={1} onChange={(w) => setRef(v, { w: Math.max(0.1, w) })} />
					</Property>
					<Property label="Opacity">
						<input class="ed-range" type="range" aria-label="Reference opacity" min={0} max={1} step={0.05} value={ref.opacity} onInput={(e) => setRef(v, { opacity: Number((e.target as HTMLInputElement).value) })} />
						<span class="ed-range-val">{Math.round(ref.opacity * 100)}%</span>
					</Property>
					<div class="insp-actions">
						<Button title={`Look from the ${v}, where this image shows`} onClick={() => setView(v === "side" ? "right" : v)}>
							Show
						</Button>
						<Button onClick={() => void pinReference(v)}>Replace…</Button>
						<Button variant="danger" onClick={() => setRef(v, null)}>
							Unpin
						</Button>
					</div>
				</>
			) : (
				<>
					<div class="insp-hint flush">No image pinned to the {v} view</div>
					<div class="insp-actions">
						<Button icon="image" title={`Pin an image of the project behind the model in the ${v} view`} onClick={() => void pinReference(v)}>
							Pin an image…
						</Button>
					</div>
				</>
			)}
		</InspectorSection>
	);
}

/** The View tab's mannequin: another model of the project under this one, dimmed and out of reach, to fit clothing and armour to. */
function MannequinSection() {
	const cur = work.value.mannequin;
	const loaded = md.mannequin.value;
	const files = project.files.value.filter((f) => project.kinds.value[f] === "3D" && f !== md.path.value);
	const sts = loaded?.doc.states ?? [];
	return (
		<InspectorSection title="Mannequin" hint="another model of the project shown under this one, dimmed and never selected: a body to fit clothing and armour to; kept with the studio, never in the file" tail={cur ? basename(cur.path).replace(/\.fart$/, "") : undefined}>
			<Property label="Model" title="a 3D file of the project; it is drawn where its own coordinates put it">
				<Select value={cur?.path ?? ""} options={[{ value: "", label: "None" }, ...(cur && !files.includes(cur.path) ? [{ value: cur.path, label: `${cur.path} (missing)` }] : []), ...files.map((f) => ({ value: f, label: f.replace(/\.fart$/, "") }))]} onChange={(p) => chooseMannequin(p ? { path: p } : null)} />
			</Property>
			{cur && sts.length > 0 && (
				<Property label="State" title="the state the mannequin stands in">
					<Select value={cur.state && sts.some((x) => x.name === cur.state) ? cur.state : sts[0].name} options={sts.map((x) => x.name)} onChange={(st) => chooseMannequin({ path: cur.path, state: st })} />
				</Property>
			)}
			{!cur && files.length === 0 && <div class="insp-hint flush">No other 3D model in this project</div>}
		</InspectorSection>
	);
}

/** The View tab's own sections: the camera laid on the model, and the overlays. */
export function ModelView() {
	void md.rev.value;
	return (
		<>
			<InspectorSection title="Camera" hint="a turn laid on the model before it is drawn; the light is in view space">
				<div class="insp-wrap">
					<SegmentedControl options={CAMERAS.slice(0, 3)} value={md.viewName.value} onChange={setView} label="Camera" />
					<SegmentedControl options={CAMERAS.slice(3)} value={md.viewName.value} onChange={setView} label="Camera" />
				</div>
				<Property label="Angle" layout="trio">
					{([0, 1, 2] as const).map((ax) => (
						<NumberField
							axis={(["x", "y", "z"] as const)[ax]}
							value={Math.round(md.turn.value[ax] * DEG * 100) / 100}
							step={15}
							suffix="°"
							stepper={false}
							onChange={(v) => {
								const t = [...md.turn.value] as [number, number, number];
								t[ax] = v / DEG;
								setTurn(t);
							}}
						/>
					))}
				</Property>
				<Property label="Shading" title="plain: one flat light, as Project draws it. Clay: a warm key light with a soft edge, a cool fill and a little rim, so rounded forms read as a cel or clay shaded game shows them. It changes the canvas only, never the file">
					<SegmentedControl
						label="Shading"
						options={[
							{ value: "plain", label: "Plain" },
							{ value: "clay", label: "Clay" },
						]}
						value={shading.value}
						onChange={setShading}
					/>
				</Property>
				<Property label="Ambient" title="how much light reaches the faces turned away">
					<NumberField value={md.ambient.value} min={0} max={1} step={0.05} onChange={(v) => (md.ambient.value = Math.max(0, Math.min(1, v)))} />
				</Property>
				<Property label="Depth" title="how deep a new solid is, along the view axis">
					<NumberField value={md.thick.value} min={0.1} step={0.5} onChange={(v) => (md.thick.value = Math.max(0.1, v))} />
				</Property>
			</InspectorSection>
			<InspectorSection title="Overlays">
				<Property label="">
					<Checkbox checked={md.collide.value} label="Collision solids" onChange={() => run("view.collision")} />
				</Property>
				<Property label="">
					<Checkbox checked={md.outline.value} label="Silhouettes" onChange={() => run("model.outline")} />
				</Property>
				<Property label="">
					<Checkbox checked={md.deform.value} disabled={!!curClip()} label="Deform in this state" onChange={() => run("edit.deform")} />
				</Property>
			</InspectorSection>
			<ReferenceSection />
			<MannequinSection />
			<InspectorSection title="Project to 2D" hint="write the 2D views a game draws, beside this file">
				<div class="insp-actions">
					<button type="button" class="ur-btn" onClick={() => run("model.project")}>
						Project…
					</button>
				</div>
			</InspectorSection>
		</>
	);
}

// ------------------------------------------------------------- left

/** which parts are open in the outline, by file and name: it lasts the session and is never saved */
const fold = folding();
const foldKey = (name: string) => `${md.path.value ?? ""}\n${name}`;

/** A shape's kind in the studio's words: a sweep goes by what it does. */
const shapeWord = (sh: Shape3): string => (sh.kind === "sweep" ? sh.op : sh.kind);
/** The tools' own icons where a tool makes the kind: the ball's, the rod's, the pipe's, the prism's for a profile given depth. */
const SHAPE_ICONS: Record<string, IconName> = { mesh: "box", ball: "circle", rod: "slash", pipe: "route", extrude: "pentagon", lathe: "cylinder" };

/** The palette's colours as css, by name; made again only when the palette changes. */
let tokenCss: { of: unknown; css: Map<string, string> } | null = null;
function cssOfTokens(): Map<string, string> {
	const toks = md.tokens.value;
	if (tokenCss?.of !== toks) tokenCss = { of: toks, css: new Map(toks.map((t) => [t.name, cssColor(t.rgb)])) };
	return tokenCss.css;
}

/** Let go of corners, edges, faces and a pipe's point, so Delete means the shapes themselves. */
function wholeShapes() {
	chooseVerts([]);
	chooseEdges([]);
	chooseFaces([]);
	md.pipePt.value = null;
}
/** A shape's row acts as the shape does on the canvas: the same selection, the same commands. */
const shapeActs: ShapeRowActs = {
	pick(part, shape, e) {
		const hit = { part, shape };
		const all = selected();
		// ⇧ or ⌘ adds a shape to what is chosen, or takes it out, as ⇧ does on the canvas
		if ((e.shiftKey || e.metaKey || e.ctrlKey) && all.length) selectShapes(all.some((t) => sameSel(t, hit)) ? all.filter((t) => !sameSel(t, hit)) : [hit, ...all]);
		else selectShapes([hit]);
	},
	menu(part, shape, e) {
		const hit = { part, shape };
		if (!selected().some((t) => sameSel(t, hit))) selectShapes([hit]);
		menuAt(e, [
			{ label: "Duplicate", keys: keysFor("edit.duplicate"), run: () => run("edit.duplicate") },
			{ label: "Mirror across x", run: () => run("model.mirror") },
			{
				label: "Delete",
				keys: "⌫",
				danger: true,
				sep: true,
				run: () => {
					wholeShapes();
					run("edit.delete");
				},
			},
		]);
	},
	remove(part, shape) {
		const hit = { part, shape };
		if (!selected().some((t) => sameSel(t, hit))) selectShapes([hit]);
		wholeShapes();
		run("edit.delete");
	},
};
// a shape chosen anywhere (the canvas, a marquee, a tool): its part's row opens, and its parents', and its own row comes into view
md.sel.subscribe((s) => {
	if (!s) return;
	const ps = parts();
	const seen = new Set<string>();
	for (let p: Part3 | undefined = ps[s.part]; p && !seen.has(p.name); p = ps.find((q) => q.name === p!.parent)) {
		seen.add(p.name);
		const name = p.name;
		const n = p.like ? 0 : (p.shapes ?? []).length;
		const kids = ps.filter((q) => q.parent === name).length;
		if (!fold.peekOpen(foldKey(name), n, kids)) fold.set(foldKey(name), true);
	}
	revealShapeRow();
});

function pickPart(i: number) {
	// the part's own row: the part is what is chosen now, not a shape of it or of another
	if (md.sel.value) selectShapes([]);
	md.curPart.value = i;
	md.partPicked.value = true;
}
function partMenu(i: number): MenuItem[] {
	const ps = parts();
	return [
		{ label: "Rename", keys: "Enter", run: () => (renaming.value = { kind: "part", index: i }) },
		{ label: "Set pivot", run: () => (md.pending.value = "pivot") },
		{ label: "Raise (paints later)", run: () => movePartInState(ps[i].name, true), sep: true },
		{ label: "Lower (paints earlier)", run: () => movePartInState(ps[i].name, false) },
		{ label: "Delete part", keys: "⌫", danger: true, sep: true, disabled: ps.length <= 1, run: () => deletePart(i) },
	];
}
function addPartNow() {
	const i = addPart(freshName("part", parts().map((p) => p.name)));
	renaming.value = { kind: "part", index: i };
}
function childrenOf(name: string | undefined) {
	const ps = parts();
	const names = new Set(ps.map((p) => p.name));
	return ps.map((p, i) => ({ p, i })).filter(({ p }) => (name === undefined ? !p.parent || !names.has(p.parent) : p.parent === name));
}
function PartRow({ i, depth }: { i: number; depth: number }) {
	const p = parts()[i];
	if (!p) return null;
	const st = curState();
	const kids = childrenOf(p.name);
	// a part drawn like another has no shapes of its own; a part of one shape is that shape, and stays a plain row
	const shapes = p.like ? [] : (p.shapes ?? []);
	const can = opens(shapes.length, kids.length);
	const open = can && fold.isOpen(foldKey(p.name), shapes.length, kids.length);
	const member = st ? st.parts.some((sp) => sp.part === p.name) : true;
	const ren = renaming.value;
	const isRen = ren?.kind === "part" && ren.index === i;
	const preview = !!curClip();
	const morphed = morphCount(i) > 0;
	const listed = open && shapes.length > 1;
	const sel = md.sel.value;
	const also = md.also.value;
	const chosen = (k: number) => (sel?.part === i && sel.shape === k) || also.some((t) => t.part === i && t.shape === k);
	// with one of its shapes marked below it, the part's own row is tinted and the shape's wears the selection
	const shapeMarked = listed && shapes.some((_, k) => chosen(k));
	const inactive = sidebar.focus.value !== "nav";
	const labels = listed ? shapeLabels(shapes, (k) => shapeWord(shapes[k])) : [];
	const css = listed ? cssOfTokens() : null;
	return (
		<>
			<SidebarRow
				label={
					isRen ? (
						<InlineName
							value={p.name}
							onCommit={(n) => {
								renamePart(i, n);
								renaming.value = null;
							}}
							onCancel={() => (renaming.value = null)}
						/>
					) : (
						p.name
					)
				}
				icon="layers"
				depth={depth}
				expandable={can}
				open={open}
				onToggle={can ? () => fold.set(foldKey(p.name), !open) : undefined}
				selected={i === md.curPart.value && !shapeMarked}
				current={i === md.curPart.value && shapeMarked}
				inactive={inactive}
				dim={!!st && !member}
				link={p.like || undefined}
				chip={morphed ? "morph" : undefined}
				count={p.like ? undefined : shapes.length}
				title={morphed ? "Reshaped in this state (a morph)" : p.like ? `Drawn like ${p.like}` : shapes.length > 1 ? `${plural(shapes.length, "shape")}${open ? "" : ": open the row to see and choose them"}` : undefined}
				leading={
					st && !preview ? (
						<span class="model-member" title={member ? "Drawn in this state · click to leave it out" : "Not drawn in this state · click to add it"} onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
							<Checkbox checked={member} onChange={() => toggleMembership(md.curState.value, p.name)} />
						</span>
					) : undefined
				}
				onClick={() => pickPart(i)}
				onDoubleClick={() => (renaming.value = { kind: "part", index: i })}
				onContextMenu={(e) => {
					pickPart(i);
					menuAt(e, partMenu(i));
				}}
				onDelete={parts().length > 1 ? () => deletePart(i) : undefined}
			/>
			{listed &&
				shapes.map((sh, k) => (
					<ShapeRow
						key={`s${k}`}
						part={i}
						shape={k}
						depth={depth + 1}
						icon={SHAPE_ICONS[shapeWord(sh)] ?? "box"}
						label={labels[k]}
						token={sh.color}
						color={sh.color ? css!.get(sh.color) : undefined}
						title={`Shape ${k + 1} of ${shapes.length} in ${p.name}, in file order: a ${shapeWord(sh)}${sh.color ? ` filled ${sh.color}${css!.has(sh.color) ? "" : ", a colour the palette does not have"}` : ""} · click chooses it as on the canvas, ⇧ adds`}
						selected={chosen(k)}
						inactive={inactive}
						dim={!!st && !member}
						acts={shapeActs}
					/>
				))}
			{open && kids.map((k) => <PartRow key={k.p.name} i={k.i} depth={depth + 1} />)}
		</>
	);
}

export function ModelSidebar() {
	void md.rev.value;
	const sts = states();
	const cs = clips();
	const curS = md.curState.value;
	const curC = md.curClip.value;
	const ren = renaming.value;
	return (
		<>
			<GroupHeader title="The parts of this model, children under their parents; a part of several shapes opens to them, in file order" addLabel="New part" onAdd={addPartNow}>
				Parts
			</GroupHeader>
			{childrenOf(undefined).map((k) => (
				<PartRow key={k.p.name} i={k.i} depth={0} />
			))}
			<GroupHeader title="Every view is a state: which parts show and where each sits. Shapes are modelled in whichever state you are looking at." addLabel="New state, a copy of this one" onAdd={() => addStateNow()}>
				States
			</GroupHeader>
			{sts.map((s, k) => (
				<SidebarRow
					key={s.name}
					label={
						ren?.kind === "state" && ren.index === k ? (
							<InlineName
								value={s.name}
								onCommit={(n) => {
									renameState(k, n);
									renaming.value = null;
								}}
								onCancel={() => (renaming.value = null)}
							/>
						) : (
							s.name
						)
					}
					icon="circle-dot"
					current={k === curS && curC < 0}
					onClick={() => selectState(k)}
					onDoubleClick={() => (renaming.value = { kind: "state", index: k })}
					onContextMenu={(e) =>
						menuAt(e, [
							{ label: "Rename", keys: "Enter", run: () => (renaming.value = { kind: "state", index: k }) },
							{ label: "Duplicate", run: () => addStateNow(k) },
							{ label: "Delete state", keys: "⌫", danger: true, disabled: sts.length <= 1, sep: true, run: () => deleteState(k) },
						])
					}
					onDelete={sts.length > 1 ? () => deleteState(k) : undefined}
				/>
			))}
			<GroupHeader title="Animation: states in time. A clip is a preview here." addLabel="New clip" onAdd={addClipNow} disabled={sts.length === 0}>
				Clips
			</GroupHeader>
			{cs.map((c, k) => (
				<SidebarRow
					key={c.name}
					label={
						ren?.kind === "clip" && ren.index === k ? (
							<InlineName
								value={c.name}
								onCommit={(n) => {
									renameClip(k, n);
									renaming.value = null;
								}}
								onCancel={() => (renaming.value = null)}
							/>
						) : (
							c.name
						)
					}
					icon="film"
					current={k === curC}
					chip={`${c.keys.length} key${c.keys.length === 1 ? "" : "s"}${c.loop ? " · loop" : ""}`}
					onClick={() => selectClip(k)}
					onDoubleClick={() => (renaming.value = { kind: "clip", index: k })}
					onContextMenu={(e) =>
						menuAt(e, [
							{ label: "Rename", keys: "Enter", run: () => (renaming.value = { kind: "clip", index: k }) },
							{ label: "Delete clip", keys: "⌫", danger: true, sep: true, run: () => deleteClip(k) },
						])
					}
					onDelete={() => deleteClip(k)}
				/>
			))}
		</>
	);
}
function addStateNow(from?: number) {
	const src = states()[from ?? md.curState.value];
	addState(freshName(src ? src.name : "state", states().map((s) => s.name)), from);
	renaming.value = { kind: "state", index: md.curState.value };
}
function addClipNow() {
	if (!addClip(freshName("clip", clips().map((c) => c.name)))) return;
	renaming.value = { kind: "clip", index: md.curClip.value };
}

// ------------------------------------------------------------- fields

const AXES = ["x", "y", "z"] as const;
const r3 = (n: number) => +n.toFixed(3);

/** A number of the file: shown to three places, one undo step once the field is left. */
function N(p: NumberFieldProps) {
	return <NumberField {...p} value={p.value == null ? p.value : r3(p.value)} step={p.step ?? 0.1} onDone={endGesture} />;
}

/** X, Y and Z of one point, on one row. */
function Trio(p: { label: string; title?: string; value: readonly number[]; step?: number; suffix?: string; onAxis: (ax: 0 | 1 | 2, v: number) => void }) {
	return (
		<Property label={p.label} layout="trio" title={p.title}>
			{([0, 1, 2] as const).map((ax) => (
				<N axis={AXES[ax]} value={p.value[ax] ?? 0} step={p.step} suffix={p.suffix} stepper={false} onChange={(v) => p.onAxis(ax, v)} />
			))}
		</Property>
	);
}

/** A name that is typed, then committed with Return or by leaving the field. */
function NameField({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
	const [v, set] = useState(value);
	useEffect(() => set(value), [value]);
	const commit = () => {
		const n = v.trim();
		if (n && n !== value) onCommit(n);
		// a name the file refused falls back to the one it has
		set(value);
	};
	return <TextField value={v} onChange={set} onSubmit={commit} onBlur={commit} />;
}

const hexOf = (rgb: readonly number[]) =>
	`#${rgb
		.slice(0, rgb[3] === 255 || rgb[3] == null ? 3 : 4)
		.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0"))
		.join("")}`;

// ------------------------------------------------------------- bottom: the timeline

export function ModelTimeline() {
	void md.rev.value;
	const clip = curClip();
	const playing = md.playing.value;
	useEffect(() => {
		if (!playing || !clip) return;
		let raf = 0;
		let last = performance.now();
		const tick = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			const dur = clipDuration3(clip);
			let t = md.clipTime.value + dt;
			if (dur <= 0) t = 0;
			else if (t >= dur) {
				if (clip.loop) t = t % dur;
				else {
					t = dur;
					md.playing.value = false;
				}
			}
			md.clipTime.value = t;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [playing, clip]);
	if (!clip) return null;
	const dur = clipDuration3(clip);
	const span = Math.max(dur, 1);
	const t = md.clipTime.value;
	const ki = md.curKey.value;
	const key = clip.keys[ki];
	const ci = md.curClip.value;
	return (
		<div class="model-timeline">
			<Button variant="toolbar" class="ur-btn-sm" icon={playing ? "pause" : "play"} title={playing ? "Pause (Space)" : "Play (Space)"} onClick={() => (md.playing.value = !playing)} />
			<input class="model-scrub" type="range" aria-label="Playhead" min={0} max={span} step={0.001} value={t} onInput={(e) => seek(Number((e.target as HTMLInputElement).value))} onKeyDown={(e) => e.stopPropagation()} />
			<span class="model-time">{t.toFixed(2)}s</span>
			<div class="model-keys">
				<SegmentedControl
					label="Keys"
					options={clip.keys.map((k, i) => ({ value: String(i), label: `${k.t}s`, title: `Key at ${k.t}s${k.state ? `: ${k.state}` : ""}` }))}
					value={key ? String(ki) : null}
					onChange={(v) => {
						const i = Number(v);
						md.curKey.value = i;
						seek(clip.keys[i].t);
					}}
				/>
			</div>
			<Button icon="plus" title="A key at the playhead, naming the current state" onClick={addKey}>
				Key
			</Button>
			<Checkbox checked={!!clip.loop} label="Loop" title="The clip wraps at its last key" onChange={(v) => setClipLoop(ci, v)} />
			{key && (
				<>
					<span class="model-timeline-sep" />
					<N value={key.t} min={0} step={0.05} suffix="s" width={72} stepper={false} label="Key time" title="When this key lands" onChange={(v) => setKeyTime(ki, v)} />
					<Select value={key.state ?? ""} options={states().map((s) => s.name)} width={128} title="The state this key names" onChange={(v) => setKeyState(ki, v)} />
					<Select value={key.ease ?? "linear"} options={EASES} width={92} title="How this key eases into the next" onChange={(v) => setKeyEase(ki, v)} />
					<Button variant="toolbar" class="ur-btn-sm" icon="trash-2" title="Delete key" disabled={clip.keys.length <= 1} onClick={() => deleteKey(ki)} />
				</>
			)}
		</div>
	);
}

// ------------------------------------------------------------- right: the inspector

/** A shape's fill: one of the palette's colours, picked from a list of swatches. */
function TokenPick({ current, onPick, title = "Fill: a colour of the palette", label = "Fill", none }: { current: string | undefined; onPick: (t: string) => void; title?: string; label?: string; none?: { label: string; pick: () => void } }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (!open) return;
		const down = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", down, true);
		return () => document.removeEventListener("mousedown", down, true);
	}, [open]);
	const toks = md.tokens.value;
	const tk = toks.find((t) => t.name === current);
	return (
		<span
			class="ur-anchor model-fill"
			ref={ref}
			onKeyDown={(e) => {
				if (e.key === "Escape" && open) {
					e.stopPropagation();
					setOpen(false);
				}
			}}
		>
			<button type="button" class="model-fill-btn" title={title} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span class={cx("ur-swatch", !tk && !(none && current === undefined) && "model-swatch-missing", none && current === undefined && "model-swatch-none")} style={tk ? { background: cssColor(tk.rgb) } : undefined} />
				<span class="model-fill-name">{current ?? none?.label ?? "None"}</span>
				<Icon name="chevrons-up-down" size={12} />
			</button>
			{open && (
				<div class="ur-popover model-fill-pop" role="listbox" aria-label={label}>
					{toks.length === 0 && <div class="insp-hint flush">No colours yet</div>}
					{none && (
						<ColorRow
							name={none.label}
							color="transparent"
							hex=""
							selected={current === undefined}
							onClick={() => {
								none.pick();
								setOpen(false);
							}}
						/>
					)}
					{toks.map((t) => (
						<ColorRow
							key={t.name}
							name={t.name}
							color={cssColor(t.rgb)}
							hex=""
							selected={t.name === current}
							onClick={() => {
								onPick(t.name);
								setOpen(false);
							}}
						/>
					))}
				</div>
			)}
		</span>
	);
}

const PICKS: { value: Pick3; label: string; title: string }[] = [
	{ value: "corner", label: "Corners", title: "A click on the mesh chooses a corner" },
	{ value: "edge", label: "Edges", title: "A click on the mesh chooses an edge" },
	{ value: "face", label: "Faces", title: "A click on the mesh chooses a face" },
];
/** The numbers of the mesh operation just done: changing one runs it again, in the same undo step. */
function LiveOpFields() {
	const op = liveOp();
	if (!op) return null;
	const p = op.params;
	const title = { extrude: "Extrude", inset: "Inset", loopcut: "Loop cut", merge: "Merge", creaseAngle: "Crease by angle" }[op.kind];
	return (
		<>
			<div class="model-op-head caption-strong">{title}</div>
			{op.kind === "extrude" && (
				<Property label="Amount" title="how far along the normal; negative digs in">
					<N value={p.amount} step={0.1} onChange={(v) => adjustOp({ amount: v })} />
				</Property>
			)}
			{op.kind === "inset" && (
				<>
					<Property label="Amount" title="how far in from the border">
						<N value={p.amount} min={0} step={0.05} onChange={(v) => adjustOp({ amount: Math.max(0, v) })} />
					</Property>
					<Property label="Raise" title="lift the inner faces along their normal; negative sinks them">
						<N value={p.raise ?? 0} step={0.05} onChange={(v) => adjustOp({ raise: v })} />
					</Property>
					<Property label="Border" title="the colour of the border ring: a raised border in another colour is a trim. None leaves the ring the colour of the faces it came from">
						<TokenPick current={op.border} label="Border colour" title="Border colour: a colour of the palette for the ring of faces the inset makes" onPick={(t) => adjustOp({}, { border: t })} none={{ label: "As the faces", pick: () => adjustOp({}, { border: null }) }} />
					</Property>
				</>
			)}
			{op.kind === "loopcut" && (
				<Property label="Place" title="where the new loop crosses the edge: 0 at its first corner, 1 at its second">
					<input class="ed-range" type="range" aria-label="Loop cut place" min={0.02} max={0.98} step={0.01} value={p.at} onInput={(e) => adjustOp({ at: Number((e.target as HTMLInputElement).value) })} />
					<span class="ed-range-val">{p.at.toFixed(2)}</span>
				</Property>
			)}
			{op.kind === "merge" && (
				<Property label="Distance" title="corners this near each other become one, at their middle">
					<N value={p.distance} min={0} step={0.01} onChange={(v) => adjustOp({ distance: Math.max(0, v) })} />
				</Property>
			)}
			{op.kind === "creaseAngle" && (
				<>
					<Property label="Angle" title="every edge whose faces meet at more than this is creased">
						<N value={p.angle} min={0} max={180} step={5} suffix="°" onChange={(v) => adjustOp({ angle: Math.max(0, Math.min(180, v)) })} />
					</Property>
					<Property label="Crease" title="the crease those edges get: 1 sharp, a fraction a fillet">
						<N value={p.value} min={0} max={1} step={0.1} onChange={(v) => adjustOp({ value: Math.max(0, Math.min(1, v)) })} />
					</Property>
				</>
			)}
			<div class={cx("insp-hint flush", op.failed && "model-op-failed")}>{op.note}</div>
		</>
	);
}

/** Editing the selected mesh: what clicks choose, symmetry, and the operations on what is chosen. */
function MeshSection({ sel }: { sel: Sel3 }) {
	const sh = selShape();
	const part = parts()[sel.part];
	if (!sh || sh.kind !== "mesh" || !part) return null;
	const mode = md.pick.value;
	const nf = md.faces.value.length;
	const ne = md.edges.value.length;
	const nv = md.verts.value.length;
	const edge = md.edge.value;
	const count = mode === "face" ? plural(nf, "face") : mode === "edge" ? plural(ne, "edge") : plural(nv, "corner");
	const locked = !!part.like;
	const modMirror = mirrorModOn(sh);
	const brush = paintToken();
	// what the chosen faces wear: one colour's name, or that they differ
	const worn = [...new Set(md.faces.value.map((f) => faceToken(sh, f)))];
	return (
		<InspectorSection title="Mesh" hint="reshape the mesh: choose corners, edges or faces on the canvas (Shift adds), then extrude, inset, cut, bridge, fill" tail={`${count} chosen`}>
			<Property label="Choose" title="what a click on the mesh chooses; Shift adds one or takes it out, ⌘A chooses all, a drag moves what is chosen along the view plane">
				<SegmentedControl label="Choose" options={PICKS} value={mode} onChange={setPick} />
			</Property>
			<Property label="Symmetry" title="while on, every edit to this mesh is done to its mirror across x too, and points on the plane stay on it. A working aid: the file holds plain geometry">
				<Checkbox checked={mirrorOn(part.name, sel.shape) && !modMirror} disabled={modMirror} label="Mirror across x" onChange={(v) => setMirror(part.name, sel.shape, v)} />
			</Property>
			{modMirror && <div class="insp-hint flush">Its Mirror modifier across x does this in the file already: edit the half that is there, the other follows</div>}
			{locked && <div class="insp-hint flush">This part is drawn like {part.like}: edit that one</div>}
			{mode === "face" && (
				<div class="insp-actions">
					<Button disabled={!nf} title="Extrude the chosen faces along their normal (E): on the canvas the pointer says how far" onClick={() => run("mesh.extrude")}>
						Extrude
					</Button>
					<Button disabled={!nf} title="Inset the chosen faces (I): a border ring of quads, the inner faces kept" onClick={() => run("mesh.inset")}>
						Inset
					</Button>
					<Button disabled={!nf} title="Turn the chosen faces to wind the other way" onClick={() => run("mesh.flip")}>
						Flip
					</Button>
					<Button variant="danger" disabled={!nf} title="Delete the chosen faces (⌫); the hole they leave has a rim" onClick={() => run("edit.delete")}>
						Delete
					</Button>
				</div>
			)}
			{mode === "face" && (
				<>
					<Property label="Colour" title="the colour faces are painted with (1.8): a face may wear another colour of the palette than the shape's fill">
						<TokenPick current={brush} label="Paint colour" title="Paint colour: the colour of the palette faces are painted with" onPick={(t) => (md.paintTok.value = t)} />
					</Property>
					<div class="insp-actions">
						<Button icon="paintbrush" disabled={!nf} title={nf ? `Paint the ${plural(nf, "chosen face")} ${brush}${worn.length === 1 ? ` (now ${worn[0] ?? "the fill"})` : ""}` : "Choose faces first, then paint them this colour"} onClick={() => run("mesh.paintChosen")}>
							Paint
						</Button>
						<Button active={md.painting.value} title="Paint by brush (B): while on, a click or a drag over the mesh paints the faces under the pointer; B or Esc stops" onClick={() => run("mesh.paint")}>
							Brush
						</Button>
					</div>
				</>
			)}
			{mode === "edge" && (
				<div class="insp-actions">
					<Button disabled={!ne} title="Loop cut (K): a new edge loop across the ring of four-sided faces the chosen edge belongs to" onClick={() => run("mesh.loopCut")}>
						Loop cut
					</Button>
					<Button disabled={!ne} title="Extrude the chosen open edges outward (E): each grows a quad" onClick={() => run("mesh.extrude")}>
						Extrude
					</Button>
					<Button disabled={!ne} title="Choose the whole rim the chosen edge is on: the loop of open edges around a hole" onClick={() => run("mesh.rim")}>
						Rim
					</Button>
					<Button disabled={ne < 2} title="Bridge two rims of the same count with a band of quads: choose an edge on each" onClick={() => run("mesh.bridge")}>
						Bridge
					</Button>
					<Button disabled={!ne} title="Fill the rim the chosen edge is on with one face" onClick={() => run("mesh.fill")}>
						Fill
					</Button>
				</div>
			)}
			{ne > 0 && edge && (
				<Property label="Crease" title={`the crease of ${ne === 1 ? `edge ${edge[0]}–${edge[1]}` : `the ${ne} chosen edges`} (1.7): 0 smooth to 1 sharp; a fraction is a fillet that rounds off after a few levels`}>
					<N value={creaseOf(sh, edge[0], edge[1])} min={0} max={1} step={0.1} suffix={ne === 1 ? `${edge[0]}–${edge[1]}` : `${ne} edges`} onChange={(v) => setCreaseSel(sel, v)} />
				</Property>
			)}
			<div class="insp-actions">
				<Button title={nv > 1 && mode === "corner" ? "Merge the chosen corners that lie within a distance of each other (M)" : "Merge every pair of corners that lie within a distance of each other (M)"} onClick={() => run("mesh.merge")}>
					Merge
				</Button>
				<Button title="Crease every edge sharper than an angle, the others keeping what they have" onClick={() => run("mesh.creaseAngle")}>
					Crease by angle
				</Button>
				<Button title="Turn every face of the mesh to wind outward: neighbours made to agree, each piece turned so its volume is positive" onClick={() => run("mesh.wind")}>
					Wind outward
				</Button>
			</div>
			<Property label="Shades" title="a shade per corner (1.8): how much of the sky each corner sees past the model's own geometry, so folds and insides sit darker. Strength is how dark a wholly hidden corner gets">
				<NumberField value={md.shadeStrength.value} min={0} max={1} step={0.1} suffix="strength" label="Shade strength" onChange={(v) => (md.shadeStrength.value = Math.max(0, Math.min(1, v)))} />
			</Property>
			<div class="insp-actions">
				<Button title="Shade corners: work out a shade for every corner of this mesh from the model as it stands in this state, and write it into the file" onClick={() => run("mesh.shade")}>
					Shade corners
				</Button>
				<Button disabled={!sh.shades} title="Take this mesh's shades away" onClick={() => run("mesh.clearShades")}>
					Clear
				</Button>
			</div>
			{sh.shades && <div class="insp-hint flush">{`Shaded: the darkest corner at ${Math.min(...sh.shades)}`}</div>}
			<LiveOpFields />
		</InspectorSection>
	);
}

const MOD_NAMES: Record<string, string> = { mirror: "Mirror", solidify: "Solidify", crease: "Crease" };

/** One modifier of the stack: its fields, and moving, applying and removing it. */
function ModRow({ sel, i, mod, count }: { sel: Sel3; i: number; mod: Mod; count: number }) {
	const sh = selShape();
	if (!sh) return null;
	const name = MOD_NAMES[mod.op] ?? mod.op;
	const apply = () => {
		try {
			logActivity(applyMod(sel, i), "check");
		} catch (e) {
			project.error.value = e instanceof Error ? e.message : String(e);
		}
	};
	return (
		<div class="model-mod" data-mod={mod.op}>
			<div class="model-mod-head">
				<span class="caption-strong model-grow">
					{i + 1} · {name}
				</span>
				<Button variant="toolbar" class="ur-btn-sm" icon="arrow-up" disabled={i === 0} title={`Move ${name} earlier: modifiers are applied in order`} onClick={() => moveMod(sel, i, false)} />
				<Button variant="toolbar" class="ur-btn-sm" icon="arrow-down" disabled={i === count - 1} title={`Move ${name} later`} onClick={() => moveMod(sel, i, true)} />
				<Button title={i === 0 ? `Apply ${name}: bake it into the mesh's own geometry, with its paint, creases and morphs${sh.kind === "sweep" ? "; the sweep becomes a mesh" : ""}` : `Apply the modifiers down to ${name} (the ones above it are applied on the way)`} onClick={apply}>
					Apply
				</Button>
				<Button variant="toolbar" class="ur-btn-sm" icon="trash-2" title={`Remove ${name}`} onClick={() => removeMod(sel, i)} />
			</div>
			{mod.op === "mirror" && (
				<>
					<Property label="Axis" title="the plane is where this coordinate is 0 in the shape's own space">
						<SegmentedControl
							label="Mirror axis"
							options={[
								{ value: "x", label: "X" },
								{ value: "y", label: "Y" },
								{ value: "z", label: "Z" },
							]}
							value={String(mod.axis ?? "x")}
							onChange={(v) => setModField(sel, i, "axis", v)}
						/>
					</Property>
					<Property label="Merge" title="a corner this near the plane is welded onto it: one point, not two">
						<N value={mod.merge ?? 0.001} min={0} step={0.001} onChange={(v) => setModField(sel, i, "merge", Math.max(0, v))} />
					</Property>
				</>
			)}
			{mod.op === "solidify" && (
				<>
					<Property label="Thick" title="how deep the wall is">
						<N value={mod.thick ?? 0} step={0.05} onChange={(v) => setModField(sel, i, "thick", v)} />
					</Property>
					<Property label="Offset" title="−1: the cage is the outside and the wall grows inward; 1: the cage is the inside; 0: it is the middle">
						<N value={mod.offset ?? -1} min={-1} max={1} step={0.5} onChange={(v) => setModField(sel, i, "offset", Math.max(-1, Math.min(1, v)))} />
					</Property>
					<Property label="Inner" title="the colour of the inner faces; None leaves each the colour of the face it backs">
						<TokenPick current={modToken(sh, mod, "inner")} label="Inner colour" title="Inner colour: a colour of the palette for the inside of the wall" onPick={(t) => setModField(sel, i, "inner", t)} none={{ label: "As the outside", pick: () => setModField(sel, i, "inner", undefined) }} />
					</Property>
					<Property label="Rim" title="the colour of the rim, where the wall shows its thickness; None leaves each quad the colour of the face its edge belongs to">
						<TokenPick current={modToken(sh, mod, "rim")} label="Rim colour" title="Rim colour: a colour of the palette for the rim of the wall" onPick={(t) => setModField(sel, i, "rim", t)} none={{ label: "As the outside", pick: () => setModField(sel, i, "rim", undefined) }} />
					</Property>
				</>
			)}
			{mod.op === "crease" && (
				<>
					<Property label="Angle" title="every edge whose faces stand more than this apart gets the crease, unless it has one already">
						<N value={mod.angle ?? 30} min={0} max={180} step={5} suffix="°" onChange={(v) => setModField(sel, i, "angle", Math.max(0, Math.min(180, v)))} />
					</Property>
					<Property label="Crease" title="the crease those edges get: 1 sharp, a fraction a fillet once the mesh is smooth">
						<N value={mod.value ?? 1} min={0} max={1} step={0.1} onChange={(v) => setModField(sel, i, "value", Math.max(0, Math.min(1, v)))} />
					</Property>
				</>
			)}
			{!(mod.op in MOD_NAMES) && <div class="insp-hint flush">A modifier Uranus does not know: it is kept as it is</div>}
		</div>
	);
}

/** The modifiers of a mesh or a sweep (1.8): operations the file keeps and every reader applies to the cage, in order. */
function ModifiersSection({ sel }: { sel: Sel3 }) {
	const sh = selShape();
	if (!sh || (sh.kind !== "mesh" && sh.kind !== "sweep")) return null;
	const mods = modsOf(sh);
	return (
		<InspectorSection title="Modifiers" hint="operations kept in the file and applied to the cage every time it is drawn, in order (1.8): the cage stays what you edit, half a helm with no thickness" tail={mods.length ? String(mods.length) : undefined}>
			{mods.length === 0 && <div class="insp-hint flush">None: the shape is drawn as it is</div>}
			{mods.map((m, i) => (
				<ModRow key={`${i}-${m.op}`} sel={sel} i={i} mod={m} count={mods.length} />
			))}
			<Property label="Add" title="add a modifier at the end of the list: Mirror reflects the cage through a plane and welds the seam, Solidify gives a surface a wall, Crease marks every edge sharper than an angle">
				<Select
					value=""
					options={[
						{ value: "", label: "Add a modifier…" },
						{ value: "mirror", label: "Mirror" },
						{ value: "solidify", label: "Solidify" },
						{ value: "crease", label: "Crease" },
					]}
					onChange={(v) => {
						if (v) addMod(sel, v as ModOp);
					}}
				/>
			</Property>
			{mods.length > 0 && sh.kind === "mesh" && <div class="insp-hint flush">The dashed wire is the cage: corners, edges and faces are chosen and edited there, and the surface follows</div>}
		</InspectorSection>
	);
}

/** A pipe's own fields (1.8): the section, the path's points, and where its points land. */
function PipeFields({ sel }: { sel: Sel3 }) {
	const sh = selShape();
	if (!isPipe(sh)) return null;
	const pts = sh.path?.points ?? [];
	const i = md.pipePt.value;
	const at = i !== null ? pts[i] : undefined;
	const rounded = !!(sh.path?.in || sh.path?.out);
	return (
		<>
			<Property label="Sweep" title="a pipe (1.8): a section carried along a path in space, kept as the path">
				<span class="ur-prop-val">Pipe · {plural(pts.length, "point")}</span>
			</Property>
			<Property label="Radius" title="the pipe's radius; each point may scale it">
				<N value={sh.radius ?? 1} min={0.001} step={0.05} onChange={(v) => setPipeField(sel, "radius", v)} />
			</Property>
			<Property label="Segments" title="how many sides the section has">
				<N value={sh.segments ?? 8} min={3} step={1} onChange={(v) => setPipeField(sel, "segments", Math.max(3, Math.round(v)))} />
			</Property>
			<Property label="">
				<Checkbox checked={sh.caps !== false} disabled={!!sh.closed} label="Caps" title="close the ends of an open pipe" onChange={(v) => setPipeField(sel, "caps", v)} />
			</Property>
			<Property label="">
				<Checkbox checked={!!sh.closed} disabled={pts.length < 3} label="Closed" title="join the last point to the first: a ring" onChange={(v) => setPipeField(sel, "closed", v)} />
			</Property>
			<Property label="">
				<Checkbox checked={rounded} disabled={pts.length < 3} label="Round the path" title="curve the path through its points; off, it runs straight from point to point. The handles are written for you and follow the points" onChange={(v) => setPipeRound(sel, v)} />
			</Property>
			<Property label="Symmetry" title="keep a mirrored twin of this pipe across x: moving a point of one moves the other. A working aid: the file holds two pipes">
				<Checkbox checked={!!pipeTwin(sel)} label="Mirror across x" onChange={(v) => setPipeSymmetry(sel, v)} />
			</Property>
			<Property label="" title="while on, a dragged point stays on the mesh under the pointer, lifted along its normal">
				<Checkbox checked={md.onSurface.value} label="On surface" onChange={() => run("model.onSurface")} />
			</Property>
			{md.onSurface.value && (
				<Property label="Lift" title="how far off the surface a point sits, along its normal">
					<NumberField value={md.lift.value} min={0} step={0.05} onChange={(v) => (md.lift.value = Math.max(0, v))} />
				</Property>
			)}
			{i !== null && at ? (
				<>
					<Trio
						label={`Point ${i}`}
						value={at}
						onAxis={(ax, v) => {
							const p = [...at] as Vec3;
							p[ax] = v;
							setPipePoint(sel, i, p, `pipe-point-${i}-${ax}`);
						}}
					/>
					<Property label="Radius here" title="this point's share of the pipe's radius: 1 is the radius itself, 0 an apex">
						<N value={sh.radii?.[i] ?? 1} min={0} step={0.1} onChange={(v) => setPipeRadiusAt(sel, i, v)} />
					</Property>
				</>
			) : (
				<div class="insp-hint flush">Click a point of the path to move it or to set its radius</div>
			)}
		</>
	);
}

export function Inspector3() {
	void md.rev.value;
	const p = curPart();
	const i = md.curPart.value;
	const sp = poseOfCur();
	const sel = md.sel.value;
	const sh = selShape();
	// the corners as this state has them: a morph shows and edits its own points
	const shp = selShapePosed() ?? sh;
	const vert = md.vert.value;
	const preview = !!curClip();
	const [picking, setPicking] = useState<{ i: number; x: number; y: number } | null>(null);
	const [tok, setTok] = useState<number | null>(null);
	const ren = renaming.value;
	// a part chosen on purpose (a row, a hit) shows; an empty click on the canvas lets go of it
	const picked = md.partPicked.value || !!(sh && sel);
	const st = curState();
	const texs = textures();
	const pal = palette();
	const morphs = p ? morphCount(i) : 0;
	const removeToken = (k: number) => {
		deleteToken(k);
		setTok(null);
		setPicking(null);
	};
	return (
		<div class="inspector">
			{sh && sel && (
				<InspectorSection title="Shape" hint="what is selected on the canvas" tail={sh.kind}>
					<Property label="Fill">
						<TokenPick current={sh.color} onPick={paintSel} />
					</Property>
					<Property label="Shade" title="lighting on the slot's colour, on top of the view's light">
						<N value={sh.shade ?? 1} min={0} onChange={(v) => setShapeNumber(sel, "shade", v)} />
					</Property>
					{texs.length > 0 && (
						<Property label="Texture" title="a texture of the file, box mapped over the shape's faces">
							<Select value={sh.texture ?? ""} options={[{ value: "", label: "None" }, ...texs.map((t) => ({ value: t.name, label: t.name }))]} onChange={setSelTexture} />
						</Property>
					)}
					{sh.texture && (
						<Property label="Size" title="world units per pattern unit: 2 makes the pattern twice as big">
							<N value={sh.mapping?.scale ?? 1} min={0.01} step={0.25} onChange={setSelMappingScale} />
							{sh.mapping?.uvs && <Chip title="explicit pattern coordinates per corner, from the file">uvs</Chip>}
						</Property>
					)}
					{sh.texture && sh.kind === "mesh" && (
						<Property label="Sheet" title="Unwrap: the texture becomes a sheet. Every mesh that wears it has its faces laid flat as islands, packed into the cell (explicit uvs)">
							<Button onClick={unwrapSel}>Unwrap</Button>
							{sh.mapping?.uvs && (
								<Button title="Drop the explicit uvs and box map again" onClick={boxMapSel}>
									Box map
								</Button>
							)}
						</Property>
					)}
					{sh.kind === "ball" && (
						<>
							<Trio label="Centre" value={sh.at} onAxis={(ax, v) => setShapeCoord(sel, "at", ax, v)} />
							<Property label="Radius">
								<N value={sh.r} min={0} onChange={(v) => setShapeNumber(sel, "r", v)} />
							</Property>
						</>
					)}
					{sh.kind === "rod" && (
						<>
							<Trio label="From" value={sh.a} onAxis={(ax, v) => setShapeCoord(sel, "a", ax, v)} />
							<Trio label="To" value={sh.b} onAxis={(ax, v) => setShapeCoord(sel, "b", ax, v)} />
							<Property label="Width">
								<N value={sh.w} min={0} onChange={(v) => setShapeNumber(sel, "w", v)} />
							</Property>
						</>
					)}
					{sh.kind === "mesh" && (
						<Property label="Corners" title="drag a corner on the canvas along the view plane; the fields move it on any axis">
							<span class="ur-prop-val">
								{sh.points.length} · {sh.faces.length} faces{sh.colors?.length ? ` · ${plural(sh.colors.length + 1, "colour")}` : ""}
							</span>
						</Property>
					)}
					{(sh.kind === "mesh" || sh.kind === "sweep") && (
						<>
							<Property label="Normals" title="how the surface is lit (1.7): flat keeps one normal per face; smooth averages them up to sharp edges, and is the default once subdivided">
								<Select
									value={sh.normals ?? ""}
									options={[
										{ value: "", label: (sh.smooth ?? 0) > 0 ? "Smooth (default)" : "Flat (default)" },
										{ value: "flat", label: "Flat" },
										{ value: "smooth", label: "Smooth" },
									]}
									onChange={(v) => setSmoothField(sel, "normals", v)}
								/>
							</Property>
							<Property label="Angle" title="faces meeting at more than this keep their own normals; 0 for no limit">
								<N value={sh.angle ?? 0} min={0} max={180} step={5} suffix="°" onChange={(v) => setSmoothField(sel, "angle", v)} />
							</Property>
							<Property label="Smooth" title="Catmull-Clark levels (1.7): the cage stays the file, the surface is drawn; keep it at 1 or 2">
								<N value={sh.smooth ?? 0} min={0} max={4} step={1} suffix="levels" onChange={(v) => setSmoothField(sel, "smooth", Math.max(0, Math.round(v)))} />
							</Property>
						</>
					)}
					{sh.kind === "sweep" && sh.op === "pipe" && <PipeFields sel={sel} />}
					{sh.kind === "sweep" && sh.op !== "pipe" && (
						<>
							<Property label="Sweep" layout="pair" title="a solid generated from a profile (1.7): a lathe revolves [radius, along] pairs about the axis, an extrude runs the closed outline along it">
								<Select
									value={sh.op as "lathe" | "extrude"}
									options={[
										{ value: "lathe", label: "Lathe" },
										{ value: "extrude", label: "Extrude" },
									]}
									onChange={(v) => setSweepField(sel, "op", v)}
								/>
								<Select
									value={sh.axis ?? "y"}
									title="The axis it sweeps about or along"
									options={[
										{ value: "x", label: "X" },
										{ value: "y", label: "Y" },
										{ value: "z", label: "Z" },
									]}
									onChange={(v) => setSweepField(sel, "axis", v)}
								/>
							</Property>
							{sh.op === "lathe" ? (
								<Property label="Segments">
									<N value={sh.segments ?? 12} min={3} step={1} onChange={(v) => setSweepField(sel, "segments", Math.max(3, Math.round(v)))} />
								</Property>
							) : (
								<>
									<Property label="From">
										<N value={sh.from ?? 0} onChange={(v) => setSweepField(sel, "from", v)} />
									</Property>
									<Property label="To">
										<N value={sh.to ?? 1} onChange={(v) => setSweepField(sel, "to", v)} />
									</Property>
								</>
							)}
							<Property label="Profile" title="edit it in the file or a generator">
								<span class="ur-prop-val">
									{sh.profile?.points.length ?? 0} points{sh.profile?.in || sh.profile?.out ? " · curved" : ""} · edit it in the file
								</span>
							</Property>
						</>
					)}
					{sh.kind === "mesh" && vert !== null && sh.points[vert] && <Trio label={`Corner ${vert}`} value={shp && shp.kind === "mesh" && shp.points[vert] ? shp.points[vert] : sh.points[vert]} onAxis={(ax, v) => setVertexAxis(sel, vert, ax, v)} />}
					<div class="insp-actions">
						<Button title="A copy reflected across x = 0" onClick={() => run("model.mirror")}>
							Mirror
						</Button>
						<Button title="Duplicate (⌘D)" onClick={() => run("edit.duplicate")}>
							Duplicate
						</Button>
						<Button variant="danger" title={md.pipePt.value !== null && isPipe(sh) ? "Take the chosen point out of the path (⌫)" : "Delete (⌫)"} onClick={deleteSel}>
							{vert !== null && sh.kind === "mesh" ? "Delete corner" : md.pipePt.value !== null && isPipe(sh) ? "Delete point" : "Delete"}
						</Button>
					</div>
				</InspectorSection>
			)}
			{sh && sel && sh.kind === "mesh" && !preview && !md.also.value.length && <MeshSection sel={sel} />}
			{sh && sel && (sh.kind === "mesh" || sh.kind === "sweep") && !preview && !md.also.value.length && <ModifiersSection sel={sel} />}
			{p && picked && (
				<InspectorSection title="Part" hint="a part: the unit that poses" tail={p.name}>
					<Property label="Name">
						{ren?.kind === "part" && ren.index === i ? <span class="ur-prop-val">{p.name}</span> : <NameField value={p.name} onCommit={(n) => renamePart(i, n)} />}
					</Property>
					<Trio label="Pivot" title="the point the part turns about" value={p.pivot ?? [0, 0, 0]} onAxis={(ax, v) => setPivotAxis(i, ax, v)} />
					<Property label="Parent">
						<Select value={p.parent ?? ""} options={[{ value: "", label: "None" }, ...parentCandidates(i).map((n) => ({ value: n, label: n }))]} onChange={(v) => setParent(i, v)} />
					</Property>
					<Property label="Drawn like" title="drawn like another part: its shapes, this part's pivot and pose">
						<Select
							value={p.like ?? ""}
							options={[
								{ value: "", label: "Itself" },
								...parts()
									.filter((q) => q !== p && !q.like)
									.map((q) => ({ value: q.name, label: q.name })),
							]}
							onChange={(v) => setLike(i, v)}
						/>
					</Property>
					<div class="insp-actions">
						<Button icon="crosshair" active={md.pending.value === "pivot"} title="Click the canvas to place the pivot" onClick={() => (md.pending.value = "pivot")}>
							Set pivot
						</Button>
					</div>
				</InspectorSection>
			)}
			{p && picked && sp && !preview && (
				<InspectorSection title="Pose" hint="where the part's pivot lands, its turn about x, y and z (degrees), its size" tail={st?.name ?? "state"}>
					{morphs > 0 && (
						<Property label="Morph" title="a morph: this state reshapes the part's meshes; clips lerp the corners between states">
							<span class="ur-prop-val model-grow">
								{morphs} mesh{morphs === 1 ? "" : "es"} reshaped
							</span>
							<Button title="Draw the base mesh in this state again" onClick={() => resetMorph(i)}>
								Reset
							</Button>
						</Property>
					)}
					{md.deform.value && morphs === 0 && <div class="insp-hint flush">Deform is on · drag a corner to reshape the part in this state</div>}
					<Trio
						label="Position"
						value={sp.offset ?? p.pivot ?? [0, 0, 0]}
						onAxis={(ax, v) => {
							const o = [...(sp.offset ?? p.pivot ?? [0, 0, 0])] as [number, number, number];
							o[ax] = v;
							setPose(sp, { offset: o }, `pose-${AXES[ax]}`);
						}}
					/>
					<Trio
						label="Rotation"
						step={5}
						suffix="°"
						value={([0, 1, 2] as const).map((ax) => ((sp.rotate ?? [0, 0, 0])[ax] ?? 0) * DEG)}
						onAxis={(ax, v) => {
							const r = [...(sp.rotate ?? [0, 0, 0])] as [number, number, number];
							r[ax] = v / DEG;
							setPose(sp, { rotate: r }, `pose-rot-${ax}`);
						}}
					/>
					<Property label="Scale">
						<N value={sp.scale ?? 1} min={0} step={0.05} onChange={(v) => setPose(sp, { scale: v }, "pose-size")} />
					</Property>
					<Property label="">
						<Checkbox checked={!!sp.mirror} label="Mirror" title="flipped across x about the pivot, before the turn" onChange={(v) => setPose(sp, { mirror: v })} />
					</Property>
					<div class="insp-actions">
						<Button onClick={() => resetPose(sp)}>Reset</Button>
						<Button onClick={() => toggleMembership(md.curState.value, p.name)}>Leave out of this state</Button>
					</div>
				</InspectorSection>
			)}
			{p && picked && !sp && !preview && st && (
				<InspectorSection title="Pose" tail={st.name}>
					<div class="insp-hint flush">Not drawn in this state</div>
					<div class="insp-actions">
						<Button onClick={() => toggleMembership(md.curState.value, p.name)}>Add to this state</Button>
					</div>
				</InspectorSection>
			)}
			{p && picked && (
				<InspectorSection title="Collision" hint="a convex hull of this part's shapes into the file's collision, riding the part">
					<div class="insp-hint flush">A convex hull of this part's shapes · run it again to replace it</div>
					<div class="insp-actions">
						<Button
							icon="shield"
							title="A convex hull of this part's shapes into the file's collision, riding the part; run again to replace it (fart hull does the same)"
							onClick={() => {
								if (hullOfPart(i)) md.collide.value = true;
								else project.error.value = `${p.name} has no volume to hull`;
							}}
						>
							Make hull
						</Button>
					</div>
				</InspectorSection>
			)}
			{!picked && (
				<>
					<InspectorSection title="Document">
						<Property label="Name">
							<TextField value={md.doc.value.name ?? ""} onChange={setDocName} onBlur={() => endGesture()} />
						</Property>
					</InspectorSection>
					<TexturesPanel
						api={{
							textures: texs,
							rel: md.path.value ?? "",
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
						hint="the file's colour slots: a shape names a slot"
						actions={
							<>
								{tok !== null && pal[tok] && (
									<button type="button" title="Delete colour (⌫)" aria-label="Delete colour" onClick={() => removeToken(tok)}>
										<Icon name="trash-2" size={14} />
									</button>
								)}
								<button type="button" title="New colour" aria-label="New colour" onClick={() => addToken(freshName("colour", md.tokens.value.map((t) => t.name)))}>
									<Icon name="plus" size={14} />
								</button>
							</>
						}
					>
						{pal.length === 0 && <div class="insp-hint flush">No colours yet</div>}
						{pal.map((t, k) => (
							<ColorRow
								key={k}
								name={ren?.kind === "token" && ren.index === k ? <InlineName value={t.name} onCommit={(n) => (renameToken(k, n), (renaming.value = null))} onCancel={() => (renaming.value = null)} /> : t.name}
								color={cssColor(t.rgb)}
								hex={hexOf(t.rgb)}
								selected={tok === k}
								title="Click the swatch to edit the colour · double-click to rename"
								onClick={() => setTok(k)}
								onDoubleClick={() => (renaming.value = { kind: "token", index: k })}
								onSwatch={(e) => (setTok(k), setPicking({ i: k, x: e.clientX, y: e.clientY }))}
								onContextMenu={(e) => (
									setTok(k),
									menuAt(e, [
										{ label: "Rename", run: () => (renaming.value = { kind: "token", index: k }) },
										{ label: "Delete colour", keys: "⌫", danger: true, sep: true, run: () => removeToken(k) },
									])
								)}
								onDelete={() => removeToken(k)}
							/>
						))}
						{md.shared.value.length > 0 && (
							<Property label="Shared" title="colours this file takes from the palettes it names">
								<span class="ur-prop-val" title={md.shared.value.map((t) => t.name).join(", ")}>
									{md.shared.value.map((t) => t.name).join(", ")}
								</span>
							</Property>
						)}
					</InspectorSection>
				</>
			)}
			{picking && pal[picking.i] && <ColorPicker rgb={pal[picking.i].rgb} x={picking.x} y={picking.y} onChange={(rgb) => setTokenColor(picking.i, rgb)} onClose={() => setPicking(null)} />}
		</div>
	);
}

// ------------------------------------------------------------- the canvas

export function ModelCanvasView() {
	void md.rev.value;
	const issues = md.issues.value;
	return (
		<>
			<ModelCanvas />
			{issues.length > 0 && showIssues.value && (
				<div class="issues">
					{issues.slice(0, 8).map((i) => (
						<div class={["unknown", "reserved", "unresolved"].includes(i.code) ? "w" : "e"}>
							{i.code} {i.path}: {i.message}
						</div>
					))}
				</div>
			)}
		</>
	);
}

const PROJECT_VIEWS = ["front", "back", "left", "right", "top", "bottom"].filter((v) => v in VIEWS);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

async function writeViews(views: string[], outline: { color: string; w: number } | undefined) {
	try {
		const files = await busy("Projecting to 2D", () => projectViews(views, outline));
		if (files.length) logActivity(`Wrote ${files.map((f) => basename(f)).join(", ")}`, "download");
	} catch (e) {
		project.error.value = String(e).replace(/^Error: /, "");
	}
}

/** Which views to write, and the outline they are inked with. */
function ProjectSheet() {
	const names = md.tokens.value.map((t) => t.name);
	// a file with no colours yet still gets its ink: the projection adds the slot
	const colours = names.length ? names : ["ink"];
	const [views, setViews] = useState<Set<string>>(() => new Set(["left", "top"]));
	const [outline, setOutline] = useState(false);
	const [colour, setColour] = useState(() => colours.find((n) => n === "ink") ?? colours.find((n) => n === "outline") ?? colours[colours.length - 1]);
	const [width, setWidth] = useState(0.25);
	const stem = basename(md.path.value ?? "").replace(/\.fart$/, "");
	const chosen = PROJECT_VIEWS.filter((v) => views.has(v));
	const go = () => {
		closeSheet();
		void writeViews(chosen, outline ? { color: colour, w: width > 0 ? width : 0.25 } : undefined);
	};
	return (
		<Sheet
			title="Project to 2D"
			message="Write the 2D views a game draws, beside this file."
			onClose={closeSheet}
			footnote={chosen.length ? `${chosen.map((v) => `${stem}-${v}.fart`).join(", ")}` : "Tick at least one view."}
			actions={[
				{ label: "Cancel", onClick: closeSheet },
				{ label: "Project", primary: true, disabled: chosen.length === 0, onClick: go },
			]}
		>
			<div class="ur-tf-wrap">
				<span class="ur-tf-label">Views</span>
				<div class="model-views">
					{PROJECT_VIEWS.map((v) => (
						<Checkbox
							key={v}
							checked={views.has(v)}
							label={cap(v)}
							onChange={(on) => {
								const n = new Set(views);
								if (on) n.add(v);
								else n.delete(v);
								setViews(n);
							}}
						/>
					))}
				</div>
			</div>
			<div class="model-outline">
				<Checkbox checked={outline} label="Outline" title="Ink each view's silhouette in a colour of the palette" onChange={setOutline} />
				<Select value={colour} options={colours} disabled={!outline} title="The colour the outline is drawn in" onChange={setColour} />
				<NumberField value={width} min={0.01} step={0.05} suffix="wide" width={96} disabled={!outline} label="Outline width" title="How wide the outline is" onChange={setWidth} />
			</div>
		</Sheet>
	);
}

/** Project…: which views, then write them beside the model. */
export function askProject() {
	openSheet(() => <ProjectSheet />);
}
void ((_: StatePart3) => _);
