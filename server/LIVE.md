# Live generation server

The site works fully without this server: it shows ready-made subjects and a friendly "offline" note.
When the server is running and reachable, "Make your own" on the subject picker turns on, and anyone on the
live site can type a short prompt (or upload a photo) and get a fresh lesson in about 15 to 20 seconds.

## 1. Start the server (on the GPU PC)

```powershell
powershell -ExecutionPolicy Bypass -File server\run_live.ps1
```

It loads the models, builds one test pack (about 30 s), then listens on http://localhost:8000.
Check it: open http://localhost:8000/health and look for `"ok": true` and `"busy": false`.

It keeps both image pipelines (text and photo) loaded. The photo one is built on the text one's weights, so this
costs only the ControlNet, about 2.5 GB of RAM. To go back to one pipeline at a time, set
`$env:GHOSTLINES_KEEP_BOTH_PIPELINES = "0"` in run_live.ps1.

Keep the PC awake and plugged in while people use it (Windows sleep settings), and close games or other
apps that use the GPU.

## 2a. Make it reachable: Cloudflare quick tunnel (free, no account)

1. Install `cloudflared` from Cloudflare's website.
2. In a second terminal: `cloudflared tunnel --url http://localhost:8000`
3. It prints an address like `https://something-random.trycloudflare.com`. Put it in
   `web/public/live.json` as `{"url": "https://something-random.trycloudflare.com"}`, on a branch
   (e.g. `server/live-url`), then ship and merge it. The site picks it up after the deploy.
4. The address changes every time the tunnel restarts, so repeat step 3 whenever you restart it.

## 2b. Sponsor GPU credits (fill in if available)

- Provider and machine type: _to fill in_
- How the server is started there: _to fill in_
- Its public URL (goes in `web/public/live.json`): _to fill in_

## What the server allows

- `GET /health` returns `{"ok": true, "gpu": "<name>", "busy": <bool>}`.
- `POST /generate` with `{"prompt": "a teapot", "difficulty": "medium"}` or `{"imageBase64": "...", ...}`.
- One job at a time: a second request while one runs gets HTTP 503 ("busy").
- It answers within 23 seconds or returns 504, because the site stops waiting at 25 seconds.
- Prompts: 40 characters or less, letters, numbers and spaces only, checked against a blocklist, and always
  wrapped in the line-art prompt. Photos: JPEG or PNG, 5 MB or less, never stored.
- Only the live site and the local dev server may call it (CORS).
