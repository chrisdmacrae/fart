package main

// The workspace's shell needs: a project scaffolded on disk, the branch a
// project sits on (and the others it could), and the window sized for the
// launcher or for work. Git is only ever the `git` on the PATH; when a
// folder is not a repository every answer is empty and the bar hides it.

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

var projectName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._-]*$`)

// NewProject makes <parent>/<name> with an assets folder and a .gitignore
// for the checkpoints, and returns the new root. It refuses to touch a
// folder that already exists.
func (p *ProjectService) NewProject(parent, name string) (string, error) {
	name = strings.TrimSpace(name)
	if parent == "" || !filepath.IsAbs(parent) {
		return "", errors.New("choose a folder to put the project in")
	}
	if !projectName.MatchString(name) {
		return "", fmt.Errorf("%q is not a name a folder can have", name)
	}
	root := filepath.Join(parent, name)
	if _, err := os.Stat(root); err == nil {
		return "", fmt.Errorf("%s already exists", root)
	}
	if err := os.MkdirAll(filepath.Join(root, "assets"), 0o755); err != nil {
		return "", err
	}
	ignore := "# Uranus keeps a checkpoint beside every file it saves\n*.fart~\n*.shart~\n"
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte(ignore), 0o644); err != nil {
		return "", err
	}
	return root, nil
}

// PickParentFolder shows the folder dialog for a new project's home. "" means cancelled.
func (p *ProjectService) PickParentFolder() (string, error) {
	return p.PickFolderAt("Where should the project live?", "Choose")
}

// ------------------------------------------------------------- git

func git(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return "", errors.New(msg)
	}
	return strings.TrimSpace(string(out)), nil
}

// Branch is the branch the project's repository has checked out, "" when
// the folder is not in a repository (or git is not installed). A detached
// HEAD reads as its short hash.
func (p *ProjectService) Branch(dir string) string {
	if dir == "" || gitRoot(dir) == "" {
		return ""
	}
	if b, err := git(dir, "symbolic-ref", "--short", "-q", "HEAD"); err == nil && b != "" {
		return b
	}
	h, _ := git(dir, "rev-parse", "--short", "HEAD")
	return h
}

// Branches lists the repository's local branches, the current one included.
func (p *ProjectService) Branches(dir string) []string {
	if dir == "" || gitRoot(dir) == "" {
		return []string{}
	}
	out, err := git(dir, "for-each-ref", "--format=%(refname:short)", "refs/heads/")
	if err != nil || out == "" {
		return []string{}
	}
	return strings.Split(out, "\n")
}

// SwitchBranch checks a branch out. Git's own words come back when it
// refuses (uncommitted changes in the way, most often).
func (p *ProjectService) SwitchBranch(dir, name string) error {
	if dir == "" || gitRoot(dir) == "" {
		return errors.New("not a repository")
	}
	_, err := git(dir, "switch", name)
	return err
}

// NewBranch makes a branch from where the project is and switches to it.
func (p *ProjectService) NewBranch(dir, name string) error {
	if dir == "" || gitRoot(dir) == "" {
		return errors.New("not a repository")
	}
	_, err := git(dir, "switch", "-c", strings.TrimSpace(name))
	return err
}

// GitInit makes the project a repository, if it is not one already.
func (p *ProjectService) GitInit(dir string) error {
	if dir == "" || gitRoot(dir) != "" {
		return nil
	}
	_, err := git(dir, "init")
	return err
}

// GitChange is one line of `git status`: what happened to a file, and
// its path from the project's root.
type GitChange struct {
	Status string `json:"status"` // M, A, D, R or ? (untracked)
	Path   string `json:"path"`
}

// GitStatus lists what is uncommitted under the project.
func (p *ProjectService) GitStatus(dir string) []GitChange {
	out := []GitChange{}
	if dir == "" || gitRoot(dir) == "" {
		return out
	}
	// paths relative to dir, one per line, nothing quoted
	cmd := exec.Command("git", "-C", dir, "-c", "core.quotePath=false", "status", "--porcelain", "--untracked-files=all", "--", ".")
	raw, err := cmd.Output()
	if err != nil {
		return out
	}
	prefix, _ := git(dir, "rev-parse", "--show-prefix")
	for _, line := range strings.Split(strings.TrimRight(string(raw), "\n"), "\n") {
		if len(line) < 4 {
			continue
		}
		code := strings.TrimSpace(line[:2])
		path := line[3:]
		if i := strings.Index(path, " -> "); i >= 0 {
			path = path[i+4:]
		}
		path = strings.TrimPrefix(path, prefix)
		st := "M"
		switch {
		case code == "??":
			st = "A"
		case strings.Contains(code, "D"):
			st = "D"
		case strings.Contains(code, "R"):
			st = "R"
		case strings.Contains(code, "A"):
			st = "A"
		}
		out = append(out, GitChange{Status: st, Path: path})
	}
	return out
}

// GitCommit stages everything under the project and commits it.
func (p *ProjectService) GitCommit(dir, message string) error {
	if dir == "" || gitRoot(dir) == "" {
		return errors.New("not a repository")
	}
	if strings.TrimSpace(message) == "" {
		return errors.New("a commit needs a message")
	}
	if _, err := git(dir, "add", "-A", "--", "."); err != nil {
		return err
	}
	_, err := git(dir, "commit", "-m", message, "--", ".")
	return err
}

// GitProgress is a line of a clone as it runs.
type GitProgress struct {
	Message string  `json:"message"`
	Done    float64 `json:"done"` // 0..1, -1 when git did not say
}

var cloneName = regexp.MustCompile(`([^/:]+?)(\.git)?/?$`)
var clonePct = regexp.MustCompile(`(Receiving objects|Resolving deltas|Counting objects|Compressing objects):\s+(\d+)%`)

// GitClone clones url into <parent>/<name of the repository> and answers
// with the new folder. Git's progress is relayed on "git" as it comes.
func (p *ProjectService) GitClone(url, parent string) (string, error) {
	url = strings.TrimSpace(url)
	if parent == "" || !filepath.IsAbs(parent) {
		return "", errors.New("choose a folder to clone into")
	}
	m := cloneName.FindStringSubmatch(url)
	if m == nil || m[1] == "" {
		return "", errors.New("that does not look like a repository")
	}
	dest := filepath.Join(parent, m[1])
	if _, err := os.Stat(dest); err == nil {
		return "", fmt.Errorf("%s already exists", dest)
	}
	cmd := exec.Command("git", "clone", "--progress", "--", url, dest)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}
	if err := cmd.Start(); err != nil {
		return "", errors.New("git is not installed, or could not start")
	}
	var last string
	buf := make([]byte, 4096)
	for {
		n, rerr := stderr.Read(buf)
		if n > 0 {
			// git redraws its progress with carriage returns
			for _, line := range strings.FieldsFunc(string(buf[:n]), func(r rune) bool { return r == '\r' || r == '\n' }) {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				last = line
				done := -1.0
				if pm := clonePct.FindStringSubmatch(line); pm != nil {
					var pct float64
					fmt.Sscanf(pm[2], "%f", &pct)
					done = pct / 100
					if pm[1] != "Receiving objects" && pm[1] != "Resolving deltas" {
						done = -1
					}
					line = pm[1]
				}
				if p.app != nil {
					p.app.Event.Emit("git", GitProgress{Message: line, Done: done})
				}
			}
		}
		if rerr != nil {
			break
		}
	}
	if err := cmd.Wait(); err != nil {
		if last == "" {
			last = err.Error()
		}
		return "", errors.New(last)
	}
	return dest, nil
}

// ------------------------------------------------------------- window

// the launcher is a small fixed window, the way Xcode opens; the workspace
// is a working window that remembers its size while the launcher is up
const (
	launcherW, launcherH = 800, 460
	workW, workH         = 1360, 860
	workMinW, workMinH   = 960, 560
)

// WindowLauncher makes the window the launcher: small, fixed, centred.
// The size it had is kept for WindowWork.
func (p *ProjectService) WindowLauncher() {
	if p.win == nil {
		return
	}
	if p.working {
		p.workW, p.workH = p.win.Size()
	}
	p.working = false
	if p.win.IsFullscreen() {
		p.win.UnFullscreen()
	}
	p.win.SetMinSize(launcherW, launcherH)
	p.win.SetMaxSize(launcherW, launcherH)
	p.win.SetSize(launcherW, launcherH)
	p.win.SetResizable(false)
	p.win.Center()
}

// WindowWork grows the window back for a project.
func (p *ProjectService) WindowWork() {
	if p.win == nil || p.working {
		return
	}
	p.working = true
	tw, th := p.workW, p.workH
	if tw < workMinW || th < workMinH {
		tw, th = workW, workH
	}
	p.win.SetResizable(true)
	p.win.SetMaxSize(0, 0)
	p.win.SetMinSize(workMinW, workMinH)
	p.win.SetSize(tw, th)
	p.win.Center()
}

// ------------------------------------------------------------- generators

// RunGenerator runs a project's generator (a .mjs under the root, as an
// asset's meta.gen names it relative to the asset) with node, in the
// project's folder, and returns what it printed. The watcher then sees
// the files it wrote.
func (p *ProjectService) RunGenerator(root, rel string) (string, error) {
	full, err := rooted(root, rel)
	if err != nil {
		return "", err
	}
	if !strings.HasSuffix(full, ".mjs") && !strings.HasSuffix(full, ".js") {
		return "", errors.New("a generator is a .mjs file")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		return "", errors.New("node is not on the PATH: install Node to run generators")
	}
	cmd := exec.Command(node, full)
	cmd.Dir = root
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return "", errors.New(msg)
	}
	return strings.TrimSpace(string(out)), nil
}
