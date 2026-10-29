import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CloudOff, Loader2, Plus, X } from "lucide-react";
import * as api from "@/api/obs";
import {
  PRESET_LABELS,
  type QualityPresetKey,
  type ProfileSummaryDto,
} from "@/api/obs";
import "@/App.css";
import { Alert, Chip, Field, Modal, Panel, Spinner } from "@/workspace/ui";
import { useWorkspace } from "@/workspace/useWorkspace";
import { WorkspaceHeader, NoticeStack } from "@/workspace/WorkspaceHeader";
import { ProfileRail } from "@/workspace/ProfileRail";
import { ConnectionPanel } from "@/workspace/ConnectionPanel";
import { SourcePanel } from "@/workspace/SourcePanel";
import {
  QualityPanel,
  StreamingOutputPanel,
  AudioPanel,
} from "@/workspace/QualityPanel";
import {
  DestinationPanel,
  StreamControlPanel,
  HealthDashboard,
} from "@/workspace/DestinationPanel";
import { validateProfileName } from "@/workspace/model";

type Dialog =
  | { kind: "create" }
  | { kind: "rename"; profile: ProfileSummaryDto }
  | { kind: "delete"; profile: ProfileSummaryDto }
  | null;

export default function Index() {
  const w = useWorkspace();
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [narrow, setNarrow] = useState(false);

  // The rail collapses to a drawer when the viewport can no longer host it.
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const toggleRail = () => {
    if (narrow) {
      setDrawerOpen((prev) => !prev);
    } else {
      setRailCollapsed((prev) => !prev);
    }
  };

  const saveLabel = useMemo(() => {
    switch (w.saveState) {
      case "saving":
        return "Saving…";
      case "saved":
        return "Saved to profile";
      case "dirty":
        return "Unsaved changes";
      case "error":
        return "Save failed";
      default:
        return "Profile loaded";
    }
  }, [w.saveState]);

  if (w.bootLoading) {
    return (
      <div className="tsm-root">
        <div
          style={{
            flex: 1,
            display: "grid",
            placeItems: "center",
            color: "var(--text-mute)",
            gap: 10,
          }}
        >
          <div style={{ display: "grid", placeItems: "center", gap: 11 }}>
            <Loader2 size={22} className="tsm-spinner" style={{ border: 0 }} />
            <span style={{ fontSize: 12 }}>Loading streaming profiles…</span>
          </div>
        </div>
      </div>
    );
  }

  if (!w.draft) {
    return (
      <div className="tsm-root">
        <div
          style={{
            flex: 1,
            display: "grid",
            placeItems: "center",
            padding: 24,
          }}
        >
          <div style={{ maxWidth: 380, textAlign: "center", display: "grid", gap: 12 }}>
            <CloudOff size={26} style={{ margin: "0 auto", color: "var(--text-mute)" }} />
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 18,
                margin: 0,
                letterSpacing: "-0.02em",
              }}
            >
              {w.bootError ? "Profiles could not be loaded" : "No streaming profile yet"}
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-mute)" }}>
              {w.bootError ??
                "Create a profile to configure OBS, composition, quality and destination settings."}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                type="button"
                className="tsm-btn tsm-btn--primary"
                onClick={() => setDialog({ kind: "create" })}
              >
                <Plus size={13} /> New profile
              </button>
              {w.bootError ? (
                <button type="button" className="tsm-btn tsm-btn--quiet" onClick={() => void w.reload()}>
                  Retry
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {dialog?.kind === "create" ? (
          <CreateProfileDialog
            api={w}
            onClose={() => setDialog(null)}
            onCreated={(profile) => {
              setDialog(null);
              void w.selectProfile(profile.id);
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="tsm-root">
      <WorkspaceHeader
        api={w}
        onToggleRail={toggleRail}
        railCollapsed={narrow ? !drawerOpen : railCollapsed}
        onToggleNotices={() => setNoticesOpen((prev) => !prev)}
        noticesOpen={noticesOpen}
        liveDuration={w.streamStatus?.duration_seconds ?? 0}
      />

      <NoticeStack api={w} open={noticesOpen} />

      <div className="tsm-body">
        {!narrow ? (
          <ProfileRail
            api={w}
            collapsed={railCollapsed}
            onCreate={() => setDialog({ kind: "create" })}
            onRename={(profile) => setDialog({ kind: "rename", profile })}
            onDelete={(profile) => setDialog({ kind: "delete", profile })}
          />
        ) : null}

        {narrow && drawerOpen ? (
          <>
            <div className="tsm-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
            <div className="tsm-drawer" role="dialog" aria-label="Profiles">
              <div className="tsm-drawer__head">
                <span className="tsm-rail__title">Profiles</span>
                <button
                  type="button"
                  className="tsm-btn tsm-btn--ghost tsm-btn--icon"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close profile drawer"
                >
                  <X size={15} />
                </button>
              </div>
              <ProfileRail
                api={w}
                collapsed={false}
                onCreate={() => {
                  setDrawerOpen(false);
                  setDialog({ kind: "create" });
                }}
                onRename={(profile) => {
                  setDrawerOpen(false);
                  setDialog({ kind: "rename", profile });
                }}
                onDelete={(profile) => {
                  setDrawerOpen(false);
                  setDialog({ kind: "delete", profile });
                }}
              />
            </div>
          </>
        ) : null}

        <main className="tsm-main tsm-scroll">
          <div className="tsm-workspace">
            <StatusBar
              saveLabel={saveLabel}
              saveState={w.saveState}
              savedAt={w.savedAt}
              error={w.saveError}
              onRetry={() => void w.flushSave()}
            />

            <div className="tsm-grid">
              <div className="tsm-span-7">
                <div className="tsm-stack">
                  <SourcePanel api={w} />
                </div>
              </div>

              <div className="tsm-span-5">
                <div className="tsm-stack">
                  <StreamControlPanel api={w} />
                  <ConnectionPanel api={w} />
                </div>
              </div>

              <div className="tsm-span-7">
                <div className="tsm-stack">
                  <QualityPanel api={w} />
                </div>
              </div>

              <div className="tsm-span-5">
                <div className="tsm-stack">
                  <StreamingOutputPanel api={w} />
                </div>
              </div>

              <div className="tsm-span-6">
                <div className="tsm-stack">
                  <AudioPanel api={w} />
                </div>
              </div>

              <div className="tsm-span-6">
                <div className="tsm-stack">
                  <DestinationPanel api={w} />
                </div>
              </div>

              <div className="tsm-span-12">
                <HealthDashboard api={w} />
              </div>

              <div className="tsm-span-12">
                <AdaptationPanel api={w} />
              </div>
            </div>
          </div>
        </main>
      </div>

      {dialog?.kind === "create" ? (
        <CreateProfileDialog
          api={w}
          onClose={() => setDialog(null)}
          onCreated={(profile) => {
            setDialog(null);
            void w.selectProfile(profile.id);
          }}
        />
      ) : null}

      {dialog?.kind === "rename" ? (
        <RenameProfileDialog
          api={w}
          profile={dialog.profile}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "delete" ? (
        <DeleteProfileDialog
          api={w}
          profile={dialog.profile}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------- status bar ---

function StatusBar({
  saveLabel,
  saveState,
  savedAt,
  error,
  onRetry,
}: {
  saveLabel: string;
  saveState: string;
  savedAt: number | null;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        flexWrap: "wrap",
        padding: "0 2px",
      }}
    >
      <Chip
        tone={
          saveState === "error"
            ? "danger"
            : saveState === "saved"
              ? "ok"
              : saveState === "dirty"
                ? "warn"
                : "idle"
        }
      >
        {saveState === "saving" ? <Spinner /> : null}
        {saveLabel}
      </Chip>
      {savedAt ? (
        <span style={{ fontSize: 10.5, color: "var(--text-mute)" }}>
          last persisted {new Date(savedAt).toLocaleTimeString()}
        </span>
      ) : null}
      <span style={{ fontSize: 10.5, color: "var(--text-mute)", marginLeft: "auto" }}>
        {api.SIMULATION_MODE
          ? "Browser preview adapter · no native OBS calls are made"
          : "Native OBS WebSocket runtime"}
      </span>
      {error ? (
        <>
          <span style={{ fontSize: 10.5, color: "var(--danger)" }}>{error}</span>
          <button type="button" className="tsm-btn tsm-btn--quiet tsm-btn--sm" onClick={onRetry}>
            Retry save
          </button>
        </>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------- adaptation panel ---

function AdaptationPanel({ api }: { api: ReturnType<typeof useWorkspace> }) {
  const { draft } = api;
  if (!draft) return null;
  const a = draft.adaptation;
  const blocked = !draft.quality.dynamic_bitrate_enabled;

  return (
    <Panel
      id="adaptation"
      title="Tango adaptive bitrate controller"
      icon={<AlertTriangle size={12} />}
      end={
        <Chip tone={a.enabled && !blocked ? "ok" : "idle"}>
          {a.enabled && !blocked ? "Armed" : "Inactive"}
        </Chip>
      }
    >
      <div className="tsm-fields tsm-fields--4">
        <Field label="Min bitrate" htmlFor="adapt-min">
          <input
            id="adapt-min"
            className="tsm-input"
            type="number"
            min={200}
            max={20000}
            value={a.min_bitrate_kbps}
            disabled={blocked}
            onChange={(event) =>
              api.patchDraft({
                adaptation: { ...a, min_bitrate_kbps: Number(event.target.value) },
              })
            }
          />
        </Field>
        <Field label="Max bitrate" htmlFor="adapt-max">
          <input
            id="adapt-max"
            className="tsm-input"
            type="number"
            min={200}
            max={20000}
            value={a.max_bitrate_kbps}
            disabled={blocked}
            onChange={(event) =>
              api.patchDraft({
                adaptation: { ...a, max_bitrate_kbps: Number(event.target.value) },
              })
            }
          />
        </Field>
        <Field label="Step down" htmlFor="adapt-down">
          <input
            id="adapt-down"
            className="tsm-input"
            type="number"
            min={50}
            max={5000}
            value={a.step_down_kbps}
            disabled={blocked}
            onChange={(event) =>
              api.patchDraft({ adaptation: { ...a, step_down_kbps: Number(event.target.value) } })
            }
          />
        </Field>
        <Field label="Cooldown (s)" htmlFor="adapt-cooldown">
          <input
            id="adapt-cooldown"
            className="tsm-input"
            type="number"
            min={3}
            max={120}
            value={a.cooldown_seconds}
            disabled={blocked}
            onChange={(event) =>
              api.patchDraft({ adaptation: { ...a, cooldown_seconds: Number(event.target.value) } })
            }
          />
        </Field>
      </div>

      <div className="tsm-inline-note">
        <AlertTriangle size={12} aria-hidden="true" />
        <span>
          {blocked
            ? "The custom controller stays inactive until OBS Dynamic Bitrate is enabled, so the two algorithms never fight over the bitrate."
            : "Tango controller reads congestion from status polling. It is distinct from OBS Dynamic Bitrate and neither silently overrides the other."}
        </span>
      </div>

      {a.min_bitrate_kbps >= a.max_bitrate_kbps ? (
        <Alert
          tone="danger"
          title="Invalid controller range"
          detail="Minimum bitrate must be lower than the maximum bitrate."
        />
      ) : null}
    </Panel>
  );
}

// -------------------------------------------------------------- dialogs -----

function CreateProfileDialog({
  api,
  onClose,
  onCreated,
}: {
  api: ReturnType<typeof useWorkspace>;
  onClose: () => void;
  onCreated: (profile: ProfileSummaryDto) => void;
}) {
  const [name, setName] = useState("");
const [preset, setPreset] = useState<QualityPresetKey>("balanced");
  const [serviceType, setServiceType] = useState("tango");
  const [serverUrl, setServerUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameError = validateProfileName(name, api.profiles);

  const submit = async () => {
    if (nameError) {
      setError(nameError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createProfile({
        name: name.trim(),
        preset,
        service_type: serviceType,
        server_url: serverUrl.trim() || undefined,
      });
      onCreated(created);
    } catch {
      // The notice stack already reports the failure; keep the dialog open.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New streaming profile"
      sub="Each profile keeps its own OBS endpoint, composition, quality and credentials."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tsm-btn tsm-btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tsm-btn tsm-btn--primary"
            onClick={() => void submit()}
            disabled={busy || Boolean(nameError)}
          >
            {busy ? <Spinner /> : <Plus size={13} />}
            Create profile
          </button>
        </>
      }
    >
      <Field label="Profile name" htmlFor="new-profile-name" error={name ? nameError : null}>
        <input
          id="new-profile-name"
          className="tsm-input"
          value={name}
          autoFocus
          placeholder="Tango · Studio A"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
      </Field>

      <Field label="Quality preset" htmlFor="new-profile-preset">
        <select
          id="new-profile-preset"
          className="tsm-select"
          value={preset}
          onChange={(event) => setPreset(event.target.value as api.QualityPresetKey)}
        >
          {(Object.keys(PRESET_LABELS) as QualityPresetKey[]).map((key) => (
            <option key={key} value={key}>
              {PRESET_LABELS[key]}
            </option>
          ))}
        </select>
      </Field>

      <div className="tsm-fields tsm-fields--2">
        <Field label="Service" htmlFor="new-profile-service">
          <select
            id="new-profile-service"
            className="tsm-select"
            value={serviceType}
            onChange={(event) => setServiceType(event.target.value)}
          >
            <option value="tango">Tango</option>
            <option value="custom">Custom RTMP</option>
          </select>
        </Field>
        <Field
          label="Server URL"
          htmlFor="new-profile-server"
          hint={serviceType === "tango" ? "Optional for Tango." : "Required for custom RTMP."}
        >
          <input
            id="new-profile-server"
            className="tsm-input tsm-input--mono"
            value={serverUrl}
            placeholder="rtmp://ingest.example/live"
            onChange={(event) => setServerUrl(event.target.value)}
          />
        </Field>
      </div>

      {error ? <Alert tone="danger" title={error} /> : null}

      <div className="tsm-inline-note">
        <Check size={12} aria-hidden="true" />
        <span>
          The stream key is set after creation, in the destination panel, so it stays in the secure
          credential store rather than profile JSON.
        </span>
      </div>
    </Modal>
  );
}

function RenameProfileDialog({
  api,
  profile,
  onClose,
}: {
  api: ReturnType<typeof useWorkspace>;
  profile: ProfileSummaryDto;
  onClose: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [busy, setBusy] = useState(false);
  const error = validateProfileName(name, api.profiles, profile.id);

  const submit = async () => {
    if (error) return;
    setBusy(true);
    try {
      await api.renameProfile(profile.id, name);
      onClose();
    } catch {
      // Reported through the notice stack.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Rename profile"
      sub={profile.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tsm-btn tsm-btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tsm-btn tsm-btn--primary"
            onClick={() => void submit()}
            disabled={busy || Boolean(error)}
          >
            {busy ? <Spinner /> : null}
            Save name
          </button>
        </>
      }
    >
      <Field label="Profile name" htmlFor="rename-profile" error={error}>
        <input
          id="rename-profile"
          className="tsm-input"
          value={name}
          autoFocus
          aria-invalid={Boolean(error)}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
      </Field>
    </Modal>
  );
}

function DeleteProfileDialog({
  api,
  profile,
  onClose,
}: {
  api: ReturnType<typeof useWorkspace>;
  profile: ProfileSummaryDto;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.deleteProfile(profile.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Delete profile"
      sub="This removes the profile and its credential references. Captured media files are not deleted."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tsm-btn tsm-btn--quiet" onClick={onClose} autoFocus>
            Keep profile
          </button>
          <button
            type="button"
            className="tsm-btn tsm-btn--danger"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? <Spinner /> : null}
            Delete “{profile.name}”
          </button>
        </>
      }
    >
      <Alert
        tone="warn"
        title="This cannot be undone"
        detail={`${profile.service_type === "custom" ? "Custom RTMP" : "Tango"} · ${profile.obs_connection.host}:${profile.obs_connection.port}`}
      />
    </Modal>
  );
}
