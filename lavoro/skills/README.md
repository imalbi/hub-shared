# Lavoro skills

Claude Code and Codex skills that work over Hub's MCP (`lavoro.posting`, `lavoro.shortlist`). Italian text, versioned here; nothing personal is stored in this folder.

## Setup

1. Copy `paths.example.json` to `paths.local.json` (ignored by git) and set `folder` to the folder that holds your CV sources (`.tex`) and receives the output (`candidature/`).
2. In Impostazioni > Sistema e agenti > MCP, choose Claude Code or Codex. Copy the matching connection command from Dispositivi.
3. To invoke skills by name, link them into the selected client's skill directory. Claude Code uses `~/.claude/skills/<skill>`; Codex uses `~/.agents/skills/<skill>`. For example: `ln -s <this repo>/lavoro/skills/candidatura ~/.agents/skills/candidatura`. Hub's Prepara candidatura prompt names the skill file directly for Codex, so that launch does not depend on a skill symlink.
4. For a local agent, paste the command from Dispositivi into its terminal to register Hub's MCP server. For an agent on another computer, create a token in Dispositivi and configure the client to use Hub's MCP endpoint with that token.

## Skills

- `candidatura`: tailored one-page CV (optional cover letter on request) for a posting (needs `pdflatex`, `pdfinfo`, `pdftotext`).
- `colloquio`: interview preparation for an application (`colloquio-<date>.md` beside what was sent), then an offered mock interview.
- `lacune`: skill gaps across the review and applied postings (`lacune-<date>.md`, at most 40 postings).

## Tools

`tools/pdf-pages.ts` and `tools/ats-text.ts` check a compiled PDF; their tests run with `pnpm check:modules lavoro`.
