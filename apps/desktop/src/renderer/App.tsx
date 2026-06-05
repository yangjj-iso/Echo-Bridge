import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  Captions,
  Download,
  Languages,
  MonitorSpeaker,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Square,
  Wand2,
} from 'lucide-react';
import { createRoot } from 'react-dom/client';

import type {
  AppEvent,
  AudioDevice,
  CaptionSegment,
  LanguageCode,
  SessionHistoryItem,
  SessionRecord,
  SessionSummary,
  SessionStatus,
  StartSessionRequest,
  TargetLanguageCode,
} from '@echo-bridge/shared';

import './styles.css';

function App() {
  const isMiniView = new URLSearchParams(window.location.search).get('view') === 'mini';
  const echoBridge = useMemo(() => window.echoBridge ?? createBrowserEchoBridgeApi(), []);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState<LanguageCode>('en');
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguageCode>('zh-CN');
  const [latencyMode, setLatencyMode] = useState<StartSessionRequest['latencyMode']>('balanced');
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [captions, setCaptions] = useState<CaptionSegment[]>([]);
  const [summary, setSummary] = useState<SessionSummary>();
  const [exportUrls, setExportUrls] = useState<{ markdown: string; srt: string }>();
  const [history, setHistory] = useState<SessionHistoryItem[]>([]);
  const [viewingHistoryId, setViewingHistoryId] = useState<string | undefined>();
  const [lastError, setLastError] = useState<string | undefined>();
  const [providerMode, setProviderMode] = useState('unknown');
  const [diagnostics, setDiagnostics] =
    useState<Awaited<ReturnType<typeof echoBridge.getDiagnostics>>>();

  useEffect(() => {
    void echoBridge.getHealth().then((health) => setProviderMode(health.aiProviderMode));
    void echoBridge.getDiagnostics().then(setDiagnostics);
    void echoBridge.getExportUrls().then(setExportUrls);
    void refreshHistory();
    void echoBridge.getCurrentRecord().then(({ record }) => {
      setStatus(record.status);
      setCaptions(record.captions);
      setSummary(record.summary);
    });
    void echoBridge.listDevices().then((items) => {
      setDevices(items);
      setSelectedDeviceId(items.find((device) => device.isDefault)?.id ?? items[0]?.id ?? '');
    });

    return echoBridge.onEvent((event) => {
      handleAppEvent(event, setDevices, setStatus, setCaptions, setSummary, setLastError);
    });
  }, [echoBridge]);

  const activeCaption = captions.at(-1);
  const canStart = Boolean(selectedDeviceId) && (status === 'idle' || status === 'error');
  const canPause = status === 'listening';
  const canResume = status === 'paused';
  const canStop = status === 'listening' || status === 'starting' || status === 'paused';

  const revisedCount = useMemo(
    () => captions.filter((caption) => caption.status === 'revised').length,
    [captions],
  );

  async function startSession() {
    if (!selectedDeviceId) {
      return;
    }

    setLastError(undefined);
    setViewingHistoryId(undefined);
    setCaptions([]);
    setSummary(undefined);
    setExportUrls(await echoBridge.getExportUrls());
    setStatus('starting');

    try {
      await echoBridge.startSession({
        deviceId: selectedDeviceId,
        sourceLanguage,
        targetLanguage,
        latencyMode,
      });
      setStatus('listening');
    } catch (error) {
      setStatus('error');
      setLastError(formatError(error));
    }
  }

  async function stopSession() {
    setLastError(undefined);
    setStatus('stopping');

    try {
      const finalCaptions = await echoBridge.stopSession();
      setCaptions(finalCaptions);
      const { record } = await echoBridge.getCurrentRecord();
      setSummary(record.summary);
      setStatus('idle');
      await refreshHistory();
    } catch (error) {
      setStatus('error');
      setLastError(formatError(error));
    }
  }

  async function pauseSession() {
    setLastError(undefined);

    try {
      await echoBridge.pauseSession();
      setStatus('paused');
    } catch (error) {
      setLastError(formatError(error));
    }
  }

  async function resumeSession() {
    setLastError(undefined);

    try {
      await echoBridge.resumeSession();
      setStatus('listening');
    } catch (error) {
      setLastError(formatError(error));
    }
  }

  async function refreshHistory() {
    const { sessions } = await echoBridge.listHistory();
    setHistory(sessions);
  }

  async function loadHistory(sessionId: string) {
    const [{ record }, urls] = await Promise.all([
      echoBridge.getHistoryRecord(sessionId),
      echoBridge.getHistoryExportUrls(sessionId),
    ]);
    setViewingHistoryId(sessionId);
    setCaptions(record.captions);
    setSummary(record.summary);
    setExportUrls(urls);
  }

  async function restoreCurrentRecord() {
    const [{ record }, urls] = await Promise.all([
      echoBridge.getCurrentRecord(),
      echoBridge.getExportUrls(),
    ]);
    setViewingHistoryId(undefined);
    setStatus(record.status);
    setCaptions(record.captions);
    setSummary(record.summary);
    setExportUrls(urls);
  }

  if (isMiniView) {
    return (
      <main className="mini-shell">
        <div className="mini-status">
          <span>{status}</span>
          <strong>{captions.length}</strong>
        </div>
        <section className="mini-caption">
          <h1>{activeCaption?.translatedText ?? 'Waiting for captions...'}</h1>
          <p>{activeCaption?.sourceText ?? 'Start a session in the main window.'}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="control-panel">
        <div>
          <p className="eyebrow">EchoBridge AI</p>
          <h1>Live interpretation workspace</h1>
        </div>

        <label className="field">
          <span>Output device</span>
          <select
            value={selectedDeviceId}
            onChange={(event) => setSelectedDeviceId(event.target.value)}
          >
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </select>
        </label>

        <div className="actions">
          <button onClick={() => void echoBridge.openMiniWindow()}>
            <PictureInPicture2 size={18} />
            Mini
          </button>
          <button className="primary" disabled={!canStart} onClick={() => void startSession()}>
            <MonitorSpeaker size={18} />
            Start
          </button>
          <button disabled={!canPause} onClick={() => void pauseSession()}>
            <Pause size={17} />
            Pause
          </button>
          <button disabled={!canResume} onClick={() => void resumeSession()}>
            <Play size={17} />
            Resume
          </button>
          <button disabled={!canStop} onClick={() => void stopSession()}>
            <Square size={17} />
            Stop
          </button>
        </div>
      </section>

      <section className="session-settings">
        <label className="field">
          <span>Source language</span>
          <select
            value={sourceLanguage}
            onChange={(event) => setSourceLanguage(event.target.value as LanguageCode)}
          >
            <option value="en">English</option>
            <option value="auto">Auto detect</option>
          </select>
        </label>
        <label className="field">
          <span>Target language</span>
          <select
            value={targetLanguage}
            onChange={(event) => setTargetLanguage(event.target.value as TargetLanguageCode)}
          >
            <option value="zh-CN">Chinese</option>
          </select>
        </label>
        <label className="field">
          <span>Latency mode</span>
          <select
            value={latencyMode}
            onChange={(event) =>
              setLatencyMode(event.target.value as StartSessionRequest['latencyMode'])
            }
          >
            <option value="low">Low latency</option>
            <option value="balanced">Balanced</option>
            <option value="accurate">Accurate</option>
          </select>
        </label>
      </section>

      <section className="status-grid">
        <Metric
          icon={<Languages size={18} />}
          label="Language"
          value={`${formatLanguage(sourceLanguage)} -> ${formatLanguage(targetLanguage)}`}
        />
        <Metric icon={<Captions size={18} />} label="Captions" value={String(captions.length)} />
        <Metric icon={<Wand2 size={18} />} label="Revisions" value={String(revisedCount)} />
        <Metric label="Provider" value={providerMode} />
        <Metric label="State" value={status} />
      </section>

      {lastError ? <div className="error-banner">{lastError}</div> : null}

      {diagnostics ? (
        <section className="diagnostics-panel">
          <DiagnosticItem
            label="Audio"
            ready={diagnostics.audio.ready}
            message={diagnostics.audio.message}
          />
          <DiagnosticItem
            label="AI"
            ready={diagnostics.ai.ready}
            message={diagnostics.ai.message}
          />
          <DiagnosticItem
            label="Mode"
            ready={diagnostics.ok}
            message={`${diagnostics.ai.provider} / ${diagnostics.ai.mode}`}
          />
        </section>
      ) : null}

      <section className="live-caption">
        <p className="eyebrow">Now interpreting</p>
        <h2>{activeCaption?.translatedText ?? 'Waiting for audio...'}</h2>
        <p>{activeCaption?.sourceText ?? 'Select an output device and start a session.'}</p>
      </section>

      {summary ? (
        <section className="summary-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Session summary</p>
              <h2>{summary.title}</h2>
            </div>
          </div>
          <div className="summary-body">
            <p>{summary.summary}</p>
            {summary.keywords.length > 0 ? (
              <div className="keyword-list">
                {summary.keywords.map((keyword) => (
                  <span key={keyword}>{keyword}</span>
                ))}
              </div>
            ) : null}
            {summary.takeaways.length > 0 ? (
              <ul className="takeaway-list">
                {summary.takeaways.map((takeaway) => (
                  <li key={takeaway}>{takeaway}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="caption-list">
        <div className="section-header">
          <div>
            <p className="eyebrow">{viewingHistoryId ? 'History record' : 'Live record'}</p>
            <h2>
              {viewingHistoryId ? 'Saved bilingual transcript' : 'Realtime bilingual transcript'}
            </h2>
          </div>
          <div className="export-actions">
            {viewingHistoryId ? (
              <button onClick={() => void restoreCurrentRecord()}>
                <RotateCcw size={16} />
                Current
              </button>
            ) : null}
            <a className="export-link" href={exportUrls?.markdown} target="_blank" rel="noreferrer">
              <Download size={16} />
              Markdown
            </a>
            <a className="export-link" href={exportUrls?.srt} target="_blank" rel="noreferrer">
              <Download size={16} />
              SRT
            </a>
          </div>
        </div>
        {captions.map((caption) => (
          <article key={caption.id} className="caption-row">
            <time>{formatTime(caption.startMs)}</time>
            <div>
              <p className="source">{caption.sourceText}</p>
              <p className="translation">{caption.translatedText}</p>
            </div>
            <span className={caption.status === 'revised' ? 'badge revised' : 'badge'}>
              {caption.status}
            </span>
          </article>
        ))}
        {captions.length === 0 ? (
          <div className="empty-record">No captions recorded yet.</div>
        ) : null}
      </section>

      <section className="history-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">History</p>
            <h2>Saved sessions</h2>
          </div>
          <button onClick={() => void refreshHistory()}>Refresh</button>
        </div>
        <div className="history-list">
          {history.map((item) => (
            <button
              key={item.sessionId}
              className={
                item.sessionId === viewingHistoryId ? 'history-item active' : 'history-item'
              }
              onClick={() => void loadHistory(item.sessionId)}
            >
              <span>{formatDate(item.startedAt)}</span>
              <strong>{item.title ?? `${item.captionCount} captions`}</strong>
              <em>{formatDuration(item.durationMs)}</em>
            </button>
          ))}
          {history.length === 0 ? <div className="empty-record">No saved sessions yet.</div> : null}
        </div>
      </section>
    </main>
  );
}

function createBrowserEchoBridgeApi(): Window['echoBridge'] {
  const apiBaseUrl = 'http://127.0.0.1:4317';
  const eventsUrl = apiBaseUrl.replace(/^http/, 'ws') + '/events';

  return {
    getHealth() {
      return requestJson(`${apiBaseUrl}/health`);
    },
    getDiagnostics() {
      return requestJson(`${apiBaseUrl}/diagnostics`);
    },
    async listDevices() {
      const payload = await requestJson<{ devices: AudioDevice[] }>(`${apiBaseUrl}/devices`);
      return payload.devices;
    },
    startSession(request) {
      return requestJson<{ sessionId: string }>(`${apiBaseUrl}/sessions`, {
        method: 'POST',
        body: JSON.stringify(request),
      });
    },
    async pauseSession() {
      await requestJson(`${apiBaseUrl}/sessions/pause`, {
        method: 'POST',
      });
    },
    async resumeSession() {
      await requestJson(`${apiBaseUrl}/sessions/resume`, {
        method: 'POST',
      });
    },
    async stopSession() {
      const payload = await requestJson<{
        captions: CaptionSegment[];
        summary?: SessionSummary;
      }>(`${apiBaseUrl}/sessions/stop`, {
        method: 'POST',
      });
      return payload.captions;
    },
    getCurrentRecord() {
      return requestJson<{ record: SessionRecord; stats: unknown }>(
        `${apiBaseUrl}/sessions/current/record`,
      );
    },
    async getExportUrls() {
      return {
        markdown: `${apiBaseUrl}/sessions/current/export.md`,
        srt: `${apiBaseUrl}/sessions/current/export.srt`,
      };
    },
    listHistory() {
      return requestJson<{ sessions: SessionHistoryItem[] }>(`${apiBaseUrl}/sessions/history`);
    },
    getHistoryRecord(sessionId) {
      return requestJson(`${apiBaseUrl}/sessions/history/${encodeURIComponent(sessionId)}`);
    },
    async getHistoryExportUrls(sessionId) {
      const encoded = encodeURIComponent(sessionId);
      return {
        markdown: `${apiBaseUrl}/sessions/history/${encoded}/export.md`,
        srt: `${apiBaseUrl}/sessions/history/${encoded}/export.srt`,
      };
    },
    async openMiniWindow() {},
    onEvent(listener) {
      const socket = new WebSocket(eventsUrl);
      socket.onmessage = (event) => {
        listener(JSON.parse(event.data as string) as AppEvent);
      };
      return () => socket.close();
    },
  };
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`EchoBridge request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function DiagnosticItem({
  label,
  ready,
  message,
}: {
  label: string;
  ready: boolean;
  message: string;
}) {
  return (
    <div className="diagnostic-item">
      <span className={ready ? 'diagnostic-dot ready' : 'diagnostic-dot'} />
      <div>
        <strong>{label}</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}

function handleAppEvent(
  event: AppEvent,
  setDevices: (devices: AudioDevice[]) => void,
  setStatus: (status: SessionStatus) => void,
  setCaptions: Dispatch<SetStateAction<CaptionSegment[]>>,
  setSummary: Dispatch<SetStateAction<SessionSummary | undefined>>,
  setLastError: (message: string | undefined) => void,
) {
  switch (event.type) {
    case 'devices.updated':
      setDevices(event.devices);
      break;
    case 'session.status':
      setStatus(event.status);
      if (event.status === 'starting') {
        setCaptions([]);
        setSummary(undefined);
        setLastError(undefined);
      }
      break;
    case 'caption.upserted':
      setCaptions((current) => {
        const withoutCurrent = current.filter((caption) => caption.id !== event.caption.id);
        return [...withoutCurrent, event.caption].sort(
          (left, right) => left.startMs - right.startMs,
        );
      });
      break;
    case 'caption.revised':
      break;
    case 'session.summary':
      setSummary(event.summary);
      break;
    case 'app.error':
      setLastError(event.error.message);
      setStatus('error');
      break;
  }
}

function Metric({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      <span>{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function formatDate(value?: string): string {
  if (!value) {
    return 'Unknown time';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function formatLanguage(language: LanguageCode): string {
  switch (language) {
    case 'auto':
      return 'Auto';
    case 'en':
      return 'English';
    case 'zh-CN':
      return 'Chinese';
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : 'EchoBridge request failed.';
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
