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

## AI Provider Configuration

Default development mode uses mock transcription and translation so CI and local
UI work without external credentials.

To enable real OpenAI-backed providers in the local API:

```bash
ECHO_BRIDGE_AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-key
ECHO_BRIDGE_OPENAI_MODE=buffered
ECHO_BRIDGE_TRANSCRIPTION_MODEL=gpt-4o-transcribe
ECHO_BRIDGE_TRANSLATION_MODEL=gpt-4.1-mini
```

Current implementation notes:

- Transcription provider buffers PCM chunks and sends them to the OpenAI
  speech-to-text API.
- Translation provider uses the Responses API with recent caption context.
- Set `ECHO_BRIDGE_OPENAI_MODE=realtime` and `ECHO_BRIDGE_REALTIME_MODEL=gpt-realtime`
  to use the OpenAI Realtime WebSocket path. In realtime mode the model is
  instructed to emit translated Chinese text directly, so the pipeline can skip
  the second translation request when transcript events already include a
  translation.
- Mock mode remains the default for demos, tests, and CI.

## Delivery Principles

- Keep pull requests small and reviewable.
- Separate product documents, platform abstractions, and feature code.
- Prefer explicit event contracts over implicit UI state sharing.
- Cover caption revision and export logic with tests before provider integration.
