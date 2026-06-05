# EchoBridge AI

EchoBridge AI is a Windows-first desktop simultaneous interpretation assistant.
It captures user-selected computer output audio, turns speech into live bilingual
captions, revises earlier captions when context improves, and exports session
notes after the talk.

## Product Scope

- Desktop client built with Electron, React, TypeScript, and Vite.
- Output-device oriented audio capture, designed around Windows WASAPI loopback.
- Realtime transcription and Chinese translation pipeline.
- Revision-aware caption model for correcting earlier recognition or translation.
- Post-session summary and export pipeline.

## Repository Layout

```text
apps/desktop          Electron desktop shell and React renderer
packages/audio        Audio device and capture abstractions
packages/captions     Caption model, revisions, and export helpers
packages/shared       Cross-package event and error types
packages/transcription Speech-to-text provider boundary
packages/translation  Translation and revision provider boundary
docs                  Architecture and delivery planning
```

## Development

```bash
npm install
npm run typecheck
npm run test
npm run dev
```

The first implementation uses mock audio and provider adapters so the UI,
caption state, and module contracts can be reviewed before native loopback
capture and live AI credentials are added.

## Delivery Principles

- Keep pull requests small and reviewable.
- Separate product documents, platform abstractions, and feature code.
- Prefer explicit event contracts over implicit UI state sharing.
- Cover caption revision and export logic with tests before provider integration.
