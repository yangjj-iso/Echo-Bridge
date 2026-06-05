# EchoBridge AI

EchoBridge AI is a Windows-first desktop simultaneous interpretation assistant.
It captures user-selected computer output audio, turns speech into live bilingual
captions, revises earlier captions when context improves, and exports session
notes after the talk.

## Product Scope

- Desktop client built with Electron, React, TypeScript, and Vite.
- Local API backend for AI orchestration, provider credentials, and session state.
- Output-device oriented audio capture, designed around Windows WASAPI loopback.
- Realtime transcription and Chinese translation pipeline owned by the backend layer.
- Revision-aware caption model for correcting earlier recognition or translation.
- Live bilingual transcript record, compact subtitle window, and Markdown/SRT export.

## Repository Layout

```text
apps/api              Local backend API and realtime event stream
apps/desktop          Electron desktop shell and React renderer
packages/audio        Audio device and capture abstractions
packages/captions     Caption model, revisions, and export helpers
packages/pipeline     Backend realtime interpretation orchestration
packages/shared       Cross-package event and error types
packages/transcription Speech-to-text provider boundary
packages/translation  Translation and revision provider boundary
docs                  Architecture and delivery planning
```

## Current Experience

- Main desktop workspace with device selection, session controls, status metrics,
  live subtitles, and realtime bilingual record.
- Compact always-on-top mini window for watching translated subtitles while using
  another meeting, course, or video app.
- Local backend record APIs:
  - `GET /sessions/current/record`
  - `GET /sessions/current/captions`
  - `GET /sessions/current/export.md`
  - `GET /sessions/current/export.srt`
- Saved session history stored under `data/sessions/` at runtime, with API access:
  - `GET /sessions/history`
  - `GET /sessions/history/:sessionId`
  - `GET /sessions/history/:sessionId/export.md`
  - `GET /sessions/history/:sessionId/export.srt`

## Development

```bash
npm install
npm run typecheck
npm run test
npm run dev
```

`npm run dev` starts both the local API backend and the Electron desktop client.
The first implementation uses mock audio and provider adapters so the UI,
caption state, API boundary, and module contracts can be reviewed before native
loopback capture and live AI credentials are added.

## Delivery Principles

- Keep pull requests small and reviewable.
- Separate product documents, platform abstractions, and feature code.
- Prefer explicit event contracts over implicit UI state sharing.
- Cover caption revision and export logic with tests before provider integration.
