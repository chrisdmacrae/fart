// The inspector in the asset browser: the picked asset (rename it, open
// it, take it out), then the project itself.

import { useEffect, useState } from "preact/hooks";
import { project, openDoc, deleteFile, duplicateFile, revealFile, renameTo, renameProblem } from "../state/project.ts";
import { nav, remember } from "../state/nav.ts";
import { basename, dirname, pretty, stripExt } from "../state/paths.ts";
import { shell } from "../shell/shell.ts";
import { DIRECTION_FILE } from "@fastart/core";
import { kindOf } from "./kinds.ts";
import { Button, Checkbox, InspectorSection, Property, SegmentedControl, TextField, middleTruncate } from "./ur.tsx";

function AssetSection({ rel }: { rel: string }) {
	const stem = stripExt(basename(rel));
	const [name, setName] = useState(stem);
	useEffect(() => setName(stem), [rel]);
	const t = project.thumbs.value.get(rel);
	const caps = project.caps.value;
	const bad = name.trim() && name.trim() !== stem ? renameProblem(rel, name.trim()) : null;
	const commit = () => {
		const n = name.trim();
		if (!n || n === stem || bad) return setName(stem);
		void renameTo(rel, n);
	};
	const d = t?.doc;
	return (
		<InspectorSection title="Asset">
			<Property label="Name">
				<TextField value={name} mono invalid={!!bad} hint={bad ?? undefined} onChange={setName} onSubmit={commit} onBlur={commit} />
			</Property>
			<Property label="Kind">
				<span class="ur-prop-val">{kindOf(rel, t)}</span>
			</Property>
			<Property label="Folder">
				<span class="ur-prop-val">{dirname(rel) || "the project's root"}</span>
			</Property>
			{d && !t?.scene && (d.parts?.length ?? 0) > 0 && (
				<Property label="Inside">
					<span class="ur-prop-val">
						{d.parts?.length ?? 0} part{d.parts?.length === 1 ? "" : "s"} · {d.states?.length ?? 0} state{d.states?.length === 1 ? "" : "s"} · {d.clips?.length ?? 0} clip{d.clips?.length === 1 ? "" : "s"}
					</span>
				</Property>
			)}
			{t?.scene && (
				<Property label="Inside">
					<span class="ur-prop-val">
						{t.scene.instances} instance{t.scene.instances === 1 ? "" : "s"}
					</span>
				</Property>
			)}
			<div class="insp-actions">
				<Button onClick={() => void openDoc(rel)}>Open</Button>
				<Button onClick={() => void duplicateFile(rel)}>Duplicate</Button>
				{caps.reveal && <Button onClick={() => void revealFile(rel)}>Reveal</Button>}
				<Button variant="danger" onClick={() => void deleteFile(rel)}>
					{caps.trash ? "Move to Trash…" : "Delete…"}
				</Button>
			</div>
		</InspectorSection>
	);
}

export function ProjectInspector() {
	const files = project.files.value;
	const scenes = files.filter((f) => f.endsWith(".shart")).length;
	const native = shell.kind === "wails";
	const sel = nav.selected.value;
	return (
		<div class="inspector">
			{sel && files.includes(sel) && <AssetSection rel={sel} />}
			<InspectorSection title="Project" hint="the folder that is the project">
				<Property label="Name">
					<span class="ur-prop-val">{project.name.value}</span>
				</Property>
				{native && (
					<Property label="Folder" title={project.root.value ?? ""}>
						<span class="ur-prop-val ur-mono">{middleTruncate(pretty(project.root.value ?? "", project.home.value), 30)}</span>
					</Property>
				)}
				{project.branch.value && (
					<Property label="Branch">
						<span class="ur-prop-val">{project.branch.value}</span>
					</Property>
				)}
				<Property label="Assets">
					<span class="ur-prop-val">
						{files.length - scenes} file{files.length - scenes === 1 ? "" : "s"}
						{scenes ? ` · ${scenes} scene${scenes === 1 ? "" : "s"}` : ""}
					</span>
				</Property>
				{project.hasAssets.value && (
					<Property label="New assets">
						<span class="ur-prop-val">land in assets/</span>
					</Property>
				)}
			</InspectorSection>
			{project.direction.value ? (
				<InspectorSection title="Direction" hint={`the project's art direction: ${DIRECTION_FILE} at its root; new assets start from it, fart lint checks it`}>
					{project.direction.value.about && <div class="insp-hint flush">{project.direction.value.about}</div>}
					{project.direction.value.roles && (
						<Property label="Roles">
							<span class="ur-prop-val">{Object.entries(project.direction.value.roles).map(([r, t]) => `${r}: ${t}`).join(" · ")}</span>
						</Property>
					)}
					{project.direction.value.palette_refs?.length ? (
						<Property label="Palettes">
							<span class="ur-prop-val ur-mono">{project.direction.value.palette_refs.join(", ")}</span>
						</Property>
					) : null}
					{(project.direction.value.references ?? []).map((r) => (
						<Property label="Copy" title={r.for}>
							<button type="button" class="ur-link" onClick={() => void openDoc(r.file)}>
								{r.file}
							</button>
						</Property>
					))}
					{project.direction.value.avoid?.length ? (
						<Property label="Avoid">
							<span class="ur-prop-val">{project.direction.value.avoid.join(", ")}</span>
						</Property>
					) : null}
					{project.directionIssues.value.length > 0 && <div class="insp-hint flush">{project.directionIssues.value.join("; ")}</div>}
				</InspectorSection>
			) : (
				<InspectorSection title="Direction" hint={`a ${DIRECTION_FILE} at the project's root says the palette, roles, scale, light and rules every asset follows (spec/DIRECTION.md)`}>
					<div class="insp-hint flush">No art direction yet</div>
				</InspectorSection>
			)}
			{!sel && <div class="insp-hint">Click an asset to pick it · double-click to open it</div>}
		</div>
	);
}

/** The View tab in the browser: how the tiles are laid out. */
export function BrowserView() {
	return (
		<div class="inspector">
			<InspectorSection title="Tiles">
				<Property label="Size">
					<SegmentedControl options={["S", "M", "L"]} value={nav.size.value} onChange={(v) => ((nav.size.value = v), remember("size", v))} label="Tile size" />
				</Property>
				<Property label="Sort by">
					<SegmentedControl options={["Name", "Kind"]} value={nav.sort.value} onChange={(v) => ((nav.sort.value = v), remember("sort", v))} label="Sort by" />
				</Property>
				<Property label="">
					<Checkbox checked={nav.subfolders.value} label="Include subfolders" onChange={(v) => ((nav.subfolders.value = v), remember("subfolders", v ? "on" : "off"))} />
				</Property>
			</InspectorSection>
		</div>
	);
}
