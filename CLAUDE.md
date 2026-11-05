# Personal AI Calendar Assistant

A personal assistant that manages three Google Calendars through natural language (English and Hebrew), used from one app on the owner's iPhone Home Screen. The owner is a beginner programmer: build module by module, explain each step in plain language, stop for testing after each step, and ask when something is ambiguous. Give numbered click-by-click steps for anything outside the terminal.

Resume work from `PROGRESS.md`. Update it after every completed step.

## Architecture
- **Backend:** Google Apps Script in `backend/`, owned by and running as the owner's main Google account, pushed with clasp. Deployed as a web app (execute as me, anyone can reach it, every request needs the access token).
- **Frontend:** plain HTML/CSS/JS PWA in `docs/`, served by GitHub Pages from a public repo. No framework. It POSTs JSON as `Content-Type: text/plain` to avoid CORS preflight.
- **Config:** Google Sheet "Assistant Config", same owner. Its ID is in Script Property `CONFIG_SHEET_ID`.
- **AI:** Anthropic Messages API through UrlFetchApp. All provider calls live in `backend/ai.gs` so the provider can be swapped.

## Backend files
| File | Purpose |
|---|---|
| `appsscript.json` | Timezone Asia/Jerusalem, Calendar advanced service, web app settings |
| `setup.gs` | Creates the Config Sheet and tabs |
| `config.gs` | Reads and writes the Sheet, short cache |
| `calendar.gs` | List/create/update/delete, colors, reminders |
| `slots.gs` | `find_free_slots`: plain logic, no AI |
| `tools.gs` | Claude's tool definitions and dispatcher |
| `ai.gs` | All provider calls |
| `agent.gs` | Routing, agent loop, system prompt, confirmations |
| `session.gs` | Conversation memory in CacheService |
| `api.gs` | `doPost`, token check, daily cap, settings actions |
| `tests.gs` | Test functions run from the Apps Script editor |

## Key decisions
- **App only.** No iOS Shortcut, Siri, Back Tap or Action button. Input is typing, the iOS keyboard mic, or the in-app mic button (`docs/voice.js`, browser speech recognition, which Apple supports unevenly in Home Screen apps). The app does not read replies aloud.
- **Week strip:** `getWeek` reads calendars directly with no AI and doesn't count toward the daily cap.
- **Guests** are email addresses the owner gives. Anything that invites or changes guests goes through `propose_actions`, because Google emails them.
- **Models:** `claude-sonnet-5-5` for complex requests, `claude-haiku-5-5` for simple ones. `pickTier_` in `agent.gs` chooses with a keyword pattern, because an AI call to classify added about a second to every request. That model runs the whole request. Live-info questions count as complex.
- **API details (verified 2026-11-05, recheck docs before writing `ai.gs`):** header `anthropic-version: 2026-10-21`; no `temperature`; no forced `tool_choice`; web search is `web_search_20260318` at $0.01 per search; `pause_turn` means resend the assistant message unchanged; `fallbacks: "default"` on Sonnet only; web search `user_location` rejects country code IL, so send only the timezone.
- **Prompt caching:** tools and system prompt stay byte-identical between requests. Anything that changes, such as the current date, goes after the cached part.
- **Claude never computes free time.** `find_free_slots` does, using Google's FreeBusy data, so events marked Free don't block time.
- **Confirmations are enforced in code.** Deleting, moving or creating several events goes through `propose_actions`, which stores a pending action. The write tools refuse those operations otherwise. The Confirm button runs the stored action with no AI call. The owner can edit details first: `applyEdits_` allows only listed fields, never an action's type or event, and revalidates.
- **Choosing a calendar:** the owner states it. If the request names the calendar, a single event is created immediately. If the assistant inferred the calendar, it goes through `propose_actions` so the owner confirms it. If it isn't sure, it asks. `routing_hints` are optional hints only and may stay as they are.
- **Event IDs include the calendar label**, e.g. `Studio:abc123`.
- **Session memory** holds plain text plus a short list of events touched, never raw API responses (CacheService allows 100 KB per entry). About 10 turns, expires after a few hours.
- **Week** runs Sunday to Saturday. Travel buffers apply before and after a place visit.
- **Rejected requests** return `{"ok":false,"error":"unauthorized"}` after a short delay, because Apps Script can't set HTTP status codes.
- **Web app URL** is entered in the app with the token, so it stays out of the repo.

## Security rules
- The Anthropic API key and the access token live only in Script Properties. Never put the API key in the terminal environment or any local file: the owner pastes it into Script Properties themselves.
- Calendar IDs live only in the Sheet. `.clasp.json` is gitignored.
- Run `scripts/check-secrets.sh` before every commit and push. Commit or push only when the owner says so.

## Visual style
Glassmorphism on black, from the owner's reference images: soft purple and orange glows fixed behind everything, frosted glass cards with thin bright edges (`.glass`), an orange-to-purple gradient on primary actions. Montserrat for English and Heebo for Hebrew, both stored in the app. Always dark. No focus outlines on touch screens. Real `backdrop-filter` blur only on the week strip and message box, because it makes animation stutter on iPhone. The layout never resizes for the keyboard. Settings swatches show Google's real event colors. Hebrew displays right-to-left.

## Conventions
- Apps Script V8, plain functions, one responsibility per file. All Apps Script files share one global scope, so function names must be unique across files.
- Timezone is always Asia/Jerusalem.
- clasp is installed in this project, not globally (the global npm folder needs admin rights), so always run it as `npx clasp`.
- `npx clasp push` does not update the live web app. Use `sh scripts/deploy.sh`, which pushes and updates the same deployment so the URL stays fixed.
- Offline tests: `node scripts/test-slots.js` and `node scripts/test-agent.js`. Run both before deploying.
- Config is cached for an hour, so direct Sheet edits can lag. `testConfig` and settings saves clear the cache.
- Config Sheet cells are plain text, so `TRUE` and `60` come back as strings. `config.gs` must convert them.
- Config tab and column names are listed in `backend/setup.gs`, which is the source of truth.
