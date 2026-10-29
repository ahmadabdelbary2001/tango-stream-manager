import {
  Crop,
  Crosshair,
  FileVideo,
  Maximize,
  RotateCcw,
  ScanLine,
  Send,
  Wand2,
} from "lucide-react";
import { Alert, Chip, Field, Panel, SliderField, Spinner } from "@/workspace/ui";
import { SIMULATION_MODE } from "@/api/obs";
import {
  cropMasks,
  dims,
  stageGeometry,
  validateComposition,
} from "@/workspace/model";
import type { WorkspaceApi } from "@/workspace/useWorkspace";

export function SourcePanel({ api }: { api: WorkspaceApi }) {
  const { draft, panLimits } = api;
  if (!draft) return null;

  const c = draft.composition;
  const geometry = stageGeometry(c, panLimits);
  const cropOverlays = cropMasks(geometry.crop);
  const ratio = c.canvas_width > 0 && c.canvas_height > 0 ? c.canvas_width / c.canvas_height : 9 / 16;

  return (
    <Panel
      id="composition"
      title="Target scene, source & composition"
      icon={<FileVideo size={12} />}
      sub={`${dims(c.source_width, c.source_height)} source → ${dims(c.canvas_width, c.canvas_height)} canvas`}
      end={
        api.compositionDirty ? (
          <Chip tone="warn">Pending apply</Chip>
        ) : api.appliedCompositionSig ? (
          <Chip tone="ok">Applied</Chip>
        ) : (
          <Chip tone="idle">Not applied</Chip>
        )
      }
      foot={
        <>
          <button type="button" className="tsm-btn tsm-btn--quiet" onClick={() => api.resetComposition()}>
            <RotateCcw size={12} />
            Reset composition
          </button>
          <div className="tsm-panel__foot-end">
            {api.limitsBusy ? (
              <span className="tsm-prov">
                <Spinner /> Calculating pan limits
              </span>
            ) : (
              <span className="tsm-prov">
                <Crosshair size={10} /> Safe pan X {panLimits.min_x}…{panLimits.max_x} · Y{" "}
                {panLimits.min_y}…{panLimits.max_y}
              </span>
            )}
            <button
              type="button"
              className="tsm-btn tsm-btn--primary"
              onClick={() => void api.applyComposition()}
              disabled={api.applyingComposition || Object.keys(validateComposition(c)).length > 0}
            >
              {api.applyingComposition ? <Spinner /> : <Send size={12} />}
              Apply composition
            </button>
          </div>
        </>
      }
    >
      {/* ---------------------------------------------------------- stage -- */}
      <div className="tsm-stage">
        <div className="tsm-stage__grid" aria-hidden="true" />
        {geometry.valid ? (
          <>
            <div
              className="tsm-canvas"
              style={{ ["--canvas-ratio" as string]: String(ratio) }}
              role="img"
              aria-label={`Composition preview: source ${c.source_width} by ${c.source_height} placed on a ${c.canvas_width} by ${c.canvas_height} canvas at ${c.zoom.toFixed(
                2,
              )} times zoom, pan X ${c.pan_x}, pan Y ${c.pan_y}.`}
            >
              <div
                className="tsm-canvas__source"
                style={{
                  ["--sw" as string]: `${geometry.frameWidthPct}%`,
                  ["--sh" as string]: `${geometry.frameHeightPct}%`,
                  ["--px" as string]: `${geometry.offsetXPct}%`,
                  ["--py" as string]: `${geometry.offsetYPct}%`,
                }}
              >
                <span className="tsm-canvas__source-label">
                  {c.source_name || "Source"} · {dims(c.source_width, c.source_height)}
                </span>
              </div>
              {cropOverlays.map((mask) => (
                <div key={mask.key} className="tsm-crop-mask" style={mask.style} />
              ))}
              <div className="tsm-canvas__safe" />
            </div>
            <div className="tsm-stage__meta">
              <Chip tone="amber" mono>
                {c.zoom.toFixed(2)}× zoom
              </Chip>
              {c.has_crop ? <Chip tone="danger">Crop on</Chip> : <Chip tone="idle">No crop</Chip>}
            </div>
            <div className="tsm-stage__readout">
              visible <b>{panLimits.visible_width} × {panLimits.visible_height}</b>
              <br />
              pan <b>{c.pan_x}</b> / <b>{c.pan_y}</b>
              {panLimits.x_locked ? " · X locked" : ""}
              {panLimits.y_locked ? " · Y locked" : ""}
            </div>
          </>
        ) : (
          <div className="tsm-stage__empty">
            <strong>No valid composition</strong>
            Enter source and canvas dimensions to render the stage preview.
          </div>
        )}
      </div>

      {api.limitsError ? (
        <Alert tone="danger" title="Pan limit calculation failed" detail={api.limitsError} />
      ) : null}

      {/* ------------------------------------------------------- scene/source */}
      <div className="tsm-fields tsm-fields--2">
        <Field
          label="Scene name"
          htmlFor="scene-name"
          hint={
            api.connState === "connected" && api.scenes.length
              ? "Choose a discovered scene or type the exact name."
              : "Must match an OBS scene exactly."
          }
        >
          <input
            id="scene-name"
            className="tsm-input"
            list="obs-scenes"
            value={c.scene_name}
            onChange={(event) => api.patchComposition({ scene_name: event.target.value })}
          />
          <datalist id="obs-scenes">
            {api.scenes.map((scene) => (
              <option key={scene} value={scene} />
            ))}
          </datalist>
        </Field>
        <Field label="Source name" htmlFor="source-name" hint="The media source that will be transformed.">
          <input
            id="source-name"
            className="tsm-input"
            value={c.source_name}
            onChange={(event) => api.patchComposition({ source_name: event.target.value })}
          />
        </Field>
      </div>

      <Field
        label="Local video path"
        htmlFor="source-path"
        hint="Required by the desktop build so OBS can point the media source at the file. Not uploaded anywhere."
      >
        <div className="tsm-input-wrap">
          <input
            id="source-path"
            className="tsm-input tsm-input--mono"
            spellCheck={false}
            placeholder="C:\Media\session.mp4"
            value={c.source_path}
            onChange={(event) =>
              api.patchComposition({
                source_path: event.target.value,
              })
            }
          />
          <button
            type="button"
            className="tsm-input-wrap__action"
            onClick={() => void api.detectDimensions()}
            disabled={api.detecting}
            aria-label="Detect actual dimensions with ffprobe"
            title="Detect actual dimensions (ffprobe)"
          >
            {api.detecting ? <Spinner /> : <ScanLine size={13} />}
          </button>
        </div>
      </Field>

      {api.detectResult ? (
        <Alert
          tone={api.detectResult.tone}
          title={api.detectResult.title}
          detail={api.detectResult.detail}
          simulated={api.detectResult.tone === "ok" && SIMULATION_MODE}
        />
      ) : null}

      {/* ------------------------------------------------- dimensions + zoom */}
      <div className="tsm-fields tsm-fields--4">
        <Field label="Source width" htmlFor="source-width">
          <input
            id="source-width"
            className="tsm-input"
            type="number"
            min={1}
            value={c.source_width}
            onChange={(event) =>
              api.patchComposition({ source_width: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="Source height" htmlFor="source-height">
          <input
            id="source-height"
            className="tsm-input"
            type="number"
            min={1}
            value={c.source_height}
            onChange={(event) =>
              api.patchComposition({ source_height: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="Canvas width" htmlFor="canvas-width">
          <input
            id="canvas-width"
            className="tsm-input"
            type="number"
            min={1}
            value={c.canvas_width}
            onChange={(event) =>
              api.patchComposition({ canvas_width: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="Canvas height" htmlFor="canvas-height">
          <input
            id="canvas-height"
            className="tsm-input"
            type="number"
            min={1}
            value={c.canvas_height}
            onChange={(event) =>
              api.patchComposition({ canvas_height: Number(event.target.value) })
            }
          />
        </Field>
      </div>

      <div className="tsm-fields tsm-fields--2">
        <SliderField
          id="zoom"
          label="Zoom"
          value={c.zoom}
          min={0.1}
          max={4}
          step={0.01}
          decimals={2}
          unit="×"
          onChange={(value) => api.patchComposition({ zoom: value })}
        />
        <div className="tsm-stack" style={{ gap: 10 }}>
          <SliderField
            id="pan-x"
            label="Pan X"
            value={c.pan_x}
            min={panLimits.min_x}
            max={panLimits.max_x}
            step={1}
            unit="px"
            disabled={panLimits.x_locked}
            onChange={(value) => api.patchComposition({ pan_x: value })}
          />
          <SliderField
            id="pan-y"
            label="Pan Y"
            value={c.pan_y}
            min={panLimits.min_y}
            max={panLimits.max_y}
            step={1}
            unit="px"
            disabled={panLimits.y_locked}
            onChange={(value) => api.patchComposition({ pan_y: value })}
          />
        </div>
      </div>

      <p className="tsm-inline-note" style={{ margin: 0 }}>
        <Maximize size={12} aria-hidden="true" />
        <span>
          Centered Fill/Cover: the source is scaled until it covers the whole canvas, then zoom
          multiplies that scale. Pan is clamped by the Rust composition rules — a locked axis means
          the source already covers that dimension.
        </span>
      </p>

      {/* ------------------------------------------------------------- crop */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <label className="tsm-checkbox">
            <input
              type="checkbox"
              checked={c.has_crop}
              onChange={(event) => api.patchComposition({ has_crop: event.target.checked })}
            />
            Enable crop
          </label>
          <Chip tone={c.has_crop ? "danger" : "idle"} mono>
            <Crop size={9} aria-hidden="true" />
            {c.has_crop ? "Active" : "Off"}
          </Chip>
        </div>
        {c.has_crop ? (
          <div className="tsm-fields tsm-fields--4">
            <SliderField
              id="crop-left"
              label="Crop left"
              value={c.crop?.left ?? 0}
              min={0}
              max={0.9}
              step={0.01}
              decimals={2}
              onChange={(value) =>
                api.patchComposition({
                  crop: { ...(c.crop ?? { left: 0, top: 0, right: 0, bottom: 0 }), left: value },
                })
              }
            />
            <SliderField
              id="crop-top"
              label="Crop top"
              value={c.crop?.top ?? 0}
              min={0}
              max={0.9}
              step={0.01}
              decimals={2}
              onChange={(value) =>
                api.patchComposition({
                  crop: { ...(c.crop ?? { left: 0, top: 0, right: 0, bottom: 0 }), top: value },
                })
              }
            />
            <SliderField
              id="crop-right"
              label="Crop right"
              value={c.crop?.right ?? 0}
              min={0}
              max={0.9}
              step={0.01}
              decimals={2}
              onChange={(value) =>
                api.patchComposition({
                  crop: { ...(c.crop ?? { left: 0, top: 0, right: 0, bottom: 0 }), right: value },
                })
              }
            />
            <SliderField
              id="crop-bottom"
              label="Crop bottom"
              value={c.crop?.bottom ?? 0}
              min={0}
              max={0.9}
              step={0.01}
              decimals={2}
              onChange={(value) =>
                api.patchComposition({
                  crop: { ...(c.crop ?? { left: 0, top: 0, right: 0, bottom: 0 }), bottom: value },
                })
              }
            />
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 11, color: "var(--text-mute)" }}>
            Crop values are fractions of the source frame (0.10 = 10%). Disabled crop keeps the full
            frame.
          </p>
        )}
      </div>

      {Object.keys(validateComposition(c)).length > 0 ? (
        <Alert
          tone="danger"
          title="Composition values need attention"
          detail={Object.values(validateComposition(c)).join(" ")}
        />
      ) : null}

      {api.compositionResult ? (
        <Alert
          tone={api.compositionResult.tone}
          title={api.compositionResult.title}
          detail={api.compositionResult.detail}
          simulated={api.compositionResult.tone === "ok" && SIMULATION_MODE}
        />
      ) : null}

      <div className="tsm-inline-note">
        <Wand2 size={12} aria-hidden="true" />
        <span>
          Reset clears geometry only (canvas, zoom, pan, crop). Scene name, source name, media path
          and detected source dimensions are preserved until you press Apply.
        </span>
      </div>
    </Panel>
  );
}
