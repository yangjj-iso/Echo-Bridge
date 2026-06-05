# Roadmap

## PR 1: Project foundation

- Create Electron, React, TypeScript, and npm workspace skeleton.
- Define module boundaries and shared event contracts.
- Add formatting, linting, typecheck, and unit test scripts.
- Document architecture and delivery plan.

## PR 2: Separated backend shell

- Add local API process for session control and realtime event streaming.
- Keep provider credentials and AI orchestration outside the renderer.
- Connect Electron main to the backend through REST and WebSocket.

## PR 3: Desktop shell

- Implement Electron main, preload, and renderer IPC bridge.
- Add device selection and session controls.
- Render mock caption stream in the desktop UI.

## PR 4: Audio capture

- Add Windows output device enumeration.
- Implement WASAPI loopback helper boundary.
- Keep mock audio source for repeatable tests and demos.

## PR 5: Realtime AI pipeline

- Connect audio chunks to streaming speech-to-text.
- Translate final transcript segments into Chinese.
- Add backpressure and reconnect handling.

## PR 6: Caption revision

- Keep recent context window.
- Allow previous caption replacement with revision tracking.
- Add visible but quiet correction indicators.

## PR 7: Session summary and export

- Generate Chinese summaries, keywords, and takeaways.
- Export bilingual captions to Markdown and SRT.
- Add integration tests for export formatting.

## PR 8: Desktop productivity views

- Add realtime transcript record panel.
- Add always-on-top compact subtitle window.
- Keep export links available during and after sessions.

## PR 9: Session history

- Persist completed session records locally.
- Add saved-session list and restore-to-record-view workflow.
- Support Markdown and SRT export for historical sessions.

## PR 10: Windows packaging

- Configure electron-builder.
- Add release notes and demo instructions.
- Verify packaged app startup on Windows.
