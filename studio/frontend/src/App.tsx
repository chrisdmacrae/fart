import { useEffect } from "preact/hooks";
import { project, leaveDocs, leaveSetup, inWorkspace } from "./state/project.ts";
import { curClip } from "./state/editor.ts";
import { ix } from "./canvas/interact.ts";
import { sheetOpen } from "./state/prompt.ts";
import { palette } from "./state/menu.ts";
import { KEYMAP, KEYMAP_3D, keyOf, run } from "./state/commands.ts";
import { initCommands } from "./state/actions.ts";
import { shell } from "./shell/shell.ts";
import { HelpSheet, HelpSearchSheet, KeysSheet } from "./ui/Help.tsx";
import { helpSheet, helpSearch, keysSheet } from "./state/help.ts";
import { gizmoKey, gizmoActive, gizmoNote } from "./canvas/gizmo3.ts";
import { meshKey, meshActive } from "./canvas/meshtool3.ts";
import { sculptKey, sculptActive, sculptAdjust } from "./canvas/sculpt3.ts";
import { sx } from "./canvas/scene3.ts";
import { ix3 as ix3model } from "./canvas/model3.ts";
import { Welcome } from "./screens/Welcome.tsx";
import { Workspace } from "./screens/Workspace.tsx";
import { sc } from "./state/scene.ts";
import { md, curClip as curClip3 } from "./state/model.ts";
import { Docs } from "./screens/Docs.tsx";
import { Setup } from "./screens/Setup.tsx";
import { Prompt, Confirm, Sheets } from "./ui/Prompt.tsx";
import { ContextMenu } from "./ui/ContextMenu.tsx";
import { CommandPalette } from "./ui/CommandPalette.tsx";
import { UpdateBadge } from "./ui/UpdateBadge.tsx";
import { scheduleUpdateChecks } from "./state/update.ts";

initCommands();

// a transform that could not begin says why, where every other word to the person goes
gizmoNote.subscribe((why) => {
	if (!why) return;
	project.error.value = why;
	gizmoNote.value = null;
});

function typing(e: KeyboardEvent): boolean {
	const t = e.target as HTMLElement | null;
	// a slider holds no text: only the keys that move it are its own, and ⌘Z after a drag on one still undoes
	if (t && t.tagName === "INPUT" && (t as HTMLInputElement).type === "range") return /^(Arrow|Home|End|Page)/.test(e.key);
	// nor does a tick box: Space is its own, and ⌘Z after ticking one still undoes
	if (t && t.tagName === "INPUT" && (t as HTMLInputElement).type === "checkbox") return e.key === " ";
	return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

function onKey(e: KeyboardEvent) {
	if (sheetOpen() || helpSheet.value || helpSearch.value !== null || keysSheet.value || palette.open.value) return;
	if (typing(e) && e.key !== "Escape") return;
	const screen = project.screen.value;
	if (screen === "docs" && e.key === "Escape") return leaveDocs();
	if (screen === "setup" && e.key === "Escape") return leaveSetup();
	// a mesh operation following the pointer takes its keys first: the digits, Return, Esc
	if (screen === "model" && meshKey(e)) return e.preventDefault();
	// sculpting takes the brushes' letters, F and the mask's keys
	if (screen === "model" && sculptKey(e, ix3model.cursor)) return e.preventDefault();
	// a transform in the model view takes its keys first: G T S, then X Y Z and the digits
	if ((screen === "model" || screen === "scene") && gizmoKey(e, screen === "model" ? ix3model.cursor : sx.cursor)) return e.preventDefault();
	const k = keyOf(e);
	// the space bar: play a clip, or hold to pan
	if (k === "space") {
		if (typing(e)) return;
		e.preventDefault();
		if (screen === "edit" && curClip()) run("clip.play");
		else if (screen === "edit") ix.space = true;
		else if (screen === "model" && curClip3()) run("clip.play");
		else if (screen === "model") md.space = true;
		else if (screen === "scene") run("clip.play");
		return;
	}
	// a 3D view has its own digits (the views), ahead of the tools'
	const in3d = screen === "model" || (screen === "scene" && sc.scene.value.space === "3d");
	// (and no digit falls through to a tool: in 3D the digits are all the view's)
	const id = in3d && (KEYMAP_3D[k] || /^\d$/.test(k)) ? KEYMAP_3D[k] : KEYMAP[k];
	if (!id) return;
	if (run(id)) e.preventDefault();
}

/**
 * While a transform is under way its keys are its own, wherever the
 * focus is (a row of the outline would otherwise take Return as a rename
 * and ⌫ as a delete): caught on the way down, before anything else.
 */
function onKeyFirst(e: KeyboardEvent) {
	if (meshActive() && !typing(e) && meshKey(e)) {
		e.preventDefault();
		e.stopPropagation();
		return;
	}
	if ((sculptActive() || sculptAdjust.value) && !typing(e) && sculptKey(e, ix3model.cursor)) {
		e.preventDefault();
		e.stopPropagation();
		return;
	}
	if (!gizmoActive() || typing(e)) return;
	if (gizmoKey(e, project.screen.value === "scene" ? sx.cursor : ix3model.cursor)) {
		e.preventDefault();
		e.stopPropagation();
	}
}

function onKeyUp(e: KeyboardEvent) {
	if (e.code === "Space") {
		ix.space = false;
		md.space = false;
		sc.space = false;
	}
}

export function App() {
	useEffect(() => {
		window.addEventListener("keydown", onKeyFirst, true);
		window.addEventListener("keydown", onKey);
		window.addEventListener("keyup", onKeyUp);
		shell.onMenu((id) => void run(id));
		scheduleUpdateChecks();
		return () => {
			window.removeEventListener("keydown", onKeyFirst, true);
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("keyup", onKeyUp);
		};
	}, []);
	const screen = project.screen.value;
	const err = project.error.value;
	return (
		<>
			{screen === "welcome" && <Welcome />}
			{inWorkspace(screen) && <Workspace />}
			{screen === "docs" && <Docs />}
			{screen === "setup" && <Setup />}
			<Prompt />
			<Confirm />
			<Sheets />
			<HelpSheet />
			<HelpSearchSheet />
			<KeysSheet />
			<ContextMenu />
			<CommandPalette />
			<UpdateBadge />
			{err && (
				<div class="toast" onClick={() => (project.error.value = null)}>
					{err}
				</div>
			)}
		</>
	);
}
