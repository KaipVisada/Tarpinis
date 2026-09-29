# Team board

> **The desktop program in `../desktop-app` is the main, maintained version.** It runs this same board
> together with the DroneForge Pro ERP. The claude.ai artifact build of this folder is kept only as a
> web preview; features that need the ERP (products, stock, materials) don't work there.

A Scrum/Kanban board for managing the team's work, published as a claude.ai artifact.
Shared data lives in the artifact's database, so everyone with the link sees the same board live.

## Build

`index.html` is generated. Edit the files in `src/`, then run:

```sh
./build.sh
```

| File | What it holds |
| --- | --- |
| `src/1-head.html` | Styles and page markup (dialogs, header) |
| `src/2-core.js` | Helpers, state, the save queue (retries, survives reloads), data cleaning |
| `src/3-auth.js` | Accounts and 4-digit PINs, auto-lock |
| `src/4-task.js` | Task window: description, checklist, files, feed, worklog and timer |
| `src/4b-work.js` | Work orders: ERP product, quantity, progress bar, materials needed |
| `src/4c-production.js` | Production tab: output, finished goods, material shortages and forecast, people and product stats, Excel export |
| `src/4d-my.js` | My work: the phone page for workers (+1, report, blocked) |
| `src/4e-templates.js` | Product templates (steps, standard hours, quality items) and the quality check dialog |
| `src/5-views.js` | Overview, Board, Backlog, Team, Top 3, Insights, TV mode |
| `src/5b-standup.js` | Stand-up mode, TV production slide, alert when a task becomes blocked |
| `src/6-admin.js` | Admin: members, activity log, backups, trash, settings |
| `src/7-main.js` | Rendering, events, crash protection, startup |

## Data layout

| Path | Contents |
| --- | --- |
| `members/<id>` | Name, title, role (admin, worker, viewer), labels, weekly hours, availability, time off, PIN hash |
| `sprints/<id>` | Name, dates, goal, state |
| `tasks/<id>` | Task fields plus maps for `checklist`, `files`, `comments`, `worklogs`, `timers` and `activity` |
| `config/board`, `config/settings` | Column order; board settings |
| `log/<YYYY-MM-DD>` | Non-task events (people, sprints, sign-in, backups) |
| `backups/<id>` + `backups/<id>/parts/<n>` | Backup metadata and the data, split into parts |
| `blobs/<id>` | Small attachments for people who can't use file storage |

Deleting a task, member or sprint sets `deleted: true` (Trash) instead of removing it.

## About the PINs

PINs are stored as salted PBKDF2 hashes, never in plain text. They identify who made a change on a
shared screen. They are not strong security: a 4-digit PIN can be guessed by someone who can read
the board's data. Access to the board itself is controlled by the artifact's Share settings.
