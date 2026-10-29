import {
  Activity,
  Cpu,
  KeyRound,
  Link2,
  RefreshCw,
  Server,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { Alert, Chip, Field, KV, Panel, Spinner } from "@/workspace/ui";
import { SIMULATION_MODE } from "@/api/obs";
import { validateConnection } from "@/workspace/model";
import type { WorkspaceApi } from "@/workspace/useWorkspace";

export function ConnectionPanel({ api }: { api: WorkspaceApi }) {
  const { draft } = api;
  if (!draft) return null;

  const errors = validateConnection(draft.obsHost, draft.obsPort);
  const local = draft.obsHost.trim() === "127.0.0.1" || draft.obsHost.trim() === "localhost";

  const statusChip =
    api.connState === "connected" ? (
      <Chip tone="ok">
        <span className="tsm-dot" aria-hidden="true" /> Connected
      </Chip>
    ) : api.connState === "testing" ? (
      <Chip tone="info">Testing</Chip>
    ) : api.connState === "failed" ? (
      <Chip tone="danger">Failed</Chip>
    ) : (
      <Chip tone="idle">Not tested</Chip>
    );

  return (
    <Panel
      id="connection"
      title="OBS connection"
      icon={<Wifi size={12} />}
      end={statusChip}
      foot={
        <>
          <button
            type="button"
            className="tsm-btn tsm-btn--quiet"
            onClick={() => void api.testConnection()}
            disabled={api.connState === "testing"}
          >
            {api.connState === "testing" ? <Spinner /> : <Link2 size={12} />}
            {api.connState === "testing" ? "Connecting" : "Test connection"}
          </button>
          <button
            type="button"
            className="tsm-btn tsm-btn--primary"
            onClick={() => void api.saveConnection()}
            disabled={api.savingConnection || Object.keys(errors).length > 0}
          >
            {api.savingConnection ? <Spinner /> : <ShieldCheck size={12} />}
            Save connection
          </button>
        </>
      }
    >
      <div className="tsm-fields tsm-fields--3">
        <Field label="Hostname / IP" htmlFor="obs-host" error={errors.host}>
          <input
            id="obs-host"
            className="tsm-input"
            value={draft.obsHost}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={Boolean(errors.host)}
            onChange={(event) => api.patchDraft({ obsHost: event.target.value })}
          />
        </Field>
        <Field label="WebSocket port" htmlFor="obs-port" error={errors.port}>
          <input
            id="obs-port"
            className="tsm-input"
            type="number"
            min={1}
            max={65535}
            value={draft.obsPort}
            aria-invalid={Boolean(errors.port)}
            onChange={(event) =>
              api.patchDraft({ obsPort: Number(event.target.value) })
            }
          />
        </Field>
        <Field
          label="Password"
          htmlFor="obs-password"
          hint={
            api.activeProfile?.has_obs_password
              ? "A password is stored for this profile."
              : "No password stored for this profile."
          }
        >
          <div className="tsm-input-wrap">
            <input
              id="obs-password"
              className="tsm-input"
              type="password"
              autoComplete="new-password"
              placeholder={
                api.activeProfile?.has_obs_password ? "•••••••• (stored)" : "Optional"
              }
              value={api.obsPasswordDraft}
              onChange={(event) => api.setObsPasswordDraft(event.target.value)}
            />
            <button
              type="button"
              className="tsm-input-wrap__action"
              onClick={() => void api.saveObsPassword()}
              aria-label="Store OBS password in the secure credential manager"
              title="Store password securely"
              disabled={api.savingPassword}
            >
              {api.savingPassword ? <Spinner /> : <KeyRound size={13} />}
            </button>
          </div>
        </Field>
      </div>

      {!local ? (
        <div className="tsm-inline-note">
          <Server size={12} aria-hidden="true" />
          <span>
            Remote host selected. The host must have OBS WebSocket enabled, the port reachable
            through its firewall, and the exact IP stored here. A timeout is not an authentication
            failure — the address never answered.
          </span>
        </div>
      ) : (
        <div className="tsm-inline-note">
          <Activity size={12} aria-hidden="true" />
          <span>
            OBS WebSocket listens on <b>127.0.0.1:4455</b> by default. Enable it in OBS →
            Tools → WebSocket Server Settings.
          </span>
        </div>
      )}

      {api.connError ? (
        <Alert tone="danger" title="Connection failed" detail={api.connError} />
      ) : null}

      {api.connState === "connected" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 9,
            background: "var(--surface-2)",
            border: "1px solid var(--hairline)",
          }}
        >
          <KV k="OBS version" v={api.connectionStatus.obs_version} />
          <KV k="WebSocket" v={api.connectionStatus.obs_web_socket_version} />
          <KV k="RPC" v={api.connectionStatus.rpc_version} />
          <KV k="Endpoint" v={`${draft.obsHost}:${draft.obsPort}`} />
        </div>
      ) : null}

      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span className="tsm-field__label" style={{ flex: 1 }}>
            Available scenes
          </span>
          <Chip tone="idle" mono>
            {api.scenes.length}
          </Chip>
          <button
            type="button"
            className="tsm-btn tsm-btn--ghost tsm-btn--icon"
            onClick={() => void api.refreshScenes()}
            disabled={api.scenesBusy || api.connState !== "connected"}
            aria-label="Refresh scene list"
            title="Refresh scenes"
          >
            {api.scenesBusy ? <Spinner /> : <RefreshCw size={12} />}
          </button>
        </div>
        {api.scenesError ? (
          <Alert tone="danger" title="Scene discovery failed" detail={api.scenesError} />
        ) : api.scenes.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {api.scenes.map((scene) => (
              <Chip key={scene} tone="idle" mono>
                {scene}
              </Chip>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 11, color: "var(--text-mute)" }}>
            {api.connState === "connected"
              ? "No scenes returned by OBS."
              : "Connect to OBS to read the scene list."}
          </p>
        )}
      </div>

      <div className="tsm-kv" style={{ alignItems: "center" }}>
        <span className="tsm-kv__k">
          <Cpu size={11} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
          Adapter
        </span>
        <Chip tone={SIMULATION_MODE ? "warn" : "ok"}>
          {SIMULATION_MODE ? "Simulated preview" : "Native Tauri commands"}
        </Chip>
      </div>
    </Panel>
  );
}
