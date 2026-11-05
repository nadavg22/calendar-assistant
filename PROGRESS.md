# Progress

Full plan: see CLAUDE.md for decisions. Stop after each step so the owner can test.

## 1. Project setup
- [x] CLAUDE.md, PROGRESS.md, .gitignore
- [x] clasp installed in the project (run as `npx clasp`)
- [x] Manifest and Config Sheet setup code written
- [x] Owner: Apps Script API enabled, `npx clasp login` done
- [x] Apps Script project created and code pushed
- [x] Owner: `setupConfigSheet` run, Sheet checked

## 2. Calendars
- [x] Studio and Rehearsal space shared with the owner's main Google account
- [x] Calendar IDs in the Sheet
- [x] Routing: owner names the calendar; inferred calendars need confirmation (see CLAUDE.md)
- [x] Calendar tools, `find_free_slots`, colors, reminders written and pushed; slot logic passes `node scripts/test-slots.js`
- [x] Editor tests pass (all five, colors and reminders checked in Google Calendar)

## 3. Claude connection
- [x] Owner: API key pasted into Script Properties, monthly limit set in Console
- [x] `ai.gs`, routing, caching, agent loop, web search, confirmations written and pushed; rules pass `node scripts/test-agent.js` with a fake Claude
- [x] English and Hebrew editor tests pass
- [x] Cache hits confirmed: about 6,470 cached tokens per round. Each model has its own cache

## 4. Web app
- [x] `doPost`, token, daily cap, settings actions, limit error codes; pass `node scripts/test-agent.js`
- [x] Deployed with a fixed URL (ID in gitignored `.deployment-id`; update with `sh scripts/deploy.sh`)
- [x] Owner: `setupAccessToken` run
- [x] curl: wrong token rejected through the redirect, CORS header present
- [x] Local browser test page passes (`scripts/test-backend.html`)

## 5. PWA
- [x] Chat screen, Settings screen, installability built in `docs/`; previewed in Chrome at 390px, light and dark, with a fake backend
- [x] `scripts/check-secrets.sh` written, also runs as a git pre-commit hook
- [ ] GitHub repo created, first commit pushed, Pages published
- [ ] Added to Home Screen, token entered in the installed app

## 6. Final checklist
- [ ] Hebrew input
- [ ] Relative dates
- [ ] "3 workouts this week"
- [ ] Calendar routing
- [ ] Colors and reminders applied
- [ ] Follow-up correction
- [ ] Confirmation flow
- [ ] Wrong token rejected
- [ ] Owner: 2-step verification confirmed on all three Google accounts

## Notes for the next session
- GitHub username: nadavg22. App address will be nadavg22.github.io/calendar-assistant.
- Gym is a sample row; replace it with Auto-fill from web once the app exists.
- Color rules are samples; the owner picks real ones in Settings.
- Owner wants a dismissable popup in the app when the AI stops: separate clear messages (Hebrew or English) for daily cap reached, Anthropic monthly spend limit reached, and credit exhausted. Backend must detect these in step 4, PWA shows them in step 5. Settings and Confirm keep working.
