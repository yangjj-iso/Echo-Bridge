import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  Captions,
  Download,
  Languages,
  MonitorSpeaker,
  PictureInPicture2,
  Square,
  Wand2,
} from 'lucide-react';
import { createRoot } from 'react-dom/client';

import type { AppEvent, AudioDevice, CaptionSegment, SessionStatus } from '@echo-bridge/shared';

import './styles.css';

function App() {
  const isMiniView = new URLSearchParams(window.location.search).get('view') === 'mini';
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [captions, setCaptions] = useState<CaptionSegment[]>([]);
  const [exportUrls, setExportUrls] = useState<{ markdown: string; srt: string }>();
  const [lastError, setLastError] = useState<string | undefined>();

  useEffect(() => {
    void window.echoBridge.getExportUrls().then(setExportUrls);
    void window.echoBridge.getCurrentRecord().then(({ record }) => {
      setStatus(record.status);
      setCaptions(record.captions);
    });
    void window.echoBridge.listDevices().then((items) => {
      setDevices(items);
      setSelectedDeviceId(items.find((device) => device.isDefault)?.id ?? items[0]?.id ?? '');
    });

    return window.echoBridge.onEvent((event) => {
      handleAppEvent(event, setDevices, setStatus, setCaptions, setLastError);
    });
  }, []);

  const activeCaption = captions.at(-1);
  const canStart = selectedDeviceId && (status === 'idle' || status === 'paused' || status === 'error');
  const canStop = status === 'listening' || status === 'starting';

  const revisedCount = useMemo(
    () => captions.filter((caption) => caption.status === 'revised').length,
    [captions],
  );

  async function startSession() {
    if (!selectedDeviceId) {
      return;
    }

    setLastError(undefined);
    await window.echoBridge.startSession({
      deviceId: selectedDeviceId,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      latencyMode: 'balanced',
    });
  }

  async function stopSession() {
    const finalCaptions = await window.echoBridge.stopSession();
    setCaptions(finalCaptions);
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
          <select value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)}>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </select>
        </label>

        <div className="actions">
          <button onClick={() => void window.echoBridge.openMiniWindow()}>
            <PictureInPicture2 size={18} />
            Mini
          </button>
          <button className="primary" disabled={!canStart} onClick={() => void startSession()}>
            <MonitorSpeaker size={18} />
            Start
          </button>
          <button disabled={!canStop} onClick={() => void stopSession()}>
            <Square size={17} />
            Stop
          </button>
        </div>
      </section>

      <section className="status-grid">
        <Metric icon={<Languages size={18} />} label="Language" value="English -> Chinese" />
        <Metric icon={<Captions size={18} />} label="Captions" value={String(captions.length)} />
        <Metric icon={<Wand2 size={18} />} label="Revisions" value={String(revisedCount)} />
        <Metric label="State" value={status} />
      </section>

      {lastError ? <div className="error-banner">{lastError}</div> : null}

      <section className="live-caption">
        <p className="eyebrow">Now interpreting</p>
        <h2>{activeCaption?.translatedText ?? 'Waiting for audio...'}</h2>
        <p>{activeCaption?.sourceText ?? 'Select an output device and start a session.'}</p>
      </section>

      <section className="caption-list">
        <div className="section-header">
          <div>
            <p className="eyebrow">Live record</p>
            <h2>Realtime bilingual transcript</h2>
          </div>
          <div className="export-actions">
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
    </main>
  );
}

function handleAppEvent(
  event: AppEvent,
  setDevices: (devices: AudioDevice[]) => void,
  setStatus: (status: SessionStatus) => void,
  setCaptions: Dispatch<SetStateAction<CaptionSegment[]>>,
  setLastError: (message: string | undefined) => void,
) {
  switch (event.type) {
    case 'devices.updated':
      setDevices(event.devices);
      break;
    case 'session.status':
      setStatus(event.status);
      break;
    case 'caption.upserted':
      setCaptions((current) => {
        const withoutCurrent = current.filter((caption) => caption.id !== event.caption.id);
        return [...withoutCurrent, event.caption].sort((left, right) => left.startMs - right.startMs);
      });
      break;
    case 'caption.revised':
      break;
    case 'session.summary':
      break;
    case 'app.error':
      setLastError(event.error.message);
      setStatus('error');
      break;
  }
}

function Metric({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
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

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
