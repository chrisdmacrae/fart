package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The mesh tools are declared for Claude: each names its mesh the same
// way, says what it needs, and the list a client asks for carries them.
func TestMeshToolsListed(t *testing.T) {
	m := &MCP{relay: &toolRelay{pending: map[string]chan string{}, bus: nil}}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	m.handle(rec, req)
	var out struct {
		Result struct {
			Tools []struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				InputSchema struct {
					Type       string                    `json:"type"`
					Required   []string                  `json:"required"`
					Properties map[string]map[string]any `json:"properties"`
				} `json:"inputSchema"`
			} `json:"tools"`
		} `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	want := map[string][]string{
		"mesh_info":            nil,
		"mesh_extrude":         nil,
		"mesh_inset":           {"faces", "amount"},
		"mesh_loop_cut":        {"edge"},
		"mesh_bridge":          {"a", "b"},
		"mesh_fill":            {"edge"},
		"mesh_delete_faces":    {"faces"},
		"mesh_merge":           nil,
		"mesh_flip":            {"faces"},
		"mesh_wind_outward":    nil,
		"mesh_crease":          {"edges", "value"},
		"mesh_crease_by_angle": nil,
		"mesh_paint":           {"faces", "color"},
		"mesh_modifiers":       {"mods"},
		"mesh_apply_modifier":  nil,
		"mesh_shade":           nil,
		"mesh_sculpt_stroke":   {"brush", "points", "radius"},
		"mesh_sculpt_filter":   {"filter", "amount"},
		"mesh_subdivide":       nil,
	}
	seen := map[string]bool{}
	for _, tool := range out.Result.Tools {
		if seen[tool.Name] {
			t.Errorf("%s is listed twice", tool.Name)
		}
		seen[tool.Name] = true
		req, isMesh := want[tool.Name]
		if tool.Description == "" || tool.InputSchema.Type != "object" {
			t.Errorf("%s: needs a description and an object schema", tool.Name)
		}
		if !isMesh {
			continue
		}
		for _, k := range []string{"part", "shape"} {
			if _, ok := tool.InputSchema.Properties[k]; !ok {
				t.Errorf("%s: no %s to name its mesh by", tool.Name, k)
			}
		}
		if len(req) != len(tool.InputSchema.Required) {
			t.Errorf("%s: requires %v, want %v", tool.Name, tool.InputSchema.Required, req)
		}
		for _, k := range req {
			if _, ok := tool.InputSchema.Properties[k]; !ok {
				t.Errorf("%s: requires %s, which it does not describe", tool.Name, k)
			}
		}
	}
	for name := range want {
		if !seen[name] {
			t.Errorf("%s is not listed", name)
		}
	}
	for _, name := range []string{"get_document", "apply_document", "render", "validate", "open_file", "pipe", "build_sidecars"} {
		if !seen[name] {
			t.Errorf("%s went missing", name)
		}
	}
	// render takes several views in one call
	for _, tool := range out.Result.Tools {
		if tool.Name != "render" {
			continue
		}
		if _, ok := tool.InputSchema.Properties["views"]; !ok {
			t.Error("render: no views")
		}
		// and another file of the project, from its sidecar
		if _, ok := tool.InputSchema.Properties["path"]; !ok {
			t.Error("render: no path")
		}
	}
	// a tool that is not listed is refused before the page is asked
	rec = httptest.NewRecorder()
	m.handle(rec, httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mesh_nothing","arguments":{}}}`)))
	if !bytes.Contains(rec.Body.Bytes(), []byte("no tool named mesh_nothing")) {
		t.Errorf("an unknown tool was not refused: %s", rec.Body.String())
	}
}
