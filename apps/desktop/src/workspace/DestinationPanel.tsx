import { useState } from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  Radio,
  Save,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Alert, Chip, Field, KV, Panel, Spinner } from "@/workspace/ui";
import { SIMULATION_MODE } from "@/api/obs";
import { formatBytes, formatDuration, percent, validateDestination } from "@/workspace/model";
import type { WorkspaceApi } from "@/workspace/useWorkspace";

export function DestinationPanel({ api }: { api: WorkspaceApi }) {
  const { draft } = api;
  if (!draft) return null;

  const destinationError = validateDestination(draft.serverUrl, draft.serviceType);

  return (
    <Panel
      id="destination"
      title="Destination & credentials"
      icon={<Upload size={12} />}
      end={
        <Chip tone={api.streamKeyPresent ? "ok" : "warn"}>
          {api.streamKeyPresent ? "Key stored" : "No key"}
        </Chip>
      }
      foot={
        <>
          <button
            type="button"
            className="tsm-btn tsm-btn--quiet"
            onClick={() => void api.saveConnection()}
          >
            Save profile
          </button>
          <div className="tsm-panel__foot-end">
            <button
              type="button"
              className="tsm-btn tsm-btn--primary"
              onClick={() => void api.saveStreamKey()}
              disabled={api.savingKey || !api.streamKey.trim()}
            >
              {api.savingKey ? <Spinner /> : <KeyRound size={12} />}
              Save stream key
            </button>
          </div>
        </>
      }
    >
      <div className="tsm-fields tsm-fields--2">
        <Field label="Service" htmlFor="service-type">
          <select
            id="service-type"
            className="tsm-select"
            value={draft.serviceType}
            onChange={(event) => api.patchDraft({ serviceType: event.target.value })}
          >
            <option value="tango">Tango</option>
            <option value="custom">Custom RTMP</option>
          </select>
        </Field>
        <Field
          label="Server URL"
          htmlFor="server-url"
          error={destinationError}
          hint={destinationError ? undefined : "rtmp:// or rtmps:// ingest endpoint."}
        >
          <input
            id="server-url"
            className="tsm-input tsm-input--mono"
            spellCheck={false}
            value={draft.serverUrl}
            aria-invalid={Boolean(destinationError)}
            placeholder="rtmp://ingest.example/live"
            onChange={(event) => api.patchDraft({ serverUrl: event.target.value })}
          />
        </Field>
      </div>

      <Field
        label="Stream key"
        htmlFor="stream-key"
        hint={
          api.streamKeyPresent
            ? "A key is stored in the secure credential store. Changing it here overwrites the stored value on save."
            : "Nothing stored yet. The key is written to the OS credential store, never the profile JSON."
        }
      >
        <div className="tsm-input-wrap">
          <input
            id="stream-key"
            className="tsm-input tsm-input--mono"
            type={api.revealStreamKey ? "text" : "password"}
            autoComplete="new-password"
            spellCheck={false}
            value={api.streamKey}
            onChange={(event) => api.setStreamKey(event.target.value)}
            placeholder={
              api.streamKeyPresent ? "•••••••••••• (stored)" : "Paste the stream key"
            }
          />
          <button
            type="button"
            className="tsm-input-wrap__action"
            onClick={() => api.setRevealStreamKey(!api.revealStreamKey)}
            aria-label={api.revealStreamKey ? "Hide stream key" : "Show stream key"}
            aria-pressed={api.revealStreamKey}
          >
            {api.revealStreamKey ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </Field>

      {api.credentialMessage ? (
        <Alert
          tone={api.credentialMessage.tone}
          title={api.credentialMessage.title}
          simulated={api.credentialMessage.tone === "ok" && SIMULATION_MODE}
        />
      ) : null}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: "9px 11px",
          borderRadius: 9,
          background: "var(--surface-2)",
          border: "1px solid var(--hairline)",
        }}
      >
        <KV k="Profile" v={draft.name} />
        <KV k="Service type" v={draft.serviceType === "custom" ? "Custom RTMP" : "Tango"} />
        <KV k="Credential reference" v={api.activeProfile?.has_credential ? "present" : "absent"} />
        <KV k="OBS password" v={api.activeProfile?.has_obs_password ? "stored" : "not stored"} />
      </div>

      <div className="tsm-inline-note">
        <ShieldCheck size={12} aria-hidden="true" />
        <span>
          Secrets never enter profile JSON, logs, or status messages. Duplicating a profile creates
          an isolated credential reference — the copy starts without a key.
        </span>
      </div>

      {SIMULATION_MODE ? (
        <div className="tsm-inline-note" style={{ color: "var(--warn)" }}>
          <ShieldAlert size={12} aria-hidden="true" />
          <span>
            Simulated preview: keys are kept in page memory only and are never written to the
            Windows credential vault.
          </span>
        </div>
      ) : null}
    </Panel>
  );
}

export function StreamControlPanel({ api }: { api: WorkspaceApi }) {
  const { draft, streamStatus } = api;
  if (!draft) return null;

  const live = api.live;
  const startDisabled = api.starting || api.stopping || live;

  return (
    <Panel
      id="broadcast"
      title="Broadcast control"
      icon={<Radio size={12} />}
      end={
        live ? (
          <Chip tone="live" pulse>
            <span className="tsm-dot" aria-hidden="true" />
            On air
          </Chip>
        ) : (
          <Chip tone="idle">Offline</Chip>
        )
      }
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "13px 14px",
          borderRadius: 10,
          border: `1px solid ${live ? "rgba(255,77,94,0.32)" : "var(--hairline)"}`,
          background: live
            ? "linear-gradient(120deg, rgba(255,77,94,0.09), transparent 68%)"
            : "var(--surface-2)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 180px", minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 9.5,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-mute)",
              fontWeight: 600,
            }}
          >
            {live ? "Duration" : "Ready state"}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              color: live ? "var(--text)" : "var(--text-dim)",
            }}
          >
            {live ? formatDuration(streamStatus?.duration_seconds ?? 0) : "00:00:00"}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!live ? (
            <button
              type="button"
              className="tsm-btn tsm-btn--go"
              onClick={() => void api.startStreamingNow()}
              disabled={startDisabled || !api.connectionStatus.connected}
              title={
                !api.connectionStatus.connected
                  ? "Connect to OBS before going live"
                  : "Start the stream for this profile"
              }
            >
              {api.starting ? <Spinner /> : <Radio size={13} />}
              {api.starting ? "Starting" : "Go live"}
            </button>
          ) : (
            <button
              type="button"
              className="tsm-btn tsm-btn--go"
              onClick={() => void api.stopStreamingNow()}
              disabled={api.stopping}
            >
              {api.stopping ? <Spinner /> : <Save size={13} />}
              {api.stopping ? "Stopping" : "Stop broadcast"}
            </button>
          )}
        </div>
      </div>

      {api.awaitingConfirm ? (
        <Alert
          tone="info"
          title="Waiting for OBS to confirm"
          detail="The start command was accepted. The stream is only reported live once OBS status says it is active."
        />
      ) : null}

      {api.streamError ? (
        <Alert tone="danger" title="Broadcast action failed" detail={api.streamError} />
      ) : null}

      {!api.connectionStatus.connected ? (
        <Alert
          tone="warn"
          title="Connection required"
          detail="Test the OBS connection in the OBS connection panel before starting a broadcast."
        />
      ) : null}

      <div className="tsm-fields tsm-fields--2">
        <div
          style={{
            padding: "9px 11px",
            borderRadius: 9,
            background: "var(--surface-2)",
            border: "1px solid var(--hairline)",
          }}
        >
          <KV k="Destination" v={draft.serverUrl || "Not set"} />
          <KV k="Credential" v={api.streamKeyPresent ? "stored" : "missing"} />
          <KV k="Reconnecting" v={streamStatus ? (streamStatus.reconnecting ? "yes" : "no") : null} />
        </div>
        <div
          style={{
            padding: "9px 11px",
            borderRadius: 9,
            background: "var(--surface-2)",
            border: "1px solid var(--hairline)",
          }}
        >
          <KV k="Bytes sent" v={streamStatus ? formatBytes(streamStatus.bytes_sent) : null} />
          <KV k="Timecode" v={streamStatus?.timecode ?? null} />
          <KV
            k="Congestion"
            v={streamStatus && live ? percent(streamStatus.congestion) : null}
          />
        </div>
      </div>
    </Panel>
  );
}

export function HealthDashboard({ api }: { api: WorkspaceApi }) {
  const { streamStatus, live } = api;
  const simulated = SIMULATION_MODE && live;

  return (
    <Panel
      id="health"
      title="Live health & diagnostics"
      icon={<Radio size={12} />}
      end={
        <>
          {live ? (
            <Chip tone="live" pulse>
              <span className="tsm-dot" aria-hidden="true" />
              Live
            </Chip>
          ) : (
            <Chip tone="idle">Offline</Chip>
          )}
          {api.statusStale ? <Chip tone="warn">Stale</Chip> : null}
        </>
      }
    >
      <div className="tsm-health-head">
        <span style={{ fontSize: 11, color: "var(--text-mute)" }}>
          {live
            ? "Polling OBS every 1.6 s. Values below come from the last successful status read."
            : "Metrics appear only while a stream is running. Nothing is fabricated while offline."}
        </span>
        <span className="tsm-health-stamp">
          {api.lastStatusAt
            ? `updated ${new Date(api.lastStatusAt).toLocaleTimeString()}`
            : "no reads yet"}
        </span>
      </div>

      <div className="tsm-metrics">
        <Metric
          label="Status"
          value={live ? "Live" : "Offline"}
          live={live}
          accent
        />
        <Metric
          label="Duration"
          value={live && streamStatus ? formatDuration(streamStatus.duration_seconds) : null}
        />
        <Metric
          label="Output bitrate"
          value={live && streamStatus?.kbits_per_sec != null ? streamStatus.kbits_per_sec : null}
          unit="kbps"
        />
        <Metric
          label="Congestion"
          value={live && streamStatus ? percent(streamStatus.congestion) : null}
        />
        <Metric
          label="Dropped frames"
          value={live && streamStatus ? streamStatus.dropped_frames : null}
          simulated={simulated}
        />
        <Metric
          label="Total frames"
          value={live && streamStatus ? streamStatus.total_frames : null}
          simulated={simulated}
        />
        <Metric
          label="Active FPS"
          value={live && streamStatus ? streamStatus.active_fps : null}
          decimals={1}
          simulated={simulated}
        />
        <Metric
          label="Render skipped"
          value={live && streamStatus ? streamStatus.render_skipped_frames : null}
          simulated={simulated}
        />
        <Metric
          label="Render total"
          value={live && streamStatus ? streamStatus.render_total_frames : null}
          simulated={simulated}
        />
        <Metric
          label="Avg render time"
          value={live && streamStatus ? streamStatus.average_frame_render_time_ms : null}
          unit="ms"
          decimals={2}
          simulated={simulated}
        />
        <Metric
          label="CPU usage"
          value={live && streamStatus ? streamStatus.cpu_usage : null}
          unit="%"
          decimals={1}
          simulated={simulated}
        />
        <Metric
          label="Memory"
          value={live && streamStatus ? streamStatus.memory_usage_mb : null}
          unit="MB"
          decimals={0}
          simulated={simulated}
        />
      </div>

      {api.statusStale ? (
        <Alert
          tone="warn"
          title="Metrics are stale"
          detail="The last status read failed while the stream indicator is still live. Values above are older than the polling interval."
        />
      ) : null}
    </Panel>
  );
}

function Metric({
  label,
  value,
  unit,
  decimals = 0,
  accent,
  live,
  simulated,
}: {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  decimals?: number;
  accent?: boolean;
  live?: boolean;
  simulated?: boolean;
}) {
  const numeric = typeof value === "number" ? value : null;
  const missing =
    value === null ||
    value === undefined ||
    (numeric !== null && !Number.isFinite(numeric)) ||
    (typeof value === "string" && !value.trim());

  return (
    <div
      className={`tsm-metric${accent ? " tsm-metric--accent" : ""}${
        live ? " tsm-metric--live" : ""
      }`}
    >
      <span className="tsm-metric__label">{label}</span>
      <span className={`tsm-metric__value${missing ? " is-missing" : ""}`}>
        {missing
          ? "Unavailable"
          : numeric !== null
            ? numeric.toFixed(decimals)
            : String(value)}
        {!missing && unit ? <span className="tsm-metric__unit">{unit}</span> : null}
      </span>
      {simulated && !missing ? <span className="tsm-metric__sim">sim</span> : null}
    </div>
  );
}
