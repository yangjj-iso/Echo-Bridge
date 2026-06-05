import type { AudioCaptureSession, AudioCaptureSource } from '@echo-bridge/audio';
import { CaptionStore } from '@echo-bridge/captions';
import {
  EchoBridgeError,
  type AppEvent,
  type CaptionSegment,
  type StartSessionRequest,
} from '@echo-bridge/shared';
import type { TranscriptionProvider } from '@echo-bridge/transcription';
import type { TranslationProvider } from '@echo-bridge/translation';

export interface InterpretationPipelineOptions {
  audioSource: AudioCaptureSource;
  transcriptionProvider: TranscriptionProvider;
  translationProvider: TranslationProvider;
  captions?: CaptionStore;
}

export class InterpretationPipeline {
  readonly #audioSource: AudioCaptureSource;
  readonly #transcriptionProvider: TranscriptionProvider;
  readonly #translationProvider: TranslationProvider;
  readonly #captions: CaptionStore;
  #captureSession?: AudioCaptureSession;
  #processing = Promise.resolve();

  constructor(options: InterpretationPipelineOptions) {
    this.#audioSource = options.audioSource;
    this.#transcriptionProvider = options.transcriptionProvider;
    this.#translationProvider = options.translationProvider;
    this.#captions = options.captions ?? new CaptionStore();
  }

  async start(
    request: StartSessionRequest,
    emit: (event: AppEvent) => void,
  ): Promise<{ sessionId: string }> {
    if (this.#captureSession) {
      await this.stop(emit);
    }

    emit({ type: 'session.status', status: 'starting' });

    this.#captureSession = await this.#audioSource.start(request.deviceId, (chunk) => {
      this.#processing = this.#processing
        .then(async () => {
          const transcripts = await this.#transcriptionProvider.acceptAudio(chunk);

          for (const transcript of transcripts) {
            const caption = this.#captions.upsert({
              id: transcript.id,
              startMs: transcript.startMs,
              endMs: transcript.endMs,
              sourceText: transcript.text,
              status: transcript.isFinal ? 'final' : 'partial',
              confidence: transcript.confidence,
              revision: 0,
            });
            const translation = await this.#translationProvider.translateSegment(
              caption,
              this.#captions.list(),
            );
            const translatedCaption = this.#captions.upsert({
              ...caption,
              translatedText: translation.translatedText,
            });

            emit({ type: 'caption.upserted', caption: translatedCaption });

            for (const revision of translation.revisions) {
              const revised = this.#captions.revise(revision);
              emit({ type: 'caption.revised', revision });
              emit({ type: 'caption.upserted', caption: revised });
            }
          }
        })
        .catch((error: unknown) => {
          emit({
            type: 'app.error',
            error: normalizePipelineError(error),
          });
        });
    });

    emit({ type: 'session.status', status: 'listening' });
    return { sessionId: this.#captureSession.id };
  }

  async stop(emit?: (event: AppEvent) => void): Promise<CaptionSegment[]> {
    emit?.({ type: 'session.status', status: 'stopping' });
    await this.#captureSession?.stop();
    await this.#processing;
    await this.#transcriptionProvider.close();
    this.#captureSession = undefined;
    emit?.({ type: 'session.status', status: 'idle' });
    return this.#captions.list();
  }
}

function normalizePipelineError(error: unknown) {
  if (error instanceof EchoBridgeError) {
    return {
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
      cause: typeof error.cause === 'string' ? error.cause : undefined,
    };
  }

  return {
    code: 'UNKNOWN' as const,
    message: 'Interpretation pipeline failed.',
    recoverable: true,
    cause: error instanceof Error ? error.message : String(error),
  };
}
