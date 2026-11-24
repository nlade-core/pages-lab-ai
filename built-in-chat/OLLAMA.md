# Ollama from a hosted page: built, tested, parked

*2026-11-24.* The page briefly had a third option, "On your computer: Ollama", alongside the
browser's built-in model. It worked, but the setup asked of visitors is too much for a public
page, so it's removed from `main` for now. The working version is on the
[`ollama-provider`](https://github.com/nlade-core/pages-lab-ai/tree/ollama-provider/built-in-chat)
branch (commits `1c9c317`, `8d0f226`).

## What it did

- Contacted `http://127.0.0.1:11434` only after the visitor clicked **Connect**. Nothing touched
  localhost on page load, so no surprise permission prompt and no silent probing of visitors'
  machines. After a successful connect, later visits reconnected automatically (a localStorage flag).
- Listed models from `/api/tags` and kept only local chat models: dropped anything with
  `remote_host` (Ollama cloud models would send prompts off the device) and anything whose
  `capabilities` lacks `completion` (embedding and image models). 27 of 31 models kept on the test Mac.
- Defaulted to `phi4-mini`, the same model Edge ships, and remembered the visitor's pick.
- Streamed `/api/chat` (NDJSON) with `think: false`, so thinking models answer directly. Ollama is
  stateless, so the page sent the full history each turn.
- Told "Ollama is blocking this site" apart from "Ollama isn't running": a normal `fetch` fails the
  same way for both, but a `mode: 'no-cors'` request succeeds whenever something answered.

## What a visitor has to do

Three separate gates, all on the visitor's side:

1. **Ollama installed and running**, with at least one model pulled.
2. **Ollama must allow the site's origin.** By default it only accepts localhost-style origins:
   the Pages origin got `403`. Fix: `launchctl setenv OLLAMA_ORIGINS "https://nlade-core.github.io"`
   (macOS, lasts until reboot; `setx` on Windows; a systemd override on Linux), then restart Ollama.
   `setenv` replaces the value, so several origins need a comma-separated list.
3. **The browser's local-network permission.** Chrome/Edge ask "Allow … to connect to devices on
   your local network?" on the first request. Clicking **Don't allow** sticks, and the page can only
   see the result (`navigator.permissions.query({ name: 'local-network-access' })` returns `denied`),
   not undo it. Safari blocks secure pages from calling `http://localhost` outright.

Verified: chat with history on localhost (phi4-mini, ~83 tok/s), and from a LAN-IP origin once
`OLLAMA_ORIGINS` allowed it. Not verified end to end from the Pages origin in a real browser: the
permission was denied during testing.

## Why parked

Gates 2 and 3 lose almost every public visitor. The built-in browser models need no setup beyond,
at most, a flag. Ollama fits a different setting: company-managed machines, where IT can set
`OLLAMA_ORIGINS` and the browser permission by policy, so staff never see either step.

## If it comes back

- Show a specific message when the permission state is `denied`, with how to reset it.
- Keep the connect-on-click rule.
- Bump the `?v=` on `app.js` with every change: Pages caches for 10 minutes, and new HTML with
  stale cached JS left the page stuck on "Checking your browser…".
