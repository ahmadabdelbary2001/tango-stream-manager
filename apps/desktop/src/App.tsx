import { useState, useEffect } from "react";
import {
  testObsConnection,
  applyVideoComposition,
  ObsConnectionConfig,
  ObsConnectionStatus,
  ApplyCompositionPayload,
} from "./api/obs";
import "./App.css";

export default function App() {
  // OBS Connection State
  const [obsConfig, setObsConfig] = useState<ObsConnectionConfig>({
    host: "127.0.0.1",
    port: 4455,
    password: "",
  });

  const [connectionStatus, setConnectionStatus] = useState<ObsConnectionStatus>({
    connected: false,
    obs_version: null,
    obs_web_socket_version: null,
    rpc_version: null,
    error_message: null,
  });

  const [isTesting, setIsTesting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Scene & Composition State
  const [sceneName, setSceneName] = useState("Tango Scene");
  const [sourceName, setSourceName] = useState("Tango Video");
  const [sourcePath, setSourcePath] = useState("E:\\smoke.mp4");

  const [sourceWidth, setSourceWidth] = useState(568);
  const [sourceHeight, setSourceHeight] = useState(762);
  const [canvasWidth, setCanvasWidth] = useState(720);
  const [canvasHeight, setCanvasHeight] = useState(1280);

  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Crop Region in normalized fraction [0, 1]
  const [hasCrop, setHasCrop] = useState(false);
  const [cropLeft, setCropLeft] = useState(0.1);
  const [cropTop, setCropTop] = useState(0.1);
  const [cropRight, setCropRight] = useState(0.1);
  const [cropBottom, setCropBottom] = useState(0.1);

  // Automatically test connection on mount
  useEffect(() => {
    handleTestConnection();
  }, []);

  async function handleTestConnection() {
    setIsTesting(true);
    setApplyResult(null);
    try {
      const res = await testObsConnection(obsConfig);
      setConnectionStatus(res);
    } catch (err) {
      setConnectionStatus({
        connected: false,
        obs_version: null,
        obs_web_socket_version: null,
        rpc_version: null,
        error_message: String(err),
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleApplyComposition() {
    setIsApplying(true);
    setApplyResult(null);

    const payload: ApplyCompositionPayload = {
      obs_config: obsConfig,
      scene_name: sceneName,
      source_name: sourceName,
      source_path: sourcePath,
      source_width: sourceWidth,
      source_height: sourceHeight,
      canvas_width: canvasWidth,
      canvas_height: canvasHeight,
      zoom,
      pan_x: panX,
      pan_y: panY,
      crop: hasCrop
        ? {
            left: cropLeft,
            top: cropTop,
            right: cropRight,
            bottom: cropBottom,
          }
        : null,
    };

    try {
      await applyVideoComposition(payload);
      setApplyResult({
        success: true,
        message: `Composition successfully applied to scene "${sceneName}"!`,
      });
      // Refresh connection status as well
      setConnectionStatus((prev) => ({ ...prev, connected: true, error_message: null }));
    } catch (err) {
      setApplyResult({
        success: false,
        message: String(err),
      });
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="app-header">
        <div className="header-branding">
          <div className="brand-icon">T</div>
          <div>
            <h1 className="brand-title">Tango Stream Manager</h1>
            <p className="brand-subtitle">
              Native Video Composition Engine & OBS Bridge
            </p>
          </div>
        </div>

        <div>
          {isTesting ? (
            <div className="status-badge testing">
              <span className="pulse-dot" />
              <span>Testing Connection...</span>
            </div>
          ) : connectionStatus.connected ? (
            <div className="status-badge connected">
              <span className="pulse-dot" />
              <span>
                OBS Connected (v{connectionStatus.obs_version})
              </span>
            </div>
          ) : (
            <div className="status-badge disconnected">
              <span className="pulse-dot" />
              <span>OBS Disconnected</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Left Column: OBS Connection & Source Setup */}
        <div className="glass-card">
          <div className="card-title">
            <span>OBS Connection & Media</span>
            <span className="badge-tag">WebSocket 5.x</span>
          </div>

          <div className="input-row">
            <div className="form-group">
              <label className="form-label">Host</label>
              <input
                className="form-input font-mono"
                value={obsConfig.host}
                onChange={(e) =>
                  setObsConfig({ ...obsConfig, host: e.target.value })
                }
                placeholder="127.0.0.1"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Port</label>
              <input
                className="form-input font-mono"
                type="number"
                value={obsConfig.port}
                onChange={(e) =>
                  setObsConfig({ ...obsConfig, port: Number(e.target.value) })
                }
                placeholder="4455"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Server Password (Optional)</label>
            <input
              className="form-input"
              type="password"
              value={obsConfig.password || ""}
              onChange={(e) =>
                setObsConfig({
                  ...obsConfig,
                  password: e.target.value ? e.target.value : null,
                })
              }
              placeholder="••••••••••••"
            />
          </div>

          <button
            className="btn btn-secondary"
            onClick={handleTestConnection}
            disabled={isTesting}
          >
            {isTesting ? "Testing..." : "Test OBS Connection"}
          </button>

          {/* Connection Error Diagnostic Banner */}
          {!connectionStatus.connected && connectionStatus.error_message && (
            <div className="alert-box alert-error">
              <strong>Connection Failed:</strong>
              <span>{connectionStatus.error_message}</span>
              <p className="alert-tip">
                Tip: Ensure OBS Studio is open and WebSocket Server is enabled
                under <em>Tools → WebSocket Server Settings</em>.
              </p>
            </div>
          )}

          {/* Scene and Source Setup */}
          <div className="card-title" style={{ marginTop: "0.5rem" }}>
            <span>Target Scene & Video File</span>
            <span className="badge-tag">Self-Healing</span>
          </div>

          <div className="input-row">
            <div className="form-group">
              <label className="form-label">Scene Name</label>
              <input
                className="form-input"
                value={sceneName}
                onChange={(e) => setSceneName(e.target.value)}
                placeholder="Tango Scene"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Source Name</label>
              <input
                className="form-input"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="Tango Video"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Local Video File Path</label>
            <input
              className="form-input font-mono"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              placeholder="E:\videos\stream.mp4"
            />
          </div>
        </div>

        {/* Right Column: Video Composition Controls */}
        <div className="glass-card">
          <div className="card-title">
            <span>Video Composition & Geometry</span>
            <span className="badge-tag">Domain Model</span>
          </div>

          <div className="input-row">
            <div className="form-group">
              <label className="form-label">Source Size (WxH)</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  className="form-input font-mono"
                  type="number"
                  value={sourceWidth}
                  onChange={(e) => setSourceWidth(Number(e.target.value))}
                />
                <input
                  className="form-input font-mono"
                  type="number"
                  value={sourceHeight}
                  onChange={(e) => setSourceHeight(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Canvas Size (9:16)</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  className="form-input font-mono"
                  type="number"
                  value={canvasWidth}
                  onChange={(e) => setCanvasWidth(Number(e.target.value))}
                />
                <input
                  className="form-input font-mono"
                  type="number"
                  value={canvasHeight}
                  onChange={(e) => setCanvasHeight(Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          {/* Zoom Slider */}
          <div className="slider-group">
            <div className="slider-header">
              <span>Zoom Scale</span>
              <span className="slider-val">{zoom.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="3.0"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </div>

          {/* Pan Sliders */}
          <div className="input-row">
            <div className="slider-group">
              <div className="slider-header">
                <span>Pan X</span>
                <span className="slider-val">{panX.toFixed(0)}px</span>
              </div>
              <input
                type="range"
                min="-300"
                max="300"
                step="5"
                value={panX}
                onChange={(e) => setPanX(Number(e.target.value))}
              />
            </div>

            <div className="slider-group">
              <div className="slider-header">
                <span>Pan Y</span>
                <span className="slider-val">{panY.toFixed(0)}px</span>
              </div>
              <input
                type="range"
                min="-400"
                max="400"
                step="5"
                value={panY}
                onChange={(e) => setPanY(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Crop Control Toggle */}
          <div className="form-group" style={{ marginTop: "0.25rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasCrop}
                onChange={(e) => setHasCrop(e.target.checked)}
                style={{ width: "16px", height: "16px" }}
              />
              <span className="form-label" style={{ color: "var(--text-primary)" }}>
                Enable Normalized Crop Region
              </span>
            </label>
          </div>

          {hasCrop && (
            <div className="input-row">
              <div className="slider-group">
                <div className="slider-header">
                  <span>Left / Right Crop</span>
                  <span className="slider-val">
                    {(cropLeft * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="0.45"
                  step="0.05"
                  value={cropLeft}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setCropLeft(v);
                    setCropRight(v);
                  }}
                />
              </div>

              <div className="slider-group">
                <div className="slider-header">
                  <span>Top / Bottom Crop</span>
                  <span className="slider-val">
                    {(cropTop * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="0.45"
                  step="0.05"
                  value={cropTop}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setCropTop(v);
                    setCropBottom(v);
                  }}
                />
              </div>
            </div>
          )}

          {/* Apply Composition Button */}
          <button
            className="btn btn-primary"
            onClick={handleApplyComposition}
            disabled={isApplying}
            style={{ marginTop: "auto" }}
          >
            {isApplying ? "Applying to OBS..." : "Apply Video Composition to OBS"}
          </button>

          {/* Result Alert */}
          {applyResult && (
            <div
              className={`alert-box ${
                applyResult.success ? "alert-success" : "alert-error"
              }`}
            >
              <strong>{applyResult.success ? "Success" : "Error"}:</strong>
              <span>{applyResult.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
