// The textures of a file (1.5): each a name, a cell, and its maps, every
// map a drawing of the project. The same panel serves the 2D inspector
// and the model screen; the store's edits come in as props.

import { useState } from "preact/hooks";
import type { Texture, TextureMap } from "@fastart/core";
import { InlineName } from "./Rename.tsx";
import { project, openDoc, paletteFiles } from "../state/project.ts";
import { dirname, joinRel, stripExt, basename } from "../state/paths.ts";
import { menuAt } from "../state/menu.ts";
import { endGesture } from "../state/editor.ts";
import { Button, Icon, InspectorSection, NumberField, Property, SegmentedControl, Select, TextField } from "./ur.tsx";

export interface TexturesApi {
	textures: Texture[];
	/** the open file's project path, for refs */
	rel: string;
	add: (name: string, ref: string) => number;
	remove: (i: number) => void;
	rename: (i: number, name: string) => void;
	cell: (i: number, axis: 0 | 1, v: number) => void;
	/** 1.10: the height map's size, in pattern units */
	relief: (i: number, v: number) => void;
	map: (i: number, map: string, patch: Partial<TextureMap>) => void;
	addMap: (i: number, map: string) => void;
	removeMap: (i: number, map: string) => void;
	freshName: (base: string, taken: Iterable<string>) => string;
}

/** 2D art files of the project, as refs relative to the open file. */
function drawingRefs(rel: string): { ref: string; label: string }[] {
	const dir = dirname(rel);
	const out: { ref: string; label: string }[] = [];
	for (const file of project.files.value) {
		if (file === rel || project.kinds.value[file] !== "2D") continue;
		out.push({ ref: relTo(dir, file), label: stripExt(file) });
	}
	return out.sort((a, b) => a.label.localeCompare(b.label));
}
function relTo(fromDir: string, file: string): string {
	const a = fromDir ? fromDir.split("/") : [];
	const b = file.split("/");
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

/** ⌫ on a focused heading takes the thing out; Return renames it. */
const headKeys = (rename: (() => void) | null, remove: (() => void) | null) => (e: KeyboardEvent) => {
	if (e.target !== e.currentTarget) return;
	if (e.key === "Enter" && rename) rename();
	else if ((e.key === "Backspace" || e.key === "Delete") && remove) remove();
	else return;
	e.preventDefault();
	e.stopPropagation();
};

export function TexturesPanel({ api }: { api: TexturesApi }) {
	const [renaming, setRenaming] = useState<number | null>(null);
	const [newMap, setNewMap] = useState<number | null>(null);
	const refs = drawingRefs(api.rel);
	const pals = paletteFiles().map((f) => ({ ref: relTo(dirname(api.rel), f), label: stripExt(basename(f)) }));
	const add = () => {
		const i = api.add(api.freshName("texture", api.textures.map((t) => t.name)), refs[0].ref);
		setRenaming(i);
	};
	return (
		<InspectorSection
			title="Textures"
			hint="Textures: each a set of maps, every map a drawing of the project tiled over a cell. The colour map is what is painted; the rest are the game's."
			actions={
				<button type="button" disabled={!refs.length} aria-label="New texture" title={refs.length ? "A texture: a drawing of the project, tiled" : "Draw a 2D file in the project first; a texture's maps are drawings"} onClick={add}>
					<Icon name="plus" size={14} />
				</button>
			}
		>
			{api.textures.length === 0 && <div class="insp-hint flush">{refs.length ? "No textures yet" : "Draw a 2D file in the project first; a texture's maps are drawings"}</div>}
			{api.textures.map((t, i) => {
				const several = Object.keys(t.maps).length > 1;
				return (
					<div class="ed-block" key={t.name}>
						<div
							class="ed-item"
							tabIndex={0}
							title="Double-click to rename · right-click for more"
							onDblClick={() => setRenaming(i)}
							onKeyDown={headKeys(() => setRenaming(i), () => api.remove(i))}
							onContextMenu={(e) =>
								menuAt(e, [
									{ label: "Rename", keys: "Enter", run: () => setRenaming(i) },
									{ label: "Add map…", run: () => setNewMap(i) },
									{ label: "Delete texture", danger: true, sep: true, run: () => api.remove(i) },
								])
							}
						>
							<Icon name="brick-wall" size={14} />
							{renaming === i ? <InlineName value={t.name} onCommit={(n) => (api.rename(i, n), setRenaming(null))} onCancel={() => setRenaming(null)} /> : <span class="ed-item-name">{t.name}</span>}
						</div>
						<Property label="Cell" layout="pair" title="The size of one tile of the pattern">
							<NumberField axis="x" label="Cell width" value={t.cell[0]} min={0.01} step={0.1} stepper={false} onChange={(v) => api.cell(i, 0, v)} onDone={endGesture} />
							<NumberField axis="y" label="Cell height" value={t.cell[1]} min={0.01} step={0.1} stepper={false} onChange={(v) => api.cell(i, 1, v)} onDone={endGesture} />
						</Property>
						{t.maps.height && (
							<Property label="Relief" title="How far the height map's white stands proud of its black, in the drawing's units. The 3D view lights by it, and a build bakes it to a normal map. 0 for none">
								<NumberField label="Relief" value={t.relief ?? 0} step={0.1} stepper={false} onChange={(v) => api.relief(i, v)} onDone={endGesture} />
							</Property>
						)}
						{Object.entries(t.maps).map(([name, m]) => (
							<div class="ed-map" key={name}>
								<div
									class="ed-sub"
									tabIndex={several ? 0 : undefined}
									title={`The ${name} map: a drawing of the project, tiled`}
									onKeyDown={headKeys(null, several ? () => api.removeMap(i, name) : null)}
									onContextMenu={(e) => menuAt(e, [{ label: "Delete map", danger: true, disabled: !several, run: () => api.removeMap(i, name) }])}
								>
									{name}
								</div>
								<Property label="Drawing">
									<Select
										value={m.ref}
										title="The drawing"
										options={[...(refs.some((r) => r.ref === m.ref) ? [] : [{ value: m.ref, label: m.ref }]), ...refs.map((r) => ({ value: r.ref, label: r.label }))]}
										onChange={(v) => api.map(i, name, { ref: v })}
									/>
									<Button title="Open the drawing" onClick={() => void openDoc(joinRel(dirname(api.rel), m.ref))}>
										Open
									</Button>
								</Property>
								<Property label="Palette">
									<Select
										value={m.palette ?? ""}
										title="A palette laid over the drawing's colours: the same drawing as another map"
										options={[{ value: "", label: "The drawing's own" }, ...(m.palette && !pals.some((p) => p.ref === m.palette) ? [{ value: m.palette, label: m.palette }] : []), ...pals.map((p) => ({ value: p.ref, label: p.label }))]}
										onChange={(v) => api.map(i, name, { palette: v })}
									/>
								</Property>
								<Property label="State" title="Which of the drawing's states; empty for its first">
									<TextField value={m.state ?? ""} placeholder="first" onChange={(v) => api.map(i, name, { state: v })} />
								</Property>
								<Property label="Mode" title="Paint: its colours over the token; mask: the token times its value">
									<SegmentedControl<"paint" | "mask">
										label="Mode"
										options={[
											{ value: "paint", label: "Paint" },
											{ value: "mask", label: "Mask" },
										]}
										value={m.mode ?? "paint"}
										onChange={(v) => api.map(i, name, { mode: v as TextureMap["mode"] })}
									/>
								</Property>
								<Property label="Soften" title="A blur over the map, in the drawing's units: a hard line becomes a ridge with a slope. 0 leaves it as drawn">
									<NumberField label="Soften" value={m.soften ?? 0} min={0} step={0.1} stepper={false} onChange={(v) => api.map(i, name, { soften: v })} onDone={endGesture} />
								</Property>
							</div>
						))}
						{newMap === i ? (
							<div class="ed-item">
								<InlineName value="" onCommit={(n) => (api.addMap(i, n), setNewMap(null))} onCancel={() => setNewMap(null)} />
							</div>
						) : (
							<div class="insp-actions">
								<Button variant="borderless" icon="plus" title="Another map of this texture: height, glow, rough, whatever the game reads" onClick={() => setNewMap(i)}>
									Add map
								</Button>
							</div>
						)}
					</div>
				);
			})}
		</InspectorSection>
	);
}
