---
name: crewroom-report
description: Tell the crewroom deck what you are working on. Use at the start and end of a task when you are working as one of the user's named workers (Writer, Editor, Developer...) and crewroom's hook can't see you, for example in Cowork, Codex or a script.
---

# crewroom-report

crewroom shows the user's AI workers on a pixel deck. Claude Code sessions report on their own. Anywhere else, you report by writing one small text file.

## How

Write a new `.txt` file into the inbox folder. The user's default is `~/.crewroom/inbox` (on Windows `C:\Users\<name>\.crewroom\inbox`); their config may set another folder. Use a new file name each time, like `<unix-ms>.txt`. If your tool creates a file and fills it in two steps, write it as `.tmp` first and rename it to `.txt`. The file holds one line:

```
<Worker> <status>: <what, under 80 characters>
```

Status is one of:
- `start` when you begin a task
- `done` when you finish
- `waiting` when you need the user to answer or approve something
- `note` for a one-off update (shows for a minute)

Examples:

```
Writer start: drafting 3 caption options
Writer waiting: pick a caption
Writer done: captions sent for review
Editor note: exported v3 thumbnail
```

If you can run commands, `crewroom report Writer start drafting 3 caption options` does the same.

## Rules

- Use the worker name the user gave the role. If you don't know it, ask once, or use your role's plain name.
- Keep the text short and plain. No secrets, passwords, file contents or private client details: the deck may be shown to other people later.
- One `start` and one `done` per task is enough. Don't report every step.
- If the folder doesn't exist or you can't write there, skip reporting and carry on with the task.
