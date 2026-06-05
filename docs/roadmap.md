# Roadmap

## PR 1: Project foundation

- Create Electron, React, TypeScript, and npm workspace skeleton.
- Define module boundaries and shared event contracts.
- Add formatting, linting, typecheck, and unit test scripts.
- Document architecture and delivery plan.

## PR 2: Desktop shell

- Implement Electron main, preload, and renderer IPC bridge.
- Add device selection and session controls.
- Render mock caption stream in the desktop UI.

## PR 3: Audio capture

- Add Windows output device enumeration.
- Implement WASAPI loopback helper boundary.
- Keep mock audio source for repeatable tests and demos.

## PR 4: Realtime AI pipeline

- Connect audio chunks to streaming speech-to-text.
- Translate final transcript segments into Chinese.
- Add backpressure and reconnect handling.

## PR 5: Caption revision

- Keep recent context window.
- Allow previous caption replacement with revision tracking.
- Add visible but quiet correction indicators.

## PR 6: Session summary and export

- Generate Chinese summaries, keywords, and takeaways.
- Export bilingual captions to Markdown and SRT.
- Add integration tests for export formatting.

## PR 7: Windows packaging

- Configure electron-builder.
- Add release notes and demo instructions.
- Verify packaged app startup on Windows.
