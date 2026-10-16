// Every command, registered once. The keyboard (App), the menu bar (Go)
// and the command palette all run these by id.

import { register } from "./commands.ts";
import { ed, save, revertToCheckpoint, undo, redo, copySel, pasteClip, cutSel, dupSel, deleteSel, selOrder, selectAll, endGesture, curClip, curPart, addKey, type Tool } from "./editor.ts";
import { project, goBrowse, goWelcome, goDocs, goSetup, goBack, goForward, pickFolder, toggleServe, inWorkspace, revealFile } from "./project.ts";
import { view, fitBounds, zoomBy } from "../canvas/view.ts";
import { escape, polyEnter, selBounds, nudgeWorld } from "../canvas/interact.ts";
import { toggleChat } from "./chat.ts";
import { sidebar, toggleSidebar, toggleInspector, popToAssets, pushAsset, openAsset, showTab, showInspectorTab } from "./sidebar.ts";
import { openPalette, renaming, openMenuBelow, type MenuItem } from "./menu.ts";
import { createProjectSheet, cloneSheet, newAssetSheet, newBranchSheet } from "../ui/Sheets.tsx";
import { assetMenu, stateMenu } from "../ui/ProjectBar.tsx";
import { logActivity, busy } from "./activity.ts";
import { buildSidecars } from "./sidecar.ts";
import { CATEGORIES, openHelp, helpSheet, helpSearch, keysSheet } from "./help.ts";
import { toggleAppearance } from "./theme.ts";
import { canBack, canForward } from "./nav.ts";
import { basename, stripExt } from "./paths.ts";
import { shell } from "../shell/shell.ts";
import { checkForUpdates } from "./update.ts";
import { docBounds } from "@fastart/core";
import * as M from "./model.ts";
import * as Sc from "./sculpting.ts";
import { escape as escape3, polyEnter as polyEnter3, nudgeView, frameBounds, chosenBounds, orbitDrag, ix3 } from "../canvas/model3.ts";
import { meshOp } from "../canvas/meshtool3.ts";
import { shading, setShading, mirrorOn, setMirror } from "./workspace.ts";
import { askProject } from "../screens/Model.tsx";
import { importGltfCommand } from "../ui/ImportGltf.tsx";
import * as S from "../state/scene.ts";
import { askInstance, addGroupNow } from "../screens/Scene.tsx";
import { nudgeSel as nudgeScene, frameBounds as sceneBounds, orbitDrag as sceneOrbit, chosenBounds as sceneChosen } from "../canvas/scene3.ts";

const inEditor = () => project.screen.value === "edit";
const inModel = () => project.screen.value === "model";
const inScene = () => project.screen.value === "scene";
const inAny = () => inEditor() || inModel() || inScene();
const inProject = () => inWorkspace();
const native = () => shell.kind === "wails";
const setup = () => (inEditor() && ed.curClip.value < 0 && !ed.isPalette.value) || (inModel() && M.md.curClip.value < 0);

/** A mesh is the one thing selected in the model screen, in a state: its corners, edges and faces can be edited. */
const meshSel = () => inModel() && M.md.curClip.value < 0 && M.selShape()?.kind === "mesh" && !M.md.also.value.length;

/** A mesh or a sweep is the one thing selected in the model screen, in a state: it can carry modifiers. */
const surfSel = () => {
	const k = M.selShape()?.kind;
	return inModel() && M.md.curClip.value < 0 && (k === "mesh" || k === "sweep") && !M.md.also.value.length;
};
/** What an action did, into the activity log. */
const noted = (what: string | null) => {
	if (what) logActivity(what, "check");
};
/** Every 3D model of the project gets its compiled sidecar, the fresh ones left alone. */
async function buildAll() {
	const root = project.root.value;
	if (root === null) return;
	const files = project.files.value.filter((f) => project.kinds.value[f] === "3D");
	const done = await busy("Building compiled sidecars", () => buildSidecars(root, files));
	const built = done.filter((d) => d.did === "built").length;
	const failed = done.filter((d) => d.did === "failed");
	logActivity(`Built ${built} sidecar${built === 1 ? "" : "s"}, ${done.filter((d) => d.did === "fresh").length} already fresh`, "check");
	if (failed.length) project.error.value = `Could not build ${failed.map((f) => f.path).join(", ")}: ${failed[0].why ?? ""}`;
}

/** The quick switchers drop from their segment of the path bar (the last one, when theirs is not there). */
function openSwitcher(which: "asset" | "state", items: MenuItem[]) {
	const el = document.querySelector<HTMLElement>(`.ur-pathbar [data-crumb="${which}"]`) ?? [...document.querySelectorAll<HTMLElement>(".ur-pathbar .ur-crumb")].pop();
	if (el) openMenuBelow(el, items);
}

/** Save keeps the checkpoint, and says so in the activity view. */
function saved(save: () => Promise<unknown>) {
	const name = stripExt(basename(openAsset() ?? ""));
	void save().then(() => logActivity(`Saved a checkpoint of ${name}`, "circle-check"));
}

/** A step of the turntable, 15° at a time, about what is chosen. */
function orbitStep(yaw: number, pitch: number) {
	const px = Math.PI / 12 / 0.008;
	if (inScene()) sceneOrbit(yaw * px, pitch * px);
	else orbitDrag(yaw * px, pitch * px);
}

let nudgeTimer: number | undefined;
function nudge(dx: number, dy: number) {
	if (inScene()) nudgeScene([dx, dy]);
	else if (inModel()) nudgeView([dx, dy]);
	else nudgeWorld([dx, dy]);
	// a burst of taps is one undo step; a pause ends it
	if (nudgeTimer !== undefined) clearTimeout(nudgeTimer);
	nudgeTimer = window.setTimeout(inScene() ? S.endGesture : inModel() ? M.endGesture : endGesture, 600);
}

function tool(t: Tool | "pipe") {
	if (inModel()) {
		M.md.tool.value = t;
		M.md.polyPts.value = [];
		M.md.pipePts.value = [];
		if (t !== "select") {
			M.md.painting.value = false;
			M.md.sculpting.value = false;
		}
		// a pipe drawn over a mesh that is mirrored (by a modifier, or by the working symmetry) gets its twin
		if (t === "pipe") {
			const s = M.md.sel.value;
			const sh = M.selShape();
			if (s && sh) M.md.pipeTwin.value = M.mirrorModOn(sh) || M.symOn(s);
		}
		return;
	}
	if (t === "pipe") return;
	ed.tool.value = t;
	ed.polyPts.value = [];
}
/** The 2D editor's way, the model's, or the scene's, by screen. */
const either = (a: () => void, b: () => void, c?: () => void) => () => (inScene() ? (c ?? a)() : inModel() ? b() : a());

export function initCommands() {
	register(
		{ id: "tool.select", title: "Select", group: "Tools", when: setup, run: () => tool("select") },
		{ id: "tool.rect", title: "Rect tool", group: "Tools", when: setup, run: () => tool("rect") },
		{ id: "tool.circle", title: "Circle tool", group: "Tools", when: setup, run: () => tool("circle") },
		{ id: "tool.line", title: "Line tool", group: "Tools", when: setup, run: () => tool("line") },
		{ id: "tool.poly", title: "Poly tool", group: "Tools", when: setup, run: () => tool("poly") },
		{ id: "tool.pipe", title: "Pipe tool", group: "Tools", when: () => inModel() && setup(), run: () => tool("pipe") },
		{ id: "model.onSurface", title: "On surface: pipe points land on the mesh under the pointer", group: "Tools", when: () => inModel() && setup(), run: () => (M.md.onSurface.value = !M.md.onSurface.value) },
		{ id: "model.pipeTwin", title: "Pipe symmetry: a mirrored twin across x", group: "Tools", when: () => inModel() && setup(), run: () => (M.md.pipeTwin.value = !M.md.pipeTwin.value) },

		{ id: "chat.toggle", title: "Ask Claude", group: "File", when: () => shell.chat && inProject(), run: toggleChat },
		{ id: "file.save", title: "Save (checkpoint)", group: "File", when: inAny, run: either(() => saved(save), () => saved(M.save), () => saved(S.save)) },
		{ id: "file.revert", title: "Revert to checkpoint", group: "File", when: () => (inEditor() && ed.dirty.value) || (inModel() && M.md.dirty.value) || (inScene() && S.sc.dirty.value), run: either(() => void revertToCheckpoint(), () => void M.revertToCheckpoint(), () => void S.revertToCheckpoint()) },
		{ id: "file.newScene", title: "New scene…", group: "File", when: inProject, run: () => void newAssetSheet("Scene") },
		{ id: "file.newScene3d", title: "New 3D scene…", group: "File", when: inProject, run: () => void newAssetSheet("3D scene") },
		{ id: "scene.addInstance", title: "Place a file…", group: "Scene", when: inScene, run: () => void askInstance() },
		{ id: "scene.addGroup", title: "Add a group", group: "Scene", when: inScene, run: addGroupNow },
		{ id: "file.new", title: "New asset…", group: "File", when: inProject, run: () => void newAssetSheet("2D") },
		{ id: "file.newModel", title: "New 3D asset…", group: "File", when: inProject, run: () => void newAssetSheet("3D") },
		{ id: "file.newPalette", title: "New palette…", group: "File", when: inProject, run: () => void newAssetSheet("Palette") },
		{ id: "file.importGltf", title: "Import glTF…", group: "File", when: inProject, run: () => void importGltfCommand() },
		{ id: "model.project", title: "Project to 2D views…", group: "File", when: inModel, run: () => void askProject() },
		{ id: "file.browse", title: "Close the asset (show the browser)", group: "File", when: inAny, run: () => void goBrowse() },
		{ id: "file.newProject", title: "New project…", group: "File", when: native, run: createProjectSheet },
		{ id: "file.clone", title: "Clone git repository…", group: "File", when: native, run: cloneSheet },
		{ id: "file.reveal", title: "Reveal the project", group: "File", when: () => native() && inProject(), run: () => void revealFile("") },
		{ id: "file.openFolder", title: "Open project…", group: "File", when: native, run: () => void pickFolder() },
		{ id: "file.projects", title: "Close the project", group: "File", when: () => native() && inProject(), run: () => void goWelcome() },
		{ id: "git.switch", title: "Switch branch…", group: "File", when: () => inProject() && project.branches.value.length > 0, run: () => showTab("git") },
		{ id: "git.newBranch", title: "New branch…", group: "File", when: () => inProject() && !!project.branch.value, run: newBranchSheet },
		{ id: "file.serve", title: "Serve on the network", group: "File", when: () => native() && inProject(), run: () => void toggleServe() },

		{ id: "edit.undo", title: "Undo", group: "Edit", when: inAny, run: either(undo, M.undo, S.undo) },
		{ id: "edit.redo", title: "Redo", group: "Edit", when: inAny, run: either(redo, M.redo, S.redo) },
		{ id: "edit.copy", title: "Copy", group: "Edit", when: inEditor, run: copySel },
		{ id: "edit.paste", title: "Paste", group: "Edit", when: inEditor, run: pasteClip },
		{ id: "edit.cut", title: "Cut", group: "Edit", when: inEditor, run: cutSel },
		{ id: "edit.duplicate", title: "Duplicate", group: "Edit", when: inAny, run: either(dupSel, M.dupSel, () => S.selectNodes(S.selectedRoots().map((p) => S.duplicateNode(p)).filter((p): p is string => !!p))) },
		{ id: "model.unwrap", title: "Unwrap texture into a sheet", group: "Edit", when: () => inModel() && !!M.md.sel.value, run: M.unwrapSel },
		{ id: "model.mirror", title: "Mirror across x", group: "Edit", when: () => inModel() && !!M.md.sel.value, run: M.mirrorSel },
		{ id: "edit.delete", title: "Delete", group: "Edit", when: inAny, run: either(deleteSel, M.deleteSel, () => S.selectedRoots().forEach((p) => S.deleteNode(p))) },
		{ id: "edit.selectAll", title: "Select all", group: "Edit", when: () => (setup() && inEditor()) || meshSel(), run: either(selectAll, M.chooseAll) },

		{ id: "mesh.corners", title: "Choose corners", group: "Mesh", when: meshSel, run: () => M.setPick("corner") },
		{ id: "mesh.edges", title: "Choose edges", group: "Mesh", when: meshSel, run: () => M.setPick("edge") },
		{ id: "mesh.faces", title: "Choose faces", group: "Mesh", when: meshSel, run: () => M.setPick("face") },
		{ id: "mesh.extrude", title: "Extrude faces or open edges", group: "Mesh", when: meshSel, run: () => void meshOp("extrude", ix3.cursor) },
		{ id: "mesh.inset", title: "Inset faces", group: "Mesh", when: meshSel, run: () => void meshOp("inset", ix3.cursor) },
		{ id: "mesh.loopCut", title: "Loop cut", group: "Mesh", when: meshSel, run: () => void meshOp("loopcut", ix3.cursor) },
		{ id: "mesh.merge", title: "Merge corners by distance", group: "Mesh", when: meshSel, run: () => void meshOp("merge", null) },
		{ id: "mesh.creaseAngle", title: "Crease by angle", group: "Mesh", when: meshSel, run: () => void meshOp("creaseAngle", null) },
		{ id: "mesh.rim", title: "Choose the whole rim", group: "Mesh", when: meshSel, run: () => void M.meshAct("rim") },
		{ id: "mesh.bridge", title: "Bridge two rims", group: "Mesh", when: meshSel, run: () => void M.meshAct("bridge") },
		{ id: "mesh.fill", title: "Fill a rim", group: "Mesh", when: meshSel, run: () => void M.meshAct("fill") },
		{ id: "mesh.flip", title: "Flip faces", group: "Mesh", when: meshSel, run: () => void M.meshAct("flip") },
		{ id: "mesh.wind", title: "Wind outward", group: "Mesh", when: meshSel, run: () => void M.meshAct("wind") },
		{ id: "mesh.paint", title: "Paint faces by brush", group: "Mesh", when: meshSel, run: () => M.setPainting(!M.md.painting.value) },
		{ id: "mesh.sculpt", title: "Sculpt mode", group: "Mesh", when: meshSel, run: () => void Sc.setSculpting(!M.md.sculpting.value) },
		{ id: "sculpt.subdivide", title: "Sculpt: subdivide the mesh once", group: "Mesh", when: meshSel, run: () => noted(Sc.subdivideSel()) },
		{ id: "sculpt.filter", title: "Sculpt: run the mesh filter", group: "Mesh", when: meshSel, run: () => noted(Sc.runFilter()) },
		{ id: "sculpt.maskInvert", title: "Sculpt: invert the mask", group: "Mesh", when: meshSel, run: () => Sc.maskAct("invert") },
		{ id: "sculpt.maskClear", title: "Sculpt: clear the mask", group: "Mesh", when: meshSel, run: () => Sc.maskAct("clear") },
		{ id: "mesh.paintChosen", title: "Paint the chosen faces", group: "Mesh", when: () => meshSel() && M.md.faces.value.length > 0, run: () => void M.paintChosen() },
		{ id: "mesh.shade", title: "Shade corners", group: "Mesh", when: meshSel, run: () => noted(M.shadeAct("shade")) },
		{ id: "mesh.clearShades", title: "Clear shades", group: "Mesh", when: meshSel, run: () => noted(M.shadeAct("clear")) },
		{ id: "mesh.addMirror", title: "Add modifier: mirror", group: "Mesh", when: surfSel, run: () => void M.addMod(M.md.sel.value!, "mirror") },
		{ id: "mesh.addSolidify", title: "Add modifier: solidify", group: "Mesh", when: surfSel, run: () => void M.addMod(M.md.sel.value!, "solidify") },
		{ id: "mesh.addCrease", title: "Add modifier: crease", group: "Mesh", when: surfSel, run: () => void M.addMod(M.md.sel.value!, "crease") },
		{
			id: "mesh.applyMods",
			title: "Apply every modifier",
			group: "Mesh",
			when: () => surfSel() && M.modsOf(M.selShape()).length > 0,
			run: () => {
				try {
					noted(M.applyMod(M.md.sel.value!, M.modsOf(M.selShape()).length - 1));
				} catch (e) {
					project.error.value = e instanceof Error ? e.message : String(e);
				}
			},
		},
		{ id: "file.buildSidecars", title: "Build compiled sidecars for the project", group: "File", when: inProject, run: () => void buildAll() },
		{
			id: "mesh.symmetry",
			title: "Symmetry: mirror edits across x",
			group: "Mesh",
			when: meshSel,
			run: () => {
				const s = M.md.sel.value!;
				const name = M.parts()[s.part]?.name ?? "";
				// a Mirror modifier across x already does it: the two would double every edit
				if (M.mirrorModOn(M.selShape()!)) project.error.value = "This mesh has a Mirror modifier across x, so the file mirrors it already: edit the half that is there.";
				else setMirror(name, s.shape, !mirrorOn(name, s.shape));
			},
		},
		{ id: "edit.raise", title: "Raise", group: "Edit", when: () => inEditor() || inScene(), run: either(() => selOrder(true), () => {}, () => { if (S.sc.sel.value) S.moveNode(S.sc.sel.value, true); }) },
		{ id: "edit.lower", title: "Lower", group: "Edit", when: () => inEditor() || inScene(), run: either(() => selOrder(false), () => {}, () => { if (S.sc.sel.value) S.moveNode(S.sc.sel.value, false); }) },
		{ id: "edit.escape", title: "Deselect / cancel", group: "Edit", when: inAny, run: either(escape, escape3, () => (S.sc.sel.value = null)) },
		{
			id: "edit.enter",
			title: "Close the polygon / rename the part",
			group: "Edit",
			when: inAny,
			run: either(
				() => {
					if (ed.polyPts.value.length >= 3) polyEnter();
					else if (curPart()) renaming.value = { kind: "part", index: ed.curPart.value };
				},
				() => {
					if (M.md.polyPts.value.length >= 3 || (M.md.tool.value === "pipe" && M.md.pipePts.value.length >= 2)) polyEnter3();
					else if (M.md.tool.value === "pipe") project.error.value = "A pipe needs two points or more: click them, then press Return.";
					else if (M.curPart()) renaming.value = { kind: "part", index: M.md.curPart.value };
				},
				() => {},
			),
		},
		{ id: "edit.nudgeLeft", title: "Nudge left", group: "Edit", when: () => setup() || inScene(), run: () => nudge(-1, 0) },
		{ id: "edit.nudgeRight", title: "Nudge right", group: "Edit", when: () => setup() || inScene(), run: () => nudge(1, 0) },
		{ id: "edit.nudgeUp", title: "Nudge up", group: "Edit", when: () => setup() || inScene(), run: () => nudge(0, -1) },
		{ id: "edit.nudgeDown", title: "Nudge down", group: "Edit", when: () => setup() || inScene(), run: () => nudge(0, 1) },
		{ id: "edit.nudgeLeft10", title: "Nudge left ×10", group: "Edit", when: () => setup() || inScene(), run: () => nudge(-10, 0) },
		{ id: "edit.nudgeRight10", title: "Nudge right ×10", group: "Edit", when: () => setup() || inScene(), run: () => nudge(10, 0) },
		{ id: "edit.nudgeUp10", title: "Nudge up ×10", group: "Edit", when: () => setup() || inScene(), run: () => nudge(0, -10) },
		{ id: "edit.nudgeDown10", title: "Nudge down ×10", group: "Edit", when: () => setup() || inScene(), run: () => nudge(0, 10) },

		{ id: "view.zoomIn", title: "Zoom in", group: "View", when: inAny, run: () => zoomBy(1.25) },
		{ id: "view.zoomOut", title: "Zoom out", group: "View", when: inAny, run: () => zoomBy(1 / 1.25) },
		{ id: "view.zoom100", title: "Actual size", group: "View", when: inAny, run: () => (view.zoom.value = 10) },
		{ id: "view.front", title: "View: front", group: "View", when: () => inModel() || (inScene() && S.is3d()), run: either(() => {}, () => M.setView("front"), () => S.setView("front")) },
		{ id: "view.back", title: "View: back", group: "View", when: () => inModel() || (inScene() && S.is3d()), run: either(() => {}, () => M.setView("back"), () => S.setView("back")) },
		{ id: "view.left", title: "View: left", group: "View", when: () => inModel() || (inScene() && S.is3d()), run: either(() => {}, () => M.setView("left"), () => S.setView("left")) },
		{ id: "view.right", title: "View: right", group: "View", when: () => inModel() || (inScene() && S.is3d()), run: either(() => {}, () => M.setView("right"), () => S.setView("right")) },
		{ id: "view.top", title: "View: top", group: "View", when: () => inModel() || (inScene() && S.is3d()), run: either(() => {}, () => M.setView("top"), () => S.setView("top")) },
		{ id: "view.bottom", title: "View: bottom", group: "View", when: () => inModel() || (inScene() && S.is3d()), run: either(() => {}, () => M.setView("bottom"), () => S.setView("bottom")) },
		{ id: "view.turnLeft", title: "View: turn left a step", group: "View", when: () => inModel() || (inScene() && S.is3d()), run: () => orbitStep(-1, 0) },
		{ id: "view.turnRight", title: "View: turn right a step", group: "View", when: () => inModel() || (inScene() && S.is3d()), run: () => orbitStep(1, 0) },
		{ id: "view.tiltUp", title: "View: tilt up a step", group: "View", when: () => inModel() || (inScene() && S.is3d()), run: () => orbitStep(0, -1) },
		{ id: "view.tiltDown", title: "View: tilt down a step", group: "View", when: () => inModel() || (inScene() && S.is3d()), run: () => orbitStep(0, 1) },
		{ id: "view.flip", title: "View: the other side", group: "View", when: () => inModel() || (inScene() && S.is3d()), run: either(() => {}, M.flipView, S.flipView) },
		{
			id: "view.frame",
			title: "Frame what is chosen",
			group: "View",
			when: () => inModel() || inScene(),
			run: () => {
				const b = inScene() ? sceneChosen() : chosenBounds();
				if (b) fitBounds(b.lo, b.hi);
			},
		},
		{ id: "model.outline", title: "Silhouettes", group: "View", when: inModel, run: () => (M.md.outline.value = !M.md.outline.value) },
		{ id: "view.clay", title: "Clay shading", group: "View", when: inModel, run: () => setShading(shading.value === "clay" ? "plain" : "clay") },
		{ id: "edit.deform", title: "Deform: reshape the part in this state", group: "Tools", when: () => (inModel() && M.md.curClip.value < 0) || (inEditor() && ed.curClip.value < 0 && !ed.isPalette.value), run: either(() => (ed.deform.value = !ed.deform.value), () => (M.md.deform.value = !M.md.deform.value)) },
		{
			id: "view.fit",
			title: "Zoom to fit",
			group: "View",
			when: inAny,
			run: () => {
				const b = inScene() ? sceneBounds() : inModel() ? frameBounds() : docBounds(ed.doc.value);
				if (b) fitBounds(b.lo, b.hi);
				else {
					view.pan.value = [0, 0];
					view.zoom.value = 10;
				}
			},
		},
		{
			id: "view.fitSelection",
			title: "Zoom to selection",
			group: "View",
			when: () => inEditor() && ed.sel.value.length > 0,
			run: () => {
				const b = selBounds();
				if (b) fitBounds(b.lo, b.hi);
			},
		},
		{ id: "view.snapGrid", title: "Snap to grid", group: "View", when: inAny, run: () => (view.snapGrid.value = !view.snapGrid.value) },
		{
			id: "view.collision",
			title: "Collision lens",
			group: "View",
			when: () => setup() || inModel(),
			run: either(
				() => {
					ed.collide.value = !ed.collide.value;
					ed.colSel.value = -1;
				},
				() => (M.md.collide.value = !M.md.collide.value),
			),
		},
		{ id: "view.sidebar", title: "Navigator", group: "View", when: inProject, run: toggleSidebar },
		{ id: "nav.assets", title: "Navigator: assets", group: "View", when: inProject, run: () => showTab("assets") },
		{ id: "nav.outline", title: "Navigator: outline", group: "View", when: inProject, run: () => showTab("asset") },
		{ id: "nav.search", title: "Navigator: search", group: "View", when: inProject, run: () => showTab("search") },
		{ id: "nav.git", title: "Navigator: source control", group: "View", when: inProject, run: () => showTab("git") },
		{ id: "nav.back", title: "Back", group: "View", when: () => inProject() && canBack(), run: () => void goBack() },
		{ id: "nav.forward", title: "Forward", group: "View", when: () => inProject() && canForward(), run: () => void goForward() },
		{ id: "view.inspector", title: "Inspector", group: "View", when: inProject, run: toggleInspector },
		{ id: "sidebar.back", title: "Navigator: back to the assets", group: "View", when: () => inProject() && sidebar.view.value === "asset", run: popToAssets },
		{ id: "sidebar.asset", title: "Navigator: into the asset", group: "View", when: () => inAny() && !!openAsset() && sidebar.view.value === "assets", run: pushAsset },
		{ id: "asset.switch", title: "Switch asset…", group: "View", when: inProject, run: () => openSwitcher("asset", assetMenu()) },
		{ id: "state.switch", title: "Switch state…", group: "View", when: () => inEditor() || inModel(), run: () => openSwitcher("state", stateMenu()) },

		{ id: "clip.play", title: "Play / pause", group: "Clip", when: () => (inEditor() && !!curClip()) || (inModel() && !!M.curClip()) || inScene(), run: either(() => (ed.playing.value = !ed.playing.value), () => (M.md.playing.value = !M.md.playing.value), () => (S.sc.playing.value = !S.sc.playing.value)) },
		{ id: "clip.addKey", title: "Add a key at the playhead", group: "Clip", when: () => (inEditor() && !!curClip()) || (inModel() && !!M.curClip()), run: either(addKey, M.addKey) },

		{ id: "app.palette", title: "Command palette", group: "App", run: openPalette },
		{ id: "app.update", title: "Check for updates", group: "App", when: () => shell.updates, run: () => void checkForUpdates(true) },
		{ id: "app.settings", title: "Settings and setup…", group: "App", run: goSetup },
		{ id: "app.appearance", title: "Appearance: light / dark", group: "App", run: toggleAppearance },
		{ id: "help.context", title: "Help for what is on screen", group: "App", run: () => (inProject() ? showInspectorTab(sidebar.inspector.value && sidebar.tab.value === "help" ? "inspector" : "help") : goDocs("guide")) },
		{ id: "help.search", title: "Search help…", group: "App", run: () => ((helpSheet.value = null), (keysSheet.value = false), (helpSearch.value = "")) },
		{ id: "help.keys", title: "Keyboard shortcuts", group: "App", run: () => ((helpSheet.value = null), (helpSearch.value = null), (keysSheet.value = true)) },
		...CATEGORIES.map((c) => ({ id: `help.cat.${c.id}`, title: `Help: ${c.title.toLowerCase()}`, group: "App", run: () => openHelp(c.topics) })),
		{ id: "app.docs", title: "Docs: the guide", group: "App", run: () => goDocs("guide") },
		{ id: "app.docsFormat", title: "Docs: the format", group: "App", run: () => goDocs("format") },
	);
}
