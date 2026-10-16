import { render } from "preact";
import "./tokens.css";
import "./ur.css";
import "./theme.css";
import "./app.css";
import "./styles/editor.css";
import "./styles/model.css";
import "./styles/scene.css";
import { App } from "./App.tsx";
import { boot, project, openDoc, goBrowse, goFolder, thumbLog, thumbHow } from "./state/project.ts";
import { nav } from "./state/nav.ts";
import { glStats } from "./canvas/gl3.ts";
import { uncovered, dangling, contextNow, TOPICS, CATEGORIES, searchHelp } from "./state/help.ts";
import { chosenBounds } from "./canvas/model3.ts";
import { modal3, handles as gizmoHandles } from "./canvas/gizmo3.ts";
import { viewXf3, xf3ApplyDir } from "@fastart/core";
import { initTheme } from "./state/theme.ts";
import { applyLayout } from "./state/layout.ts";

initTheme();
applyLayout();
render(<App />, document.getElementById("app")!);
void boot();

// A probe for scripts and the console: the store, the view, and the
// screen mapping. Read-only in spirit; nothing in the app uses it.
import { ed, applyExternalDoc, revertToCheckpoint, flushNow } from "./state/editor.ts";
import * as editor from "./state/editor.ts";
import { md, projectViews, selected } from "./state/model.ts";
import * as model from "./state/model.ts";
import * as workspace from "./state/workspace.ts";
import { work } from "./state/workspace.ts";
import { meshOp, meshModal } from "./canvas/meshtool3.ts";
import { ix3, vertexHandles, hitFace, hitEdge, pipeHandles, pipePointAt } from "./canvas/model3.ts";
import { surfaceUnder } from "./canvas/surface3.ts";
import * as sculpting from "./state/sculpting.ts";
import * as sculpt3 from "./canvas/sculpt3.ts";
import * as sidecar from "./state/sidecar.ts";
import { sc, selectedNodes } from "./state/scene.ts";
import { sidebar } from "./state/sidebar.ts";
import { update } from "./state/update.ts";
import { view, toScreen, toWorld } from "./canvas/view.ts";
import { frameW, partXf, worldPivot, poseLever, chainGrabs, worldHandles } from "./canvas/interact.ts";
(globalThis as { fastart?: unknown }).fastart = { goFolder, sidecar, sculpting, sculpt3, surface: { surfaceUnder, pipeHandles, pipePointAt }, thumbHow, model, editor, work, workspace, meshOp, meshModal, ix3, vertexHandles, hitFace, hitEdge, callTool: (name: string, args?: Record<string, unknown>) => import("./state/tools.ts").then((m) => m.callTool(name, args)), ed, md, sc, sidebar, nav, openDoc, goBrowse, thumbLog, chosenBounds, glStats, help: { uncovered, dangling, contextNow, TOPICS, CATEGORIES, searchHelp }, selected, selectedNodes, modal3, gizmoHandles, upOnScreen: () => xf3ApplyDir(viewXf3(md.turn.value), [0, 1, 0]), update, projectViews, project, view, toScreen, toWorld, frameW, partXf, worldPivot, poseLever, chainGrabs, worldHandles, applyExternalDoc, revertToCheckpoint, flushNow };
