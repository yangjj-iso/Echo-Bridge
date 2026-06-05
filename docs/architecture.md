# EchoBridge AI Architecture

## Goals

EchoBridge AI is designed as a desktop AI simultaneous interpretation assistant
for English talks, technical sessions, online courses, and meetings. The product
needs to feel live, preserve enough context to correct previous mistakes, and
produce useful records after a session ends.

## System Overview

```text
Electron main process
  -> manages native audio capture
  -> owns AI provider clients
  -> persists session state

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
  -> stores caption items, revision history, and export formats
```

## Boundaries

The renderer does not talk directly to OpenAI or native audio APIs. API keys,
native helper processes, and session orchestration stay in the Electron main
process. The renderer receives typed application events and sends user intents
through IPC.

The audio package does not know about transcription providers. It only exposes
devices, capture sessions, audio format metadata, and audio chunks.

The caption package does not know about UI components. It owns deterministic
caption state transitions, revision counters, and export logic.

The pipeline package owns interpretation session orchestration. Electron main
process code should delegate the realtime flow to this package and only handle
IPC, native process lifecycle, and renderer event forwarding.

## Realtime Pipeline

1. User selects an output audio device.
2. Main process starts an audio capture source.
3. Audio chunks stream into the transcription provider.
4. Partial transcripts update the active caption line.
5. Final transcripts are translated with recent context.
6. The translation provider may propose revisions for recent caption items.
7. Renderer receives caption upserts and revision events.
8. Session end triggers summary and export generation.

## Windows Audio Plan

The production capture path is Windows WASAPI loopback. It allows EchoBridge AI
to monitor audio rendered by a selected output device such as speakers,
headphones, or a virtual audio endpoint. The initial repository includes a mock
source so UI and state logic can be tested without native code.

## Error Handling

Provider and capture errors should be mapped into typed app errors with a stable
`code`, human-readable `message`, and optional recoverability flag. UI components
should react to these states instead of inspecting provider exceptions.
