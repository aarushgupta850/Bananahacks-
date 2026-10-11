# Web app rules (/web)

- Stack: Vite + React 18 + TypeScript (strict). Function components and hooks only.
- No router: App.tsx holds a screen state machine; session data lives in React context.
- Styling: plain CSS using variables from src/styles/tokens.css. No CSS frameworks.
- Design tokens: paper #FAF7F2, ink #1C1B19, one accent #3B6CFF (ghosts at 30% opacity),
  success #2E9E6A, warning #F27A5E, radius 12px, transitions 200ms ease-out.
  Headings: Fraunces. UI text: Inter. Respect prefers-reduced-motion everywhere.
- Must look good in a 1080p screen recording and work with mouse, stylus and touch, on laptop and iPad.
- Assets load via import.meta.env.BASE_URL (Pages serves the site under /Bananahacks-/).
  Pack asset paths starting with data: or http are used as-is (lib/packs.ts resolveAsset).
- Engine code (src/engine/real) is pure TypeScript: no DOM, no React, no dependencies.
  Teacher.addStroke must return in under 50 ms. Tunable numbers live in src/engine/real/config.ts.
- Never show users a raw error. Show a friendly message and a way forward.
- Accessibility: visible focus, aria-labels on icon buttons, alt text, never color alone to carry meaning.
- Tests: vitest. Keep them fast and deterministic, because a failing test blocks the deploy.
