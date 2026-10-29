import {
  Bell,
  PanelLeft,
  Radio,
  Server,
  ShieldCheck,
  Square,
  UserRound,
} from "lucide-react";
import { Chip, Spinner } from "@/workspace/ui";
import type { WorkspaceApi } from "@/workspace/useWorkspace";
import { SIMULATION_MODE } from "@/api/obs";
import { formatDuration, formatBytes } from "@/workspace/model";

interface HeaderProps {
  api: WorkspaceApi;
  onToggleRail: () => void;
  railCollapsed: boolean;
  onToggleNotices: () => void;
  noticesOpen: boolean;
  liveDuration: number;
}

export function WorkspaceHeader({
  api,
  onToggleRail,
  railCollapsed,
  onToggleNotices,
  noticesOpen,
}: HeaderProps) {
  const { activeProfile, connectionStatus, connState, live, streamStatus, starting, stopping } = api;

  const startBusy = starting || stopping;
  const canStop = live || streamStatus?.active;

  const obsTone =
    connState === "connected" ? "ok" : connState === "failed" ? "danger" : "idle";
  const obsLabel =
    connState === "connected"
      ? "OBS connected"
      : connState === "testing"
        ? "Testing OBS…"
        : connState === "failed"
          ? "OBS offline"
          : "OBS not tested";

  const durationSeconds = live ? streamStatus?.duration_seconds ?? 0 : 0;

  return (
    <header className={`tsm-header${live ? " is-live" : ""}`}>
      <button
        type="button"
        className="tsm-btn tsm-btn--ghost tsm-btn--icon"
        onClick={onToggleRail}
        aria-label={railCollapsed ? "Expand profile rail" : "Collapse profile rail"}
        aria-expanded={!railCollapsed}
      >
        <PanelLeft size={16} />
      </button>

      <div className="tsm-brand">
        <span className="tsm-brand__mark" aria-hidden="true" />
        <span>
          <span className="tsm-brand__name">Tango</span>
          <span className="tsm-brand__sub" style={{ display: "block" }}>
            Stream Manager
          </span>
        </span>
      </div>

      <div className="tsm-header__context">
        {activeProfile ? (
          <span className="tsm-header__profile" title="Active profile">
            <UserRound size={12} aria-hidden="true" />
            <strong>{activeProfile.name}</strong>
          </span>
        ) : null}

        <Chip tone={obsTone as "ok" | "danger" | "idle"} title={connectionStatus.error_message ?? undefined}>
          <span className="tsm-dot" aria-hidden="true" />
          {obsLabel}
        </Chip>

        {connState === "connected" && connectionStatus.obs_version ? (
          <Chip tone="idle" mono title="OBS version reported by the WebSocket server">
            <Server size={9} aria-hidden="true" />
            OBS {connectionStatus.obs_version}
          </Chip>
        ) : null}

        {live ? (
          <Chip tone="live" pulse>
            <span className="tsm-dot" aria-hidden="true" />
            On air
          </Chip>
        ) : null}
      </div>

      <div className="tsm-header__spacer" />

      <div className="tsm-header__actions">
        {SIMULATION_MODE ? (
          <Chip tone="warn" title="No Tauri runtime detected. All data and actions are simulated.">
            <ShieldCheck size={9} aria-hidden="true" />
            Simulated preview
          </Chip>
        ) : null}

        {live ? (
          <span className="tsm-timer">
            <span className="tsm-timer__label">Live</span>
            {formatDuration(durationSeconds)}
          </span>
        ) : null}

        {live && streamStatus ? (
          <Chip tone="idle" mono title="Current outgoing bitrate">
            <Radio size={9} aria-hidden="true" />
            {streamStatus.kbits_per_sec ? `${streamStatus.kbits_per_sec} kbps` : "—"}
          </Chip>
        ) : null}

        <button
          type="button"
          className="tsm-btn tsm-btn--quiet tsm-btn--icon"
          onClick={onToggleNotices}
          aria-label={`Notifications${api.notices.length ? `, ${api.notices.length} unread` : ""}`}
          aria-expanded={noticesOpen}
        >
          <Bell size={15} />
          {api.notices.length ? (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 5,
                right: 5,
                width: 5,
                height: 5,
                borderRadius: 99,
                background: "var(--amber)",
              }}
            />
          ) : null}
        </button>

        {canStop ? (
          <button
            type="button"
            className="tsm-btn tsm-btn--go"
            onClick={() => void api.stopStreamingNow()}
            disabled={startBusy}
          >
            {stopping ? <Spinner /> : <Square size={12} fill="currentColor" />}
            {stopping ? "Stopping" : "Stop broadcast"}
          </button>
        ) : (
          <button
            type="button"
            className="tsm-btn tsm-btn--go"
            onClick={() => void api.startStreamingNow()}
            disabled={startBusy || !activeProfile}
          >
            {starting ? <Spinner /> : <Radio size={13} />}
            {starting ? "Starting" : "Go live"}
          </button>
        )}
      </div>
    </header>
  );
}

export function NoticeStack({ api, open }: { api: WorkspaceApi; open: boolean }) {
  if (!open || !api.notices.length) return null;
  return (
    <div className="tsm-toasts" role="log" aria-live="polite">
      {api.notices.map((notice) => (
        <div key={notice.id} className={`tsm-alert tsm-alert--${notice.tone}`}>
          <div className="tsm-alert__body">
            <span className="tsm-alert__title">{notice.title}</span>
            {notice.detail ? <div className="tsm-alert__detail">{notice.detail}</div> : null}
            <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
              <button
                type="button"
                className="tsm-btn tsm-btn--ghost tsm-btn--sm"
                onClick={() => api.dismissNotice(notice.id)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function statusSummary(api: WorkspaceApi): string {
  if (!api.streamStatus) return "No stream data";
  return `${formatBytes(api.streamStatus.bytes_sent)} sent · ${formatDuration(
    api.streamStatus.duration_seconds,
  )}`;
}
