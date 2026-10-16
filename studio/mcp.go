package main

// Uranus as a tool. A small MCP server (streamable HTTP, JSON-RPC 2.0) on
// the loopback that Claude Code connects to. Every tool call is relayed
// to the page, which holds the document and does the work (reads,
// applies with undo, renders, validates); its reply is the tool result.
// The shell only carries messages, and only from this machine.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"
)

// ToolCall is what the page receives: a call to answer with ToolReply.
type ToolCall struct {
	ID   string          `json:"id"`
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

type toolRelay struct {
	mu      sync.Mutex
	pending map[string]chan string
	seq     int
	bus     *bus
}

func (r *toolRelay) call(name string, args json.RawMessage, timeout time.Duration) (string, error) {
	r.mu.Lock()
	r.seq++
	id := fmt.Sprintf("t%d", r.seq)
	ch := make(chan string, 1)
	r.pending[id] = ch
	r.mu.Unlock()
	if args == nil {
		args = json.RawMessage("{}")
	}
	r.bus.emit("tool", ToolCall{ID: id, Name: name, Args: args})
	select {
	case res := <-ch:
		return res, nil
	case <-time.After(timeout):
		r.mu.Lock()
		delete(r.pending, id)
		r.mu.Unlock()
		return "", fmt.Errorf("the editor did not answer %s in time (is a document open?)", name)
	}
}

func (r *toolRelay) reply(id, result string) {
	r.mu.Lock()
	ch := r.pending[id]
	delete(r.pending, id)
	r.mu.Unlock()
	if ch != nil {
		ch <- result
	}
}

type MCP struct {
	url   string
	relay *toolRelay
}

// The tools, as Claude sees them. The page implements each.
var mcpTools = []map[string]any{
	{
		"name":        "get_document",
		"description": "The document open in Uranus, at the detail asked for: outline (the default: every part, state, clip, token and count as text, a few hundred tokens; read this first), lean (the JSON without bakes), full (the JSON as saved), or one part by name. Also what is selected and the state or clip on the canvas. With no file open, the project's file list.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"detail": map[string]any{"type": "string", "enum": []string{"outline", "lean", "full"}, "description": "how much of the document; outline unless you need geometry"},
				"part":   map[string]any{"type": "string", "description": "one part by name, lean"},
			},
		},
	},
	{
		"name":        "apply_patch",
		"description": "Change the open document with RFC 6902 operations (add, remove, replace, move, copy, test) whose paths address things by NAME: /parts/hull/pivot, /parts/hull/shapes/2/points/4, /states/open/parts/lid/rotate, /clips/walk/keys/2/t, /palette/ink/rgb, /textures/plating/cell, /constraints/arm/chain; numbers are indices, - appends. Validated, one undo step, the canvas updates. Prefer this to apply_document for any change to an open file; never write tris or bake.",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"ops"},
			"properties": map[string]any{
				"ops":  map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{"op": map[string]any{"type": "string", "enum": []string{"add", "remove", "replace", "move", "copy", "test"}}, "path": map[string]any{"type": "string"}, "from": map[string]any{"type": "string"}, "value": map[string]any{}}, "required": []string{"op", "path"}}},
				"note": map[string]any{"type": "string", "description": "one line on what changed, shown to the user"},
			},
		},
	},
	{
		"name":        "pose",
		"description": "Pose a part in a state of the open document: where its pivot lands (offset), its turn (rotate: radians, a number in 2D or [x, y, z] in 3D), scale, mirror; or remove it from the state. The part joins the state at rest if it was not in it.",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"state", "part"},
			"properties": map[string]any{
				"state":  map[string]any{"type": "string"},
				"part":   map[string]any{"type": "string"},
				"offset": map[string]any{"type": "array", "items": map[string]any{"type": "number"}},
				"rotate": map[string]any{"description": "radians: a number (2D) or [x, y, z] (3D)"},
				"scale":  map[string]any{"type": "number"},
				"mirror": map[string]any{"type": "boolean"},
				"remove": map[string]any{"type": "boolean"},
				"note":   map[string]any{"type": "string"},
			},
		},
	},
	{
		"name":        "morph",
		"description": "Reshape a part's poly, path or mesh in a state (a morph, 1.6: clips lerp the corners): give every point (points), or deltas for some points by index (moves: {\"3\": [0, -1]}), or a scale about the shape's centre (scale: 1.1 or [sx, sy, sz]); reset forgets it. The shape is an index into the part's shapes (see the outline).",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"state", "part", "shape"},
			"properties": map[string]any{
				"state":  map[string]any{"type": "string"},
				"part":   map[string]any{"type": "string"},
				"shape":  map[string]any{"type": "integer"},
				"points": map[string]any{"type": "array"},
				"moves":  map[string]any{"type": "object"},
				"scale":  map[string]any{},
				"reset":  map[string]any{"type": "boolean"},
				"note":   map[string]any{"type": "string"},
			},
		},
	},
	{
		"name":        "clip",
		"description": "Make or replace a clip of the open document from keys: a string like \"0:idle 0.3:squash 0.6:stretch!land 1:idle\" (t:state, !event), or a list of {t, state, ease, events}. States must exist.",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"name", "keys"},
			"properties": map[string]any{
				"name": map[string]any{"type": "string"},
				"keys": map[string]any{"description": "a string of t:state words, or a list of key objects"},
				"loop": map[string]any{"type": "boolean"},
				"note": map[string]any{"type": "string"},
			},
		},
	},
	{
		"name":        "make",
		"description": "Add a shape to a part from a recipe: 2D ellipse {at, rx, ry}, roundedRect {at, w, h, r}, star {at, points, r1, r2}, ngon {at, sides, r}; 3D box {at, size}, ball {at, r}, rod {a, b, w}, lathe {profile: [[radius, along], ...], axis, segments, smooth}, extrude {profile: [[u, v], ...], axis, from, to}. Every recipe takes kind and color (a palette token). Curved recipes come out as paths or sweeps, so they stay editable.",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"part", "recipe"},
			"properties": map[string]any{
				"part":   map[string]any{"type": "string"},
				"recipe": map[string]any{"type": "object"},
				"note":   map[string]any{"type": "string"},
			},
		},
	},
	{
		"name":        "apply_document",
		"description": "Replace the open document with this one: the whole document, valid format JSON. It is validated first and refused with the errors if wrong; applied as one undo step; the canvas updates at once. Say what changed in note.",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"doc"},
			"properties": map[string]any{
				"doc":  map[string]any{"type": "object", "description": "the whole document"},
				"note": map[string]any{"type": "string", "description": "one line on what changed, shown to the user"},
			},
		},
	},
	{
		"name":        "render",
		"description": "A PNG of the open document: a named state, or a clip at a time in seconds, or what is on the canvas when neither is given; or a contact sheet (sheet: states for every state in one image, sheet: clip for a clip's frames in a row). A 3D model can be looked at from a named view, or from several in one call (views: an image each, in order): look from front, left, top and three-quarter before and after reshaping a mesh. Look before and after a change.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"state": map[string]any{"type": "string"},
				"clip":  map[string]any{"type": "string"},
				"t":     map[string]any{"type": "number", "description": "seconds into the clip"},
				"size":  map[string]any{"type": "integer", "description": "pixels on the long side, default 512 (384 each when several views are asked for)"},
				"view":  map[string]any{"type": "string", "enum": meshViews, "description": "3D models: the view to look from; absent, the canvas's own"},
			"path":  map[string]any{"type": "string", "description": "another 3D model of the project, by its project-relative path, looked at without opening it: drawn from its compiled sidecar (built first if missing or stale). state, view, views and size apply; absent, the open document"},
				"views": map[string]any{"type": "array", "items": map[string]any{"type": "string", "enum": meshViews}, "description": "3D models: several views in one call, e.g. [\"front\", \"left\", \"top\", \"three-quarter\"]"},
				"sheet":  map[string]any{"type": "string", "enum": []string{"states", "clip"}, "description": "tile every state, or a clip's frames, into one image"},
				"frames": map[string]any{"type": "integer", "description": "frames in a clip sheet, default 8"},
			},
		},
	},
	{
		"name":        "validate",
		"description": "The validator's report (errors with codes and paths, warnings) for a document, or for the open one when none is given.",
		"inputSchema": map[string]any{
			"type":       "object",
			"properties": map[string]any{"doc": map[string]any{"type": "object"}},
		},
	},
	{
		"name":        "get_direction",
		"description": "The project's art direction (style.gas at its root), merged with what it extends: the statement, palette refs, roles, scale, line, shapes, light, motion, names, references to copy from, rules, avoid. Read it before designing anything new; null when the project has none.",
		"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
	},
	{
		"name":        "open_file",
		"description": "Open another .fart file of the project in the editor, by its project-relative path (as get_document lists them).",
		"inputSchema": map[string]any{
			"type":       "object",
			"required":   []string{"path"},
			"properties": map[string]any{"path": map[string]any{"type": "string"}},
		},
	},
}

// meshViews are the views render can look at a 3D model from.
var meshViews = []string{"front", "back", "left", "right", "top", "bottom", "three-quarter"}

// The mesh tools: the model screen's mesh operations, one each. Every one
// names its mesh the same way, is validated before it lands (indices, the
// operation's own conditions, then the whole document), is one undo step,
// and answers with what the mesh is now (counts, manifold, closed, which
// way it winds, its rims), so a change can be checked without a render.
func meshTool(name, description string, required []string, props map[string]any) map[string]any {
	all := map[string]any{
		"part":  map[string]any{"type": "string", "description": "the part's name; absent, the part selected in the editor"},
		"shape": map[string]any{"type": "integer", "description": "the mesh's index in the part's shapes; absent, the selected shape, or the part's only mesh"},
	}
	for k, v := range props {
		all[k] = v
	}
	schema := map[string]any{"type": "object", "properties": all}
	if len(required) > 0 {
		schema["required"] = required
	}
	return map[string]any{"name": name, "description": description, "inputSchema": schema}
}

func init() {
	ints := func(what string) map[string]any {
		return map[string]any{"type": "array", "items": map[string]any{"type": "integer"}, "description": what}
	}
	edge := func(what string) map[string]any {
		return map[string]any{"type": "array", "items": map[string]any{"type": "integer"}, "minItems": 2, "maxItems": 2, "description": what}
	}
	edges := func(what string) map[string]any {
		return map[string]any{"type": "array", "items": edge("an edge: two corner indices"), "description": what}
	}
	num := func(what string) map[string]any { return map[string]any{"type": "number", "description": what} }
	mirror := map[string]any{"type": "boolean", "description": "also do it to the mirror across x = 0 of the part's space (a symmetric mesh stays symmetric)"}
	mcpTools = append(mcpTools,
		meshTool("mesh_info", "A mesh of the open 3D model, measured: its counts, whether it is manifold and closed, whether it winds outward (by the volume it encloses), and its rims (each loop of open edges, as corner indices). The points and faces themselves are in get_document.", nil, nil),
		meshTool("mesh_extrude", "Extrude faces of a mesh along their normal by an amount (negative digs in), walling the border with quads; or, given edges instead, grow a band of quads from open edges: outward in the plane of each edge's face by amount, or along dir.", nil, map[string]any{
			"faces":  ints("face indices to extrude as one region"),
			"edges":  edges("open edges (on a rim) to extrude instead of faces"),
			"amount": num("how far, in the part's units"),
			"dir":    map[string]any{"type": "array", "items": map[string]any{"type": "number"}, "minItems": 3, "maxItems": 3, "description": "edges only: move the new edge by this [x, y, z] instead of outward"},
			"mirror": mirror,
		}),
		meshTool("mesh_inset", "Inset faces of a mesh by an amount: a border ring of quads, the inner faces kept (and raised along their normal by raise, negative to sink). The usual first step of a panel, a rim or a socket.", []string{"faces", "amount"}, map[string]any{
			"faces":  ints("face indices to inset as one region"),
			"amount": num("how far in from the border"),
			"raise":  num("lift of the inner faces along the normal, default 0"),
			"border": map[string]any{"type": "string", "description": "a palette token's name for the border ring (format 1.8 paint): with a little raise, a trim band in one step"},
			"mirror": mirror,
		}),
		meshTool("mesh_loop_cut", "A loop cut: a new edge loop across the ring of four-sided faces an edge belongs to, at a fraction of the way from the edge's first corner to its second. Adds the geometry a curve needs.", []string{"edge"}, map[string]any{
			"edge":   edge("the edge the loop crosses: two corner indices"),
			"at":     num("0 to 1 exclusive, default 0.5"),
			"mirror": mirror,
		}),
		meshTool("mesh_bridge", "Bridge two rims (loops of open edges) of the same count with a band of quads. Each rim is named by one edge on it; mesh_info lists the rims.", []string{"a", "b"}, map[string]any{
			"a": edge("an edge on the first rim"),
			"b": edge("an edge on the second rim"),
		}),
		meshTool("mesh_fill", "Fill a rim (a loop of open edges) with one face. The rim is named by one edge on it.", []string{"edge"}, map[string]any{
			"edge": edge("an edge on the rim"),
		}),
		meshTool("mesh_delete_faces", "Delete faces of a mesh; corners nothing uses go with them, and the rest are renumbered (read the mesh again before naming indices).", []string{"faces"}, map[string]any{
			"faces":  ints("face indices to delete"),
			"mirror": mirror,
		}),
		meshTool("mesh_merge", "Merge corners of a mesh that lie within a distance of each other into one, at their middle: all of them, or only those named. Welds a doubled seam.", nil, map[string]any{
			"distance": num("default 0.001"),
			"corners":  ints("only these corner indices; absent, every corner"),
			"mirror":   mirror,
		}),
		meshTool("mesh_flip", "Flip faces of a mesh: each winds the other way.", []string{"faces"}, map[string]any{
			"faces":  ints("face indices to flip"),
			"mirror": mirror,
		}),
		meshTool("mesh_wind_outward", "Wind a whole mesh outward: within each connected piece neighbours are made to agree, then the piece is turned so the volume it encloses is positive.", nil, nil),
		meshTool("mesh_crease", "Set the crease of edges of a mesh: 0 takes it away, 1 is sharp, a fraction is a fillet once the mesh is smooth.", []string{"edges", "value"}, map[string]any{
			"edges":  edges("the edges, each two corner indices"),
			"value":  num("0 to 1"),
			"mirror": mirror,
		}),
		meshTool("mesh_crease_by_angle", "Crease every edge of a mesh whose two faces meet at more than an angle; the other edges keep what they have.", nil, map[string]any{
			"angle": num("degrees between the faces' normals, default 30"),
			"value": num("the crease they get, 0 to 1, default 1"),
		}),
	)
	// format 1.8: colour by face, the modifier stack, shades by corner, pipes, compiled sidecars.
	// These take a mesh or a sweep (part and shape as the mesh tools name them).
	mcpTools = append(mcpTools,
		meshTool("mesh_paint", "Paint faces of a mesh or a sweep with a colour of the palette (format 1.8: the shape's colors and paint are written and kept minimal; painting a face the shape's own colour takes its paint away). A trim band, a lining, a jewel. Answers with how many faces wear each colour now.", []string{"faces", "color"}, map[string]any{
			"faces":  map[string]any{"description": "face indices to paint, or the word \"all\"", "anyOf": []map[string]any{{"type": "array", "items": map[string]any{"type": "integer"}}, {"type": "string", "enum": []string{"all"}}}},
			"color":  map[string]any{"type": "string", "description": "a palette token's name"},
			"mirror": mirror,
		}),
		meshTool("mesh_modifiers", "Set the whole list of modifiers of a mesh or a sweep, in the order they are applied ([] clears it). The cage stays the file and every reader applies them: mirror {op, axis: x|y|z, merge?} reflects the cage through the plane where that coordinate is 0 and welds the seam; solidify {op, thick, offset? (-1 the cage is the outside … 1 the inside), inner?, rim?} gives a surface a wall (inner and rim are colours: a palette token's name, or a paint index); crease {op, angle?, value?} creases every edge sharper than an angle. Model half a helm with no thickness and let these make the rest.", []string{"mods"}, map[string]any{
			"mods": map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "the modifiers, in order"},
		}),
		meshTool("mesh_apply_modifier", "Bake modifiers into plain geometry: the one at index and every one before it (absent: all of them). Paint, shades, creases and morphs are carried; a sweep becomes the mesh it made. Do this only when the geometry itself must be edited: a modifier left in place stays adjustable.", nil, map[string]any{
			"index": map[string]any{"type": "integer", "description": "the last modifier to apply, from 0; absent, every modifier"},
		}),
		meshTool("mesh_shade", "Shade a mesh's corners: each gets a number for how much of the sky it sees past the model's own geometry as the current state poses it (rays over the hemisphere about its normal, cosine weighted, nearer hits darker), written as shades, so folds, insides and the foot of a plume sit darker. Run it last, after the geometry is settled: it is not recomputed when the mesh changes. clear takes the shades away.", nil, map[string]any{
			"strength": num("0 to 1: how dark a wholly hidden corner gets, default 0.6"),
			"reach":    num("how far a ray looks for something in its way, in units; default about a third of the model's size"),
			"clear":    map[string]any{"type": "boolean", "description": "remove the mesh's shades instead"},
		}),
		map[string]any{
			"name":        "pipe",
			"description": "A pipe (format 1.8): a round section swept along a path through points, added to a part as a sweep and selected. A horn, a plume's spine, a strap, a curl of trim. With on, each point lands on the nearest point of that shape's drawn surface, lifted by an offset along its normal, so a curl or a ridge follows a helm. radii scales the radius per point (0 at an end is a tapered tip). One undo step.",
			"inputSchema": map[string]any{
				"type":     "object",
				"required": []string{"points"},
				"properties": map[string]any{
					"part":     map[string]any{"type": "string", "description": "the part the pipe is added to; absent, the part selected in the editor"},
					"points":   map[string]any{"type": "array", "items": map[string]any{"type": "array", "items": map[string]any{"type": "number"}, "minItems": 3, "maxItems": 3}, "description": "the path: two or more [x, y, z] in the part's own space"},
					"radius":   num("the pipe's radius, default 0.3"),
					"radii":    map[string]any{"type": "array", "items": map[string]any{"type": "number"}, "description": "one factor per point, multiplying radius there"},
					"segments": map[string]any{"type": "integer", "description": "sides of the section, 3 or more, default 8"},
					"caps":     map[string]any{"type": "boolean", "description": "close the ends of an open pipe, default true"},
					"closed":   map[string]any{"type": "boolean", "description": "join the last point to the first (three points or more)"},
					"round":    map[string]any{"type": "boolean", "description": "curve the path through its points; default true with three points or more"},
					"color":    map[string]any{"type": "string", "description": "a palette token's name; absent, the last of the palette"},
					"mirror":   map[string]any{"type": "boolean", "description": "also add its mirrored twin across x = 0 (the next shape of the part)"},
					"on": map[string]any{"type": "object", "description": "land the points on a shape's surface", "required": []string{"shape"}, "properties": map[string]any{
						"part":   map[string]any{"type": "string", "description": "the part of the shape to land on; absent, the pipe's own part"},
						"shape":  map[string]any{"type": "integer", "description": "that shape's index in its part"},
						"offset": num("how far off the surface, along its normal; default 0.1"),
					}},
				},
			},
		},
		map[string]any{
			"name":        "build_sidecars",
			"description": "Build compiled sidecars (format 1.8: name.fart.glb beside name.fart, the model's triangles already generated, for a game's loader and for the studio's own previews): of one 3D file, of every one under a folder, or of the whole project. One that is already of its source's bytes is left alone unless force. They are build artifacts: never edit one, keep *.fart.glb out of git.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path":  map[string]any{"type": "string", "description": "a .fart's project-relative path, or a folder's; absent, the whole project"},
					"force": map[string]any{"type": "boolean", "description": "rebuild the fresh ones too"},
				},
			},
		},
	)
}

func startMCP(b *bus) (*MCP, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	tok := make([]byte, 12)
	_, _ = rand.Read(tok)
	path := "/mcp/" + hex.EncodeToString(tok)
	m := &MCP{relay: &toolRelay{pending: map[string]chan string{}, bus: b}}
	m.url = fmt.Sprintf("http://%s%s", ln.Addr().String(), path)
	mux := http.NewServeMux()
	mux.HandleFunc(path, m.handle)
	go func() { _ = http.Serve(ln, mux) }()
	return m, nil
}

type rpcReq struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

func (m *MCP) handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 32<<20))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	var req rpcReq
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "bad json-rpc", 400)
		return
	}
	// a notification: nothing to answer
	if len(req.ID) == 0 || string(req.ID) == "null" {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	reply := func(result any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	}
	fail := func(code int, msg string) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": code, "message": msg}})
	}
	switch req.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &p)
		if p.ProtocolVersion == "" {
			p.ProtocolVersion = "2025-06-18"
		}
		reply(map[string]any{
			"protocolVersion": p.ProtocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "uranus", "version": "0.3.0"},
			"instructions":    "Uranus is the editor the user is looking at. get_document, then apply_document; render to see. To reshape a mesh of a 3D model use the mesh_ tools (extrude, inset, loop cut, bridge, fill, merge, crease): each is one undo step and answers with what the mesh is now; render with views to look from several sides at once. Format 1.8: mesh_paint colours faces, mesh_modifiers keeps mirror, solidify and crease in the file (model half a thing, thin), mesh_shade darkens the folds, pipe sweeps a tube along points (on a surface, if asked), build_sidecars compiles a model for fast loading.",
		})
	case "ping":
		reply(map[string]any{})
	case "tools/list":
		reply(map[string]any{"tools": mcpTools})
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil || p.Name == "" {
			fail(-32602, "tools/call needs a name")
			return
		}
		known := false
		for _, t := range mcpTools {
			if t["name"] == p.Name {
				known = true
			}
		}
		if !known {
			fail(-32602, "no tool named "+p.Name)
			return
		}
		res, err := m.relay.call(p.Name, p.Arguments, 90*time.Second)
		if err != nil {
			reply(map[string]any{"content": []map[string]any{{"type": "text", "text": err.Error()}}, "isError": true})
			return
		}
		// the page already shaped the result
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":%s}`, string(req.ID), res)
	default:
		fail(-32601, "no such method: "+req.Method)
	}
}
