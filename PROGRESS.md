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
- [x] GitHub repo created, first commit pushed, Pages published at nadavg22.github.io/calendar-assistant (repo email is GitHub's no-reply address)
- [x] Added to Home Screen, token entered in the installed app

## 5b. Owner's changes after first install
- [x] Redesign to the owner's glass references: black, purple and orange glow, frosted cards, Montserrat and Heebo, new icon
- [x] Focus outlines removed on touch screens
- [x] Speed: no AI classifier call, one Sheet open per request, config cached an hour, fewer tool rounds, weeks cached and prefetched. Log tab now records seconds per request
- [x] Week strip with day view
- [x] Guests (emails typed by the owner, always confirmed)
- [x] In-app mic works in English on the iPhone
- [x] Hebrew mic works on the iPhone (`voice.js` tries he-IL, he, iw-IL)
- [x] Animations: sections, week swipe, screen changes, messages, button press
- [x] Settings opens instantly from a copy saved on the phone, and refreshes behind the scenes
- [x] Week strip is a native scroll-snap scroller, motion uses a real spring curve
- [x] Stiff animations were caused by Low Power Mode, which throttles web animation on iPhone. Check that first if motion complaints return
- [x] Settings sections fold by animating `.fold` height (`foldSection`). Contents stay pre-built, which removed a 117 to 200ms stall on opening. Don't pair clip-path with transforms here: on iPhone they run separately and drift. No spring on folds, because it overshoots
- [x] Main screen keyboard confirmed good. Settings fields use the same no-slide focus (`setupFieldFocus`), to be confirmed
- [x] Keyboard: layout never resizes, chat fades behind it, only the message box rises (`--keyboard`, `.keyboard-open`). Blur limited to `.week` and `.composer` for smooth animation on iPhone

## 6. Final checklist
- [ ] Guests: invite a test address and confirm the email arrives
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
