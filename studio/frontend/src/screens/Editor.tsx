// The 2D editor's parts of the workspace: its lists for the sidebar, its
// tools for the floating bar, its canvas (or a palette's swatches), the
// timeline below when a clip is chosen. The frame is screens/Workspace.tsx.

import { clipDuration } from "@fastart/core";
import { PaletteView } from "../ui/PaletteView.tsx";
import { Layers } from "../ui/Layers.tsx";
import { BottomBar, StatesList, ClipsList } from "../ui/BottomBar.tsx";
import { Canvas } from "../canvas/Canvas.tsx";
import { ToolBar, Transport, gridMode, keyReadout, type ToolSpec } from "../ui/Tools.tsx";
import { showIssues } from "../ui/ProjectBar.tsx";
import { ed, curState, curClip, keyHere, seek, type Tool } from "../state/editor.ts";
import { run } from "../state/commands.ts";
import { Checkbox, InspectorSection, Property } from "../ui/ur.tsx";

export const EDITOR_TOOLS: ToolSpec<Tool>[] = [
	{ tool: "select", label: "Select", key: "V", icon: "mouse-pointer-2" },
	{ tool: "rect", label: "Rect", key: "R", icon: "square" },
	{ tool: "circle", label: "Circle", key: "O", icon: "circle" },
	{ tool: "line", label: "Line", key: "L", icon: "slash" },
	{ tool: "poly", label: "Pen", key: "P", icon: "pen-tool", makes: "click for corners, drag for curves; click the first point or press Enter to close" },
];

export function EditorSidebar() {
	void ed.rev.value;
	if (ed.isPalette.value) return <div class="nav-empty">A palette: its colours are on the canvas</div>;
	return (
		<>
			<Layers />
			<StatesList />
			<ClipsList />
		</>
	);
}

/** The status bar's line: the mode, and what a gesture does in it. */
export function editorStatus(): string {
	if (ed.isPalette.value) return "A palette: colours other assets draw from";
	const st = curState();
	const clip = curClip();
	if (ed.collide.value) return "Collision lens: shapes a game may treat as solid · C flips back";
	if (clip) {
		const key = clip.keys[keyHere()];
		const at = key ? `key at ${key.t}s` : "between keys: a change adds a key";
		return `${clip.name} · ${at} · drag a part to turn it (⌥ moves, ⇧ snaps) · drag a joint to move it · Space plays`;
	}
	if (ed.pending.value === "pivot") return "Click the canvas to place the pivot";
	if (ed.pending.value === "anchor") return "Click the canvas to place the anchor";
	if (ed.tool.value === "poly") return "Pen: click for a corner, drag for a curve · click the first point or press Enter to close · Esc drops it";
	if (st) return `${st.name} · Drag the pivot to move · drag the lever to rotate · ⌥-drag to duplicate`;
	return "";
}

/** The path bar's right side: the tools and modes, then the clip's transport. */
export function EditorTools() {
	void ed.rev.value;
	if (ed.isPalette.value) return null;
	const clip = curClip();
	const posing = !!clip;
	const collide = ed.collide.value;
	const dur = clip ? clipDuration(clip) : 0;
	return (
		<>
			<ToolBar
				tools={EDITOR_TOOLS}
				current={ed.tool.value}
				disabled={(t) => posing && t !== "select"}
				why="A clip poses its keys; pick a state to draw"
				modes={[
					{ id: "deform", command: "edit.deform", label: "Deform: drags reshape the part in this state only", icon: "spline", key: "D", on: ed.deform.value, disabled: posing || collide, why: posing ? "A clip poses parts, not shapes; pick a state to deform" : "Leave the collision lens to deform" },
					{ id: "collision", command: "view.collision", label: "Collision lens", icon: "shield", key: "C", on: collide },
					gridMode(),
				]}
			/>
			{clip && (
				<>
					<span class="ur-pathbar-sep" />
					<Transport name={clip.name} playing={ed.playing.value} onPlay={() => run("clip.play")} onRewind={() => seek(0)} readout={keyReadout(clip.keys, ed.clipTime.value)} progress={dur > 0 ? ed.clipTime.value / dur : 0} />
				</>
			)}
		</>
	);
}

/** The View tab's own section: the lenses of the 2D canvas. */
export function EditorView() {
	const posing = !!curClip();
	return (
		<InspectorSection title="Overlays">
			<Property label="">
				<Checkbox checked={ed.collide.value} label="Collision lens" onChange={() => run("view.collision")} />
			</Property>
			<Property label="">
				<Checkbox checked={ed.deform.value} disabled={posing || ed.collide.value} label="Deform in this state" onChange={() => run("edit.deform")} />
			</Property>
		</InspectorSection>
	);
}

export function EditorCanvas() {
	void ed.rev.value;
	if (ed.isPalette.value) return <PaletteView />;
	const issues = ed.issues.value;
	return (
		<>
			<Canvas />
			{issues.length > 0 && showIssues.value && (
				<div class="issues">
					{issues.slice(0, 8).map((i) => (
						<div class={["unknown", "reserved", "unresolved"].includes(i.code) ? "w" : "e"}>
							{i.code} {i.path}: {i.message}
						</div>
					))}
					{issues.length > 8 && <div>… and {issues.length - 8} more</div>}
				</div>
			)}
		</>
	);
}

export const EditorBottom = BottomBar;
