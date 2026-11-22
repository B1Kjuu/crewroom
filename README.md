# crewroom

A pixel-art spaceship deck that shows your AI workers live. One crewmember per role, not per session.

Say your Claude Code setup has an editor skill, a writing skill and a dev skill. When a session calls the editor skill, the Editor walks to their console and starts typing. When Claude stops, they head to the lounge. When Claude needs you, they turn around and wave.

Status: phase 3. Set up in a minute, lay out your own deck, draw your own crew. One machine only. Not on npm yet, so run it from a clone.

## Quick start

Needs Node 22.12 or newer.

```sh
git clone https://github.com/B1Kjuu/crewroom.git
cd crewroom
npm install
npm run build
node bin/crewroom.js init
node bin/crewroom.js start
```

`init` reads the names and descriptions of your Claude Code skills, including the ones that come with plugins (nothing else, no AI), and suggests a crew: a Developer for your coding skills, an Editor for your video skills, and so on. Or start from a preset: `solo-dev`, `creator`, `agency`. It shows the crew, asks before writing `~/.crewroom/office.config.json` (your old one is backed up), then offers to add the Claude Code hook. The hook install shows what it adds to `~/.claude/settings.json`, keeps your other hooks and saves a backup first.

`start` opens the deck at http://127.0.0.1:47321. New Claude Code sessions show up on it. Edit the config and the deck reloads on save.

## Commands

| Command | What it does |
| --- | --- |
| `init [--preset NAME] [--yes] [--hook] [--config PATH] [--skills-dir DIR]` | Set up your crew. `--yes` writes the config without asking; only `--hook` lets it add the Claude Code hook too |
| `start [--port N] [--config PATH] [--no-open]` | Start the bridge and open the deck |
| `hooks install [--yes]` | Add crewroom's hook to Claude Code |
| `hooks uninstall [--yes]` | Remove only crewroom's hook |
| `hooks status` | Show which hook events are installed |
| `config check [PATH]` | Check a config file |
| `report <worker> [status] <text>` | Tell the deck what a worker is doing |

## Config

One file, `~/.crewroom/office.config.json`. A full example lives in [examples/kil.office.config.json](examples/kil.office.config.json).

```json
{
  "office": { "name": "My crew deck", "setting": "crew-deck" },
  "workers": [
    { "id": "editor", "name": "Editor", "sprite": "crew-2", "color": "#3aa7ff", "home": "console-2" }
  ],
  "rules": [
    { "worker": "editor", "when": { "skill": "my-editor-skill" } },
    { "worker": "editor", "when": { "command": "ffmpeg*" }, "action": "rendering" }
  ],
  "fallback": "per-session",
  "actions": { "rendering": { "label": "rendering", "anim": "run" } }
}
```

- **workers**: up to 8. `sprite` is `crew-1` to `crew-8` or `custom:<name>` (see below), `home` is `console-1` to `console-8`, `color` tints the uniform.
- **rules**: checked top to bottom, first match wins. `when` keys are `skill`, `tool`, `command`, `path` and `cwd`. Each takes a string or a list, and `*` is a wildcard. In `path` and `cwd`, `**` crosses folders, and `EDITS/**` matches any `EDITS` folder at any depth. Windows `\` paths work.
- A session stays with its worker until another rule matches. So after the editor skill runs, its Bash and Edit calls still animate the Editor.
- **fallback**: `"per-session"` gives each unmatched session its own crewmember. A worker id sends them all to that worker.
- **actions**: optional names for a rule's `action`, with a label and an animation (`type`, `read`, `run`, `think` or `wait`).

## Your own deck

Click **Edit layout** on the deck. Pick a tile (floor, wall, window, dash, console, sofa, plant, coffee machine, door) and click or drag to paint. Crew stand on the floor below each console (top-left first, up to 8), sit in front of sofas (up to 4) and come in at the door. The editor marks those spots and won't save a deck where the door can't reach one of them. **Save** writes `~/.crewroom/layout.json`; **Use built-in deck** goes back. **Export** and **Import** share layouts as JSON. A worker whose console doesn't exist in your layout waits in the lounge.

To keep a layout somewhere else, set `"layout": "~/decks/mine.json"` in the config; the editor then saves there.

## Your own crew

Draw a crewmember as a PNG sheet, 64 x 216 pixels: four 16 x 24 frames across, nine rows down, in this order:

| Row | Set | Frames |
| --- | --- | --- |
| 1 | idle (facing you) | 2 |
| 2 | walking down | 4 |
| 3 | walking up | 4 |
| 4 | walking right (left is mirrored) | 4 |
| 5 | typing at a console (back to you) | 2 |
| 6 | reading | 2 |
| 7 | running a command | 2 |
| 8 | thinking | 2 |
| 9 | waiting for you (turned around) | 2 |

Rows with 2 frames use the first two columns. Transparent pixels are empty. Paint the uniform `#888888` and its shade `#666666`; both take each worker's `color`. **Sprite template** in the layout editor downloads crew-1 in this format to draw over.

Save it as `~/.crewroom/sprites/<name>.png` (lowercase letters, digits, dashes) and set `"sprite": "custom:<name>"` on a worker. If the file is missing or the wrong size, the deck says so and draws crew-1.

## Work outside Claude Code

Claude Code's hook only sees Claude Code. Three more ways in, all local:

**Inbox folder.** Any agent that can write a file (Cowork, Codex, a script) drops a `.txt` file into `~/.crewroom/inbox` with one line:

```
Writer start: drafting 3 caption options
```

Status is `start`, `done`, `waiting` or `note` (a note shows for a minute; leave it out and you get a note). The bridge reads each file and deletes it. [skill/crewroom-report](skill/crewroom-report/SKILL.md) is a skill you can give your agents so they do this by themselves. From a terminal, `crewroom report Writer start drafting captions` writes the file for you.

**Log watcher.** Point crewroom at a change log, such as the `log.md` in a notes vault. When a new line shows up, at the top or the bottom, rules decide which worker it belongs to. Lines no rule claims are ignored, so lines your Claude Code sessions wrote don't show twice.

```json
"sources": { "log": [{ "path": "~/Documents/vault/log.md" }] },
"rules": [{ "worker": "advisor", "when": { "source": "log", "text": "*morning brief*" } }]
```

**Webhook.** `POST http://127.0.0.1:47321/report` with the header `x-crewroom-token` (from `~/.crewroom/bridge.json`, it changes every start) and a body like `{ "worker": "Editor", "status": "done", "text": "render finished" }`. Handy for n8n or a script.

Two more rule keys come with this: `source` (`claude`, `inbox`, `log` or `webhook`) and `text` (the reported text or log line, case-insensitive). The inbox and webhook are on by default; turn them off with `"sources": { "inbox": { "enabled": false }, "webhook": { "enabled": false } }`.

A phone can't reach this folder. Work you do in the Claude app on your phone only shows up if it lands in a log crewroom watches, for example after your notes vault syncs.

## Privacy

- The bridge listens on 127.0.0.1 only and checks a token that changes every start.
- The hook sends the event name, session id, working folder, tool name, skill name, the first 200 characters of a shell command, and a file path. It never sends prompts, file contents or tool output.
- Events stay in memory. The bridge writes `~/.crewroom/bridge.json` (port and token), creates the inbox folder, and writes a layout only when you press Save in the editor. It deletes inbox files after reading them and only reads the logs you list.
- If the bridge isn't running, the hook gives up in under 150 ms and Claude Code carries on.
- The deck page makes no outside requests. The art and the pixel font are drawn in code in this repo.

## Uninstall

```sh
node bin/crewroom.js hooks uninstall
```

Then delete `~/.crewroom`.

## Where things live

| Path | What |
| --- | --- |
| `src/hook/` | The hook Claude Code runs (plain Node, no dependencies) |
| `src/bridge/` | Local server, rule matching, crew state, hook install |
| `src/bridge/sources/` | Inbox folder and log watcher |
| `skill/crewroom-report/` | The skill agents follow to report themselves |
| `src/office/` | The deck: canvas renderer, side panel, layout editor, sprite sheets |
| `src/init/` | `crewroom init`: skill scan and presets |
| `src/shared/layout.ts` | Layout tiles, spots and checks |
| `src/office/settings/crew-deck/` | The spaceship art: palette, tiles, crew, map, stars |
| `src/shared/` | Event types and the config schema |
| `test/`, `e2e/` | Vitest and Playwright tests |

## Develop

```sh
npm test          # unit tests
npm run check     # lint and types
npm run e2e       # browser test (uses Edge on Windows, Chrome elsewhere)
npm run dev       # build and start
```

## License

MIT
