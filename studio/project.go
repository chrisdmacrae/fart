package main

// ProjectService: what the studio's frontend asks the machine for. A
// project is a folder; every path the frontend holds is relative to it,
// and nothing here steps outside (no absolute paths, no "..").

import (
	"bufio"
	"encoding/base64"
	"errors"
	"fmt"
	"hash/fnv"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const recentMax = 12

type ProjectService struct {
	app     *application.App
	win     application.Window
	server  *Server
	chat    *Chat
	mu      sync.Mutex
	queue   []string // paths the OS asked us to open, drained by the frontend
	workW   int      // the window's working size, kept while the launcher is up
	workH   int
	working bool     // the window is sized for work, not the launcher
	popup   []string // the ids of the native menu that is up, by item
}

// pendingOpen: the OS (or argv) already handed us something to open.
func (p *ProjectService) pendingOpen() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.queue) > 0
}

// rooted joins rel under root, refusing anything that could escape.
func rooted(root, rel string) (string, error) {
	if root == "" {
		return "", errors.New("no project open")
	}
	if rel == "" || filepath.IsAbs(rel) || strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, "\\") {
		return "", fmt.Errorf("bad path %q", rel)
	}
	for _, seg := range strings.Split(rel, "/") {
		if seg == ".." {
			return "", fmt.Errorf("bad path %q", rel)
		}
	}
	return filepath.Join(root, filepath.FromSlash(rel)), nil
}

// listFiles finds every .fart and .shart below root, as sorted slash-relative paths.
// Dotfiles, node_modules and the .fart~ checkpoints stay out of the shelf.
func listFiles(root string) ([]string, error) {
	out := []string{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if path != root && strings.HasPrefix(name, ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() && name == "node_modules" {
			return filepath.SkipDir
		}
		if !d.IsDir() && (strings.HasSuffix(name, ".fart") || strings.HasSuffix(name, ".shart")) {
			rel, rerr := filepath.Rel(root, path)
			if rerr == nil {
				out = append(out, filepath.ToSlash(rel))
			}
		}
		return nil
	})
	sort.Strings(out)
	return out, err
}

// ------------------------------------------------------------- folders

// Log prints a line from the page into the shell's log (a debugging aid).
func (p *ProjectService) Log(msg string) {
	log.Printf("page: %s", msg)
}

// PickFolder shows the platform's folder dialog. "" means cancelled.
func (p *ProjectService) PickFolder() (string, error) {
	dlg := p.app.Dialog.OpenFile().
		SetTitle("Open a project folder").
		CanChooseDirectories(true).
		CanChooseFiles(false).
		CanCreateDirectories(true)
	if p.win != nil {
		dlg.AttachToWindow(p.win)
	}
	path, err := dlg.PromptForSingleSelection()
	log.Printf("pick folder: %q err=%v", path, err)
	return path, err
}

func (p *ProjectService) IsDir(path string) bool {
	fi, err := os.Stat(path)
	return err == nil && fi.IsDir()
}

func (p *ProjectService) Home() string {
	h, _ := os.UserHomeDir()
	return h
}

// DefaultRoot is the terminal's directory when the studio was launched
// from one; launched from the Finder (cwd / or the home folder) it is "",
// and the welcome screen takes over.
func (p *ProjectService) DefaultRoot() string {
	cwd, err := os.Getwd()
	if err != nil || cwd == "/" || cwd == p.Home() {
		return ""
	}
	// the fastart checkout and its studio folder are where the app is
	// built from (make dev runs there), never a project: a "new file" would
	// land in the source tree
	if isCheckout(cwd) || isCheckout(filepath.Dir(cwd)) {
		return ""
	}
	return cwd
}

// ------------------------------------------------------------- files

func (p *ProjectService) ListFiles(root string) ([]string, error) {
	if root == "" {
		return nil, errors.New("no project open")
	}
	return listFiles(root)
}

// Stamp is a short word that changes whenever the project's files do:
// one added, removed, renamed or written, by this app or by anything
// else. The navigator asks for it every couple of seconds and re-reads
// the folder when it differs. One walk, no file opened.
func (p *ProjectService) Stamp(root string) (string, error) {
	if root == "" {
		return "", errors.New("no project open")
	}
	return stampOf(root)
}

func stampOf(root string) (string, error) {
	files, err := listFiles(root)
	if err != nil {
		return "", err
	}
	h := fnv.New64a()
	for _, rel := range files {
		fi, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil {
			continue
		}
		fmt.Fprintf(h, "%s\x00%d\x00%d\n", rel, fi.ModTime().UnixNano(), fi.Size())
	}
	return fmt.Sprintf("%d:%016x", len(files), h.Sum64()), nil
}

// Kinds is every file of the project and what it is ("2D", "3D",
// "palette", "scene", "3D scene"), without parsing any of them.
func (p *ProjectService) Kinds(root string) (map[string]FileInfo, error) {
	files, err := listFiles(root)
	if err != nil {
		return nil, err
	}
	return kindsOf(root, files), nil
}

func (p *ProjectService) ReadFile(root, rel string) (string, error) {
	full, err := rooted(root, rel)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// imageTypes are the pictures a model can have pinned behind it as a
// reference, by extension.
var imageTypes = map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}

// ReadImage is an image file of the project as a data URL, for a
// reference image behind a model. Only pictures: anything else is refused.
func (p *ProjectService) ReadImage(root, rel string) (string, error) {
	full, err := rooted(root, rel)
	if err != nil {
		return "", err
	}
	mime, ok := imageTypes[strings.ToLower(filepath.Ext(full))]
	if !ok {
		return "", errors.New("not an image: " + rel)
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return "", err
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func (p *ProjectService) Exists(root, rel string) bool {
	full, err := rooted(root, rel)
	if err != nil {
		return false
	}
	_, err = os.Stat(full)
	return err == nil
}

// writeAtomic puts text at full in one step: a sibling temp file, then a
// rename, so a watcher (a game hot-reloading its art) never sees half a
// file, and the mtime is always new.
func writeAtomic(full string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(full), "."+filepath.Base(full)+".*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(name)
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		_ = os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(name)
		return err
	}
	_ = os.Chmod(name, 0o644)
	if err := os.Rename(name, full); err != nil {
		_ = os.Remove(name)
		return err
	}
	return nil
}

// WriteFile writes text under root, creating folders on the way ("enemies/bat.fart").
func (p *ProjectService) WriteFile(root, rel, text string) error {
	full, err := rooted(root, rel)
	if err != nil {
		return err
	}
	return writeAtomic(full, []byte(text))
}

// Stat says whether rel exists under root and when it was last written (unix ms).
func (p *ProjectService) Stat(root, rel string) Text {
	full, err := rooted(root, rel)
	if err != nil {
		return Text{}
	}
	fi, err := os.Stat(full)
	if err != nil {
		return Text{}
	}
	return Text{Text: fmt.Sprint(fi.ModTime().UnixMilli()), Found: true}
}

// Caps: what this machine can do with files (see files.go).
func (p *ProjectService) Caps() Caps {
	return caps()
}

// Remove takes a file out of the project: to the Trash where there is
// one, else deleted. Returns "trash" or "deleted".
func (p *ProjectService) Remove(root, rel string) (string, error) {
	full, err := rooted(root, rel)
	if err != nil {
		return "", err
	}
	return removeFile(full)
}

// Rename moves a file within the project ("hero.fart" to "enemies/boss.fart").
func (p *ProjectService) Rename(root, from, to string) error {
	a, err := rooted(root, from)
	if err != nil {
		return err
	}
	b, err := rooted(root, to)
	if err != nil {
		return err
	}
	return renameFile(a, b)
}

// Duplicate copies a file beside itself and returns the copy's relative path.
func (p *ProjectService) Duplicate(root, rel string) (string, error) {
	full, err := rooted(root, rel)
	if err != nil {
		return "", err
	}
	dst, err := duplicateFile(full)
	if err != nil {
		return "", err
	}
	out, err := filepath.Rel(root, dst)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(out), nil
}

// Reveal shows a file or folder in the system's file browser; "" is the project itself.
func (p *ProjectService) Reveal(root, rel string) error {
	if root == "" {
		return errors.New("no project open")
	}
	full := root
	if rel != "" {
		var err error
		if full, err = rooted(root, rel); err != nil {
			return err
		}
	}
	return revealPath(full)
}

// ------------------------------------------------------------- recents

// The same file the classic editor keeps, so the two agree on history.
func recentsPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "fastart", "recent.txt"), nil
}

func (p *ProjectService) Recents() []string {
	path, err := recentsPath()
	if err != nil {
		return []string{}
	}
	f, err := os.Open(path)
	if err != nil {
		return []string{}
	}
	defer f.Close()
	out := []string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() && len(out) < recentMax {
		line := strings.TrimSpace(sc.Text())
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

func saveRecents(list []string) {
	path, err := recentsPath()
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, []byte(strings.Join(list, "\n")+"\n"), 0o644)
}

func without(list []string, item string) []string {
	out := list[:0:0]
	for _, x := range list {
		if x != item {
			out = append(out, x)
		}
	}
	return out
}

func (p *ProjectService) PushRecent(root string) []string {
	list := append([]string{root}, without(p.Recents(), root)...)
	if len(list) > recentMax {
		list = list[:recentMax]
	}
	saveRecents(list)
	return list
}

func (p *ProjectService) ForgetRecent(root string) []string {
	list := without(p.Recents(), root)
	saveRecents(list)
	return list
}

// ------------------------------------------------------------- opens

// queueOpen records a path the OS handed us (a Finder double-click, a
// second launch with arguments) and tells a running frontend to drain it.
func (p *ProjectService) queueOpen(path string) {
	log.Printf("open: %s", path)
	p.mu.Lock()
	p.queue = append(p.queue, path)
	p.mu.Unlock()
	if p.app != nil {
		p.app.Event.Emit("open-files", path)
	}
	if p.win != nil {
		p.win.Focus()
	}
}

// queueArgs takes command-line arguments (relative to wd) as opens.
func (p *ProjectService) queueArgs(args []string, wd string) {
	for _, a := range args {
		if a == "" || strings.HasPrefix(a, "-") {
			continue
		}
		if !filepath.IsAbs(a) {
			a = filepath.Join(wd, a)
		}
		p.queueOpen(a)
	}
}

func (p *ProjectService) DrainOpenQueue() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := p.queue
	p.queue = nil
	if out == nil {
		out = []string{}
	}
	return out
}

// ------------------------------------------------------------- serve

func (p *ProjectService) Serve(root string) (ServeInfo, error) {
	if root == "" {
		return ServeInfo{}, errors.New("no project open")
	}
	return p.server.Start(root)
}

func (p *ProjectService) ServeStatus() ServeInfo {
	return p.server.Info()
}

func (p *ProjectService) ServeStop() {
	p.server.Stop()
}
