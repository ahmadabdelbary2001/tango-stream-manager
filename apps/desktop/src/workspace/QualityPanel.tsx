import { Gauge, Mic, Radio, RotateCcw, Save, Volume2, Waves } from "lucide-react";
import {
  Alert,
  Chip,
  Field,
  Panel,
  SliderField,
  Spinner,
  ToggleRow,
} from "@/workspace/ui";
import {
  ENCODER_OPTIONS,
  QUALITY_PRESETS,
  RATE_CONTROL_OPTIONS,
  RESCALE_FILTER_OPTIONS,
  SIMULATION_MODE,
  isQualityPresetKey,
  type QualityPresetKey,
} from "@/api/obs";
import {
  matchingPreset,
  qualitySummary,
  validateQuality,
} from "@/workspace/model";
import type { WorkspaceApi } from "@/workspace/useWorkspace";

const ENCODER_LABELS: Record<string, string> = {
  x264: "x264 (CPU)",
  nvenc: "NVENC (NVIDIA)",
  qsv: "QSV (Intel)",
  amd: "AMF (AMD)",
};

export function QualityPanel({ api }: { api: WorkspaceApi }) {
  const { draft } = api;
  if (!draft) return null;

  const q = draft.quality;
  const errors = validateQuality(q);
  const preset = matchingPreset(q);

  return (
    <Panel
      id="quality"
      title="Quality & encoding"
      icon={<Gauge size={12} />}
      end={
        api.qualityDirty ? (
          <Chip tone="warn">Pending apply</Chip>
        ) : api.appliedQualitySig ? (
          <Chip tone="ok">Applied</Chip>
        ) : (
          <Chip tone="idle">Not applied</Chip>
        )
      }
      foot={
        <>
          <button type="button" className="tsm-btn tsm-btn--quiet" onClick={() => api.resetQuality()}>
            <RotateCcw size={12} />
            Reset quality
          </button>
          <div className="tsm-panel__foot-end">
            <button
              type="button"
              className="tsm-btn tsm-btn--primary"
              onClick={() => void api.applyQuality()}
              disabled={api.applyingQuality || Object.keys(errors).length > 0}
            >
              {api.applyingQuality ? <Spinner /> : <Save size={12} />}
              Apply to OBS
            </button>
          </div>
        </>
      }
    >
      <Field label="Quality preset" htmlFor="quality-preset">
        <select
          id="quality-preset"
          className="tsm-select"
          value={preset ?? "custom"}
          onChange={(event) => {
            const value = event.target.value;
            if (isQualityPresetKey(value)) {
              api.patchQuality({ ...QUALITY_PRESETS[value] });
            }
          }}
        >
          {preset === null ? <option value="custom">Custom settings</option> : null}
          {(Object.keys(QUALITY_PRESETS) as QualityPresetKey[]).map((key) => (
            <option key={key} value={key}>
              {key === "balanced" ? "Balanced" : key === "low" ? "Low bandwidth" : "Very low"}
            </option>
          ))}
        </select>
      </Field>

      <div className="tsm-fields tsm-fields--4">
        <Field label="Output width" htmlFor="q-width" error={errors.output_width}>
          <input
            id="q-width"
            className="tsm-input"
            type="number"
            min={160}
            max={7680}
            value={q.output_width}
            aria-invalid={Boolean(errors.output_width)}
            onChange={(event) => api.patchQuality({ output_width: Number(event.target.value) })}
          />
        </Field>
        <Field label="Output height" htmlFor="q-height" error={errors.output_height}>
          <input
            id="q-height"
            className="tsm-input"
            type="number"
            min={160}
            max={7680}
            value={q.output_height}
            aria-invalid={Boolean(errors.output_height)}
            onChange={(event) => api.patchQuality({ output_height: Number(event.target.value) })}
          />
        </Field>
        <Field label="FPS" htmlFor="q-fps" error={errors.fps}>
          <input
            id="q-fps"
            className="tsm-input"
            type="number"
            min={1}
            max={120}
            value={q.fps}
            aria-invalid={Boolean(errors.fps)}
            onChange={(event) => api.patchQuality({ fps: Number(event.target.value) })}
          />
        </Field>
        <Field label="Keyframe (s)" htmlFor="q-keyframe" error={errors.keyframe_interval_sec}>
          <input
            id="q-keyframe"
            className="tsm-input"
            type="number"
            min={0}
            max={20}
            step={1}
            value={q.keyframe_interval_sec}
            onChange={(event) =>
              api.patchQuality({ keyframe_interval_sec: Number(event.target.value) })
            }
          />
        </Field>
      </div>

      <div className="tsm-fields tsm-fields--2">
        <Field label="Encoder" htmlFor="q-encoder">
          <select
            id="q-encoder"
            className="tsm-select"
            value={q.encoder}
            onChange={(event) => api.patchQuality({ encoder: event.target.value })}
          >
            {ENCODER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {ENCODER_LABELS[option] ?? option}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Rate control"
          htmlFor="q-rate"
          hint={
            api.rescaleSupported === false
              ? "Simple Output supports CBR only for these operations."
              : "CQP is unavailable in Simple Output mode."
          }
        >
          <select
            id="q-rate"
            className="tsm-select"
            value={q.rate_control}
            onChange={(event) => api.patchQuality({ rate_control: event.target.value })}
          >
            {RATE_CONTROL_OPTIONS.map((option) => (
              <option
                key={option}
                value={option}
                disabled={api.rescaleSupported === false && option === "CQP"}
              >
                {option}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="tsm-fields tsm-fields--2">
        <SliderField
          id="q-vbitrate"
          label="Video bitrate"
          value={q.video_bitrate_kbps}
          min={200}
          max={20000}
          step={50}
          unit="kbps"
          onChange={(value) => api.patchQuality({ video_bitrate_kbps: value })}
        />
        <SliderField
          id="q-abitrate"
          label="Audio bitrate"
          value={q.audio_bitrate_kbps}
          min={32}
          max={512}
          step={16}
          unit="kbps"
          onChange={(value) => api.patchQuality({ audio_bitrate_kbps: value })}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(0,0,0,0.16)",
          border: "1px solid var(--hairline)",
          fontSize: 11,
          color: "var(--text-mute)",
        }}
      >
        <Chip tone="idle" mono>
          {qualitySummary(q)}
        </Chip>
        <span>Profile value. OBS read-back is only claimed after a successful apply.</span>
      </div>

      {Object.keys(errors).length > 0 ? (
        <Alert
          tone="danger"
          title="Quality values out of range"
          detail={Object.values(errors).slice(0, 3).join(" ")}
        />
      ) : null}

      {api.qualityResult ? (
        <Alert
          tone={api.qualityResult.tone}
          title={api.qualityResult.title}
          detail={api.qualityResult.detail}
          simulated={api.qualityResult.tone === "ok" && SIMULATION_MODE}
        />
      ) : null}
    </Panel>
  );
}

export function StreamingOutputPanel({ api }: { api: WorkspaceApi }) {
  const { draft } = api;
  if (!draft) return null;

  const q = draft.quality;
  const rescaleBlocked = api.rescaleSupported === false;

  return (
    <Panel
      id="output"
      title="OBS streaming output"
      icon={<Waves size={12} />}
      end={
        api.outputMode ? (
          <Chip tone="idle" mono>
            {api.outputMode === "advanced" ? "Advanced output" : "Simple output"}
          </Chip>
        ) : (
          <Chip tone="idle">Mode unknown</Chip>
        )
      }
      foot={
        <>
          <button
            type="button"
            className="tsm-btn tsm-btn--quiet"
            onClick={() => void api.readOutputSettings()}
          >
            Read from OBS
          </button>
          <div className="tsm-panel__foot-end">
            <button
              type="button"
              className="tsm-btn tsm-btn--primary"
              onClick={() => void api.applyOutput()}
              disabled={api.applyingOutput}
            >
              {api.applyingOutput ? <Spinner /> : <Save size={12} />}
              Apply output
            </button>
          </div>
        </>
      }
    >
      <ToggleRow
        label="Rescale output"
        hint={
          rescaleBlocked
            ? "Unsupported: OBS is in Simple Output mode. Switch OBS to Advanced Output manually — this app will not change your output mode."
            : "Requires Advanced Output in OBS. Applies to the next stream start."
        }
        checked={q.rescale_output_enabled}
        disabled={rescaleBlocked}
        onChange={(next) => api.patchQuality({ rescale_output_enabled: next })}
      />

      <div className="tsm-fields tsm-fields--3">
        <Field label="Rescale width" htmlFor="rs-width" error={rescaleBlocked ? undefined : undefined}>
          <input
            id="rs-width"
            className="tsm-input"
            type="number"
            min={160}
            max={7680}
            value={q.rescale_output_width}
            disabled={!q.rescale_output_enabled}
            onChange={(event) =>
              api.patchQuality({ rescale_output_width: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="Rescale height" htmlFor="rs-height">
          <input
            id="rs-height"
            className="tsm-input"
            type="number"
            min={160}
            max={7680}
            value={q.rescale_output_height}
            disabled={!q.rescale_output_enabled}
            onChange={(event) =>
              api.patchQuality({ rescale_output_height: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="Filter" htmlFor="rs-filter">
          <select
            id="rs-filter"
            className="tsm-select"
            value={q.rescale_filter}
            disabled={!q.rescale_output_enabled}
            onChange={(event) => api.patchQuality({ rescale_filter: event.target.value })}
          >
            {RESCALE_FILTER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <ToggleRow
        label="OBS Dynamic Bitrate"
        hint="Native OBS network-congestion option. Separate from any Tango adaptation logic."
        checked={q.dynamic_bitrate_enabled}
        onChange={(next) => api.patchQuality({ dynamic_bitrate_enabled: next })}
      />

      <ToggleRow
        label="Tango adaptive bitrate controller"
        hint="Custom controller driven by measured congestion. Not part of OBS Dynamic Bitrate."
        checked={draft.adaptation.enabled}
        disabled={!q.dynamic_bitrate_enabled}
        onChange={(next) =>
          api.patchDraft({ adaptation: { ...draft.adaptation, enabled: next } })
        }
      />

      {api.outputSettings ? (
        <div className="tsm-fields tsm-fields--2">
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--hairline)",
              background: "var(--surface-2)",
            }}
          >
            <Chip tone="ok" mono>
              Read-back
            </Chip>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-dim)" }}>
              rescale{" "}
              {api.outputSettings.rescale_output_enabled
                ? `${api.outputSettings.rescale_output_width}×${api.outputSettings.rescale_output_height} ${api.outputSettings.rescale_filter}`
                : "off"}{" "}
              · dynamic bitrate {api.outputSettings.dynamic_bitrate_enabled ? "on" : "off"} ·{" "}
              {api.outputSettings.output_mode}
            </p>
          </div>
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--hairline)",
              background: "var(--surface-2)",
            }}
          >
            <Chip tone={api.outputDirty ? "warn" : "idle"} mono>
              {api.outputDirty ? "Staged differs" : "In sync"}
            </Chip>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-dim)" }}>
              {api.outputDirty
                ? "Profile values differ from the last OBS read-back."
                : "Profile values match the last OBS read-back."}
            </p>
          </div>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-mute)" }}>
          No OBS read-back yet. Connect and press “Read from OBS” to compare staged values with
          actual output settings.
        </p>
      )}

      {api.outputResult ? (
        <Alert
          tone={api.outputResult.tone}
          title={api.outputResult.title}
          detail={api.outputResult.detail}
          simulated={api.outputResult.tone === "ok" && SIMULATION_MODE}
        />
      ) : null}
    </Panel>
  );
}

export function AudioPanel({ api }: { api: WorkspaceApi }) {
  const { draft } = api;
  if (!draft) return null;

  const enabled = draft.composition.silent_mode_enabled;
  const restoreType = draft.composition.silent_mode_restore_monitor_type;

  return (
    <Panel
      id="audio"
      title="Audio & Silent Mode"
      icon={<Volume2 size={12} />}
      end={<Chip tone={enabled ? "warn" : "idle"}>{enabled ? "Muted locally" : "Off"}</Chip>}
    >
      <ToggleRow
        label="Silent Mode"
        hint="Stops local monitoring for the selected OBS source while keeping its audio in the stream mix. Not a mute."
        checked={enabled}
        busy={api.silentBusy}
        disabled={!api.connectionStatus.connected}
        onChange={(next) => void api.toggleSilentMode(next)}
      />

      <div
        style={{
          padding: "9px 11px",
          borderRadius: 9,
          background: "var(--surface-2)",
          border: "1px solid var(--hairline)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div className="tsm-kv">
          <span className="tsm-kv__k">
            <Mic size={11} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
            Affected source
          </span>
          <span className="tsm-kv__v">{draft.composition.source_name || "Not set"}</span>
        </div>
        <div className="tsm-kv">
          <span className="tsm-kv__k">Current monitor type</span>
          <span className="tsm-kv__v">
            {api.silentResult?.currentMonitorType ?? (enabled ? "MONITORING_TYPE_NONE" : "—")}
          </span>
        </div>
        <div className="tsm-kv">
          <span className="tsm-kv__k">Restorable value</span>
          <span className="tsm-kv__v">
            {restoreType || api.silentResult?.restoreMonitorType || "Not recorded"}
          </span>
        </div>
        <div className="tsm-kv">
          <span className="tsm-kv__k">Source already muted</span>
          <span className="tsm-kv__v">
            {api.silentResult ? (api.silentResult.inputMuted ? "Yes" : "No") : "—"}
          </span>
        </div>
      </div>

      {api.silentResult?.inputMuted ? (
        <Alert
          tone="warn"
          title="This OBS source is muted"
          detail="Silent Mode only changes monitoring. Because the source is muted, viewers will not hear it regardless of monitoring."
        />
      ) : null}

      {api.silentError ? <Alert tone="danger" title="Silent Mode failed" detail={api.silentError} /> : null}

      {!api.connectionStatus.connected ? (
        <div className="tsm-inline-note">
          <Radio size={12} aria-hidden="true" />
          <span>Connection required. Monitoring state is read from OBS, never guessed.</span>
        </div>
      ) : null}

      <div className="tsm-inline-note">
        <Volume2 size={12} aria-hidden="true" />
        <span>
          Silent Mode uses OBS Audio Monitoring, not input mute. It never silences Windows system
          audio or other OBS sources. If the original monitor type is unknown, restoration is
          refused rather than guessed.
        </span>
      </div>
    </Panel>
  );
}
