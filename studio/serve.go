package main

// The LAN server behind the Serve button (and `studio --serve <dir>`):
// the same frontend over plain HTTP, plus a small file API rooted at one
// project. A tablet on the network gets the whole editor; a game
// hot-reloading the folder sees every stroke land.

import (
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	qrcode "github.com/skip2/go-qrcode"
)

const servePort = 4747

type ServeInfo struct {
	On   bool   `json:"on"`
	URL  string `json:"url"`
	Root string `json:"root"`
	QR   string `json:"qr"` // a PNG data URL of the URL, for the screen
}

type Server struct {
	assets embed.FS
	mu     sync.Mutex
	srv    *http.Server
	info   ServeInfo
	chat   *Chat
	bus    *bus
}

func NewServer(assets embed.FS) *Server {
	return &Server{assets: assets}
}

func (s *Server) Info() ServeInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.info
}

func (s *Server) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
}

func (s *Server) stopLocked() {
	if s.srv != nil {
		_ = s.srv.Close()
		s.srv = nil
	}
	s.info = ServeInfo{}
}

// Start serves root on every interface. Starting again with the same root
// is a no-op; with another root, the server moves.
func (s *Server) Start(root string) (ServeInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.srv != nil && s.info.Root == root {
		return s.info, nil
	}
	s.stopLocked()

	dist, err := fs.Sub(s.assets, "frontend/dist")
	if err != nil {
		return ServeInfo{}, err
	}
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(dist)))
	mux.HandleFunc("/api/info", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		writeJSON(w, map[string]any{"name": filepath.Base(root), "serve": true, "trash": caps().Trash, "root": root})
	})
	mux.HandleFunc("/api/list", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		files, err := listFiles(root)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, files)
	})
	mux.HandleFunc("/api/stamp", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		stamp, err := stampOf(root)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, stamp)
	})
	mux.HandleFunc("/api/kinds", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		files, err := listFiles(root)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, kindsOf(root, files))
	})
	// a picture of the project, for a reference image behind a model
	mux.HandleFunc("/api/image", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		full, err := rooted(root, r.URL.Query().Get("path"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		mime, ok := imageTypes[strings.ToLower(filepath.Ext(full))]
		if !ok || r.Method != http.MethodGet {
			http.Error(w, "not an image", 400)
			return
		}
		data, err := os.ReadFile(full)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", mime)
		_, _ = w.Write(data)
	})
	mux.HandleFunc("/api/file", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		full, err := rooted(root, r.URL.Query().Get("path"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		switch r.Method {
		case http.MethodGet:
			data, err := os.ReadFile(full)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_, _ = w.Write(data)
		case http.MethodPut:
			body, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			if err := writeAtomic(full, body); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case http.MethodDelete:
			how, err := removeFile(full)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			writeJSON(w, how)
		default:
			http.Error(w, "method", 405)
		}
	})
	mux.HandleFunc("/api/stat", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		full, err := rooted(root, r.URL.Query().Get("path"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		fi, err := os.Stat(full)
		if err != nil {
			writeJSON(w, Text{})
			return
		}
		writeJSON(w, Text{Text: fmt.Sprint(fi.ModTime().UnixMilli()), Found: true})
	})
	mux.HandleFunc("/api/rename", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		if r.Method != http.MethodPost {
			http.Error(w, "method", 405)
			return
		}
		q := r.URL.Query()
		from, err := rooted(root, q.Get("from"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		to, err := rooted(root, q.Get("to"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if err := renameFile(from, to); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/api/duplicate", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		if r.Method != http.MethodPost {
			http.Error(w, "method", 405)
			return
		}
		full, err := rooted(root, r.URL.Query().Get("path"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		dst, err := duplicateFile(full)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		rel, err := filepath.Rel(root, dst)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, filepath.ToSlash(rel))
	})

	// the setup probes reach outside the project (the home folder, the
	// repo root), so only the machine itself may call them
	local := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			noStore(w)
			host, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil || !net.ParseIP(host).IsLoopback() {
				http.Error(w, "setup is for the machine running the studio", 403)
				return
			}
			h(w, r)
		}
	}
	importRoutes(mux, local) // Import glTF reads a model from anywhere on this machine (gltf.go)
	sidecarRoutes(mux, root) // compiled sidecars beside their documents (sidecar.go)
	mux.HandleFunc("/api/setup/home", local(func(w http.ResponseWriter, r *http.Request) {
		h, _ := os.UserHomeDir()
		writeJSON(w, h)
	}))
	mux.HandleFunc("/api/setup/gitroot", local(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, gitRoot(r.URL.Query().Get("dir")))
	}))
	mux.HandleFunc("/api/setup/checkout", local(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, checkout())
	}))
	mux.HandleFunc("/api/setup/find", local(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		writeJSON(w, findNamed(q.Get("base"), q.Get("name"), 20))
	}))
	mux.HandleFunc("/api/setup/file", local(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		full, err := rooted(q.Get("base"), q.Get("rel"))
		if err != nil || !filepath.IsAbs(q.Get("base")) {
			http.Error(w, "bad path", 400)
			return
		}
		switch r.Method {
		case http.MethodGet:
			data, err := os.ReadFile(full)
			if err != nil {
				writeJSON(w, Text{})
				return
			}
			writeJSON(w, Text{Text: string(data), Found: true})
		case http.MethodPut:
			body, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			if err := os.WriteFile(full, body, 0o644); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method", 405)
		}
	}))

	// the chat, for a page on this machine: Claude Code runs here, so only
	// here may ask it; events reach the page as server-sent events
	mux.HandleFunc("/api/chat/status", local(func(w http.ResponseWriter, r *http.Request) {
		if s.chat == nil {
			writeJSON(w, ChatInfo{})
			return
		}
		writeJSON(w, s.chat.status())
	}))
	mux.HandleFunc("/api/chat/ask", local(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || s.chat == nil {
			http.Error(w, "method", 405)
			return
		}
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err := s.chat.ask(root, string(body)); err != nil {
			http.Error(w, err.Error(), 409)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	mux.HandleFunc("/api/chat/stop", local(func(w http.ResponseWriter, r *http.Request) {
		if s.chat != nil {
			s.chat.stop()
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("/api/chat/reset", local(func(w http.ResponseWriter, r *http.Request) {
		if s.chat != nil {
			s.chat.reset(root)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("/api/chat/tool", local(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || s.chat == nil {
			http.Error(w, "method", 405)
			return
		}
		body, _ := io.ReadAll(io.LimitReader(r.Body, 64<<20))
		s.chat.mcp.relay.reply(r.URL.Query().Get("id"), string(body))
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("/api/chat/events", local(func(w http.ResponseWriter, r *http.Request) {
		if s.bus == nil {
			http.Error(w, "no bus", 500)
			return
		}
		fl, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "no streaming", 500)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Connection", "keep-alive")
		ch, done := s.bus.subscribe()
		defer done()
		_, _ = fmt.Fprint(w, ": hello\n\n")
		fl.Flush()
		for {
			select {
			case msg := <-ch:
				_, _ = fmt.Fprintf(w, "data: %s\n\n", msg)
				fl.Flush()
			case <-r.Context().Done():
				return
			}
		}
	}))

	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", servePort))
	if err != nil {
		return ServeInfo{}, err
	}
	s.srv = &http.Server{Handler: mux}
	go func(srv *http.Server) { _ = srv.Serve(ln) }(s.srv)

	url := fmt.Sprintf("http://%s:%d", lanIP(), servePort)
	qr := ""
	if png, err := qrcode.Encode(url, qrcode.Medium, 256); err == nil {
		qr = "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
	}
	s.info = ServeInfo{On: true, URL: url, Root: root, QR: qr}
	return s.info, nil
}

func noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// lanIP: the first address a tablet on the same network could reach.
func lanIP() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "127.0.0.1"
	}
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := i.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipn.IP.To4()
			if ip4 == nil || ip4.IsLoopback() || ip4.IsLinkLocalUnicast() {
				continue
			}
			return ip4.String()
		}
	}
	return "127.0.0.1"
}
