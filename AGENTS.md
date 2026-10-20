# For agents

Anything that writes or reads `.fart` files should read
`skills/fastart/SKILL.md`: the format in one page, the conventions, the
validate → look → load workflow, and the loader APIs. It is an agent
skill for Claude Code, Codex and the ChatGPT desktop app (`make skill`
installs it to `~/.claude/skills/fastart` and `~/.agents/skills/fastart`
with this checkout's path filled in), and plain Markdown for everyone
else.

The contract is `spec/FORMAT.md`; when the skill and the spec disagree,
the spec wins and the skill has a bug. `examples/space` is a complete
sample project with the script that generated it.

Working in this repo itself: see `CLAUDE.md`.
