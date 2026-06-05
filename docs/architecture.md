# EchoBridge AI Architecture

## Goals

EchoBridge AI is designed as a desktop AI simultaneous interpretation assistant
for English talks, technical sessions, online courses, and meetings. The product
needs to feel live, preserve enough context to correct previous mistakes, and
produce useful records after a session ends.

## System Overview

```text
Local API backend
  -> owns interpretation pipeline and AI provider clients
  -> manages realtime session state
  -> exposes REST controls, transcript records, exports, and WebSocket events

Electron main process
  -> connects desktop UI to the local API
  -> starts the embedded local API in production desktop runs
  -> owns desktop lifecycle and native integration hooks

Electron preload
  -> exposes a narrow, typed bridge to the renderer

React renderer
  -> displays controls, device state, live captions, and summaries

packages/audio
  -> enumerates output devices and exposes capture-source contracts

packages/transcription
  -> converts PCM chunks into partial/final transcript events

packages/translation
  -> translates final transcripts and proposes contextual revisions

packages/pipeline
  -> orchestrates capture, transcription, translation, and caption state

packages/captions
  -> stores caption items, revision history, summary metadata, and export formats
```

## Boundaries

The renderer does not talk directly to OpenAI or native audio APIs. API keys,
provider clients, session orchestration, and correction policy stay behind the
local API backend. The renderer receives typed application events and sends user
intents through IPC to Electron main, which forwards them to the backend.
In production desktop runs, Electron main hosts that backend in-process and
closes it with the app lifecycle. Development runs keep the backend as a
separate process for faster API iteration, and `ECHO_BRIDGE_API_URL` can point
the desktop shell at any externally managed backend.

The audio package does not know about transcription providers. It only exposes
devices, capture sessions, audio format metadata, and audio chunks.

The caption package does not know about UI components. It owns deterministic
caption state transitions, revision counters, summary generation, and export
logic.

The pipeline package owns interpretation session orchestration. The API backend
delegates the realtime flow to this package and exposes the result as a process
boundary. Electron main should only handle IPC, desktop lifecycle, backend
requests, and renderer event forwarding.

## Realtime Pipeline

1. User selects an output audio device in the desktop UI.
2. Electron main forwards the start request to the local API backend.
3. API starts an audio capture source.
4. Audio chunks stream into the transcription provider while the pipeline is
   listening.
5. Pause requests keep the capture session open but stop handing new chunks to
   the transcription provider until resume.
6. Partial transcripts update the active caption line.
7. Final transcripts are translated with recent context.
8. The translation provider may propose revisions for recent caption items.
9. API broadcasts caption upserts, revision events, and session status updates
   over WebSocket.
10. Renderer receives caption events through Electron IPC.
11. Session end triggers deterministic summary generation and export metadata.

## Desktop Views

The main workspace owns session control, device selection, realtime status,
record review, and export links. A compact always-on-top mini window can be
opened from the main workspace. The mini window uses the same preload API and
event stream, but renders only the current translated caption and source text so
it can sit beside a meeting, course, or video player.

## Session Records

The local API keeps an in-memory current-session record. Caption upsert events
are applied to that record before being broadcast to clients, so late subscribers
can fetch the latest state through `GET /sessions/current/record`. Markdown and
SRT exports are generated from the same caption model used by the live view.

When a session stops, the API persists the record as JSON under `data/sessions/`.
The persisted record includes generated summary metadata: title, short summary,
keywords, and takeaways. That runtime directory is intentionally ignored by Git.
The desktop history panel lists saved sessions from the API and can reload any
saved transcript and its summary into the record view without changing the
active realtime session.

## Windows Audio Plan

The production capture path is Windows WASAPI loopback. It allows EchoBridge AI
to monitor audio rendered by a selected output device such as speakers,
headphones, or a virtual audio endpoint. The initial repository includes a mock
source so UI and state logic can be tested without native code.

## Error Handling

Provider and capture errors should be mapped into typed app errors with a stable
`code`, human-readable `message`, and optional recoverability flag. UI components
should react to these states instead of inspecting provider exceptions.
