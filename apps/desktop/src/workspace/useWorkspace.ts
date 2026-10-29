import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/api/obs";
import type {
  ObsConnectionStatus,
  ObsStreamingOutputSettingsPayload,
  PanLimitsResponsePayload,
  ProfileSummaryDto,
  QualitySettings,
} from "@/api/obs";
import {
  draftFromProfile,
  errorMessage,
  obsConfigFromDraft,
  outputSignature,
  qualitySignature,
  type WorkspaceDraft,
} from "@/workspace/model";

// ===========================================================================
// Workspace controller
//
// One hook owns everything the single-page workspace needs. All asynchronous
// work is guarded:
//   * `activeIdRef` + `switchSeq` stop stale responses from landing on a newly
//     selected profile.
//   * Profile writes are debounced per profile and always carry the captured
//     profile id, so a delayed save can never be attributed to another profile.
//   * Every loading flag is released in `finally`.
// ===========================================================================

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type ConnState =
  | "idle"
  | "testing"
  | "connected"
  | "failed";

export interface Notice {
  id: number;
  tone: "ok" | "warn" | "danger" | "info";
  title: string;
  detail?: string | null;
}

const IDLE_STATUS: ObsConnectionStatus = {
  connected: false,
  obs_version: null,
  obs_web_socket_version: null,
  rpc_version: null,
  error_message: null,
};

const EMPTY_LIMITS: PanLimitsResponsePayload = {
  min_x: 0,
  max_x: 0,
  min_y: 0,
  max_y: 0,
  visible_width: 0,
  visible_height: 0,
  x_locked: true,
  y_locked: true,
};

let noticeSeed = 0;

export function useWorkspace() {
  // ------------------------------------------------------------ profiles ---
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>([]);
  const [activeProfile, setActiveProfile] = useState<ProfileSummaryDto | null>(null);
  const [draft, setDraft] = useState<WorkspaceDraft | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const activeIdRef = useRef<string | null>(null);
  const switchSeq = useRef(0);
  const pendingSaveRef = useRef<{ id: string; draft: WorkspaceDraft } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<WorkspaceDraft | null>(null);
  const isLiveRef = useRef(false);

  draftRef.current = draft;

  // ---------------------------------------------------------- connection ---
  const [connectionStatus, setConnectionStatus] = useState<ObsConnectionStatus>(IDLE_STATUS);
  const [connState, setConnState] = useState<ConnState>("idle");
  const [connError, setConnError] = useState<string | null>(null);
  const [scenes, setScenes] = useState<string[]>([]);
  const [scenesBusy, setScenesBusy] = useState(false);
  const [scenesError, setScenesError] = useState<string | null>(null);
  const [savingConnection, setSavingConnection] = useState(false);
  const [obsPasswordDraft, setObsPasswordDraft] = useState("");
  const obsPasswordRef = useRef<string | null>(null);

  // ---------------------------------------------------------- composition ---
  const [panLimits, setPanLimits] = useState<PanLimitsResponsePayload>(EMPTY_LIMITS);
  const [limitsBusy, setLimitsBusy] = useState(false);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<{
    tone: "ok" | "danger";
    title: string;
    detail?: string | null;
  } | null>(null);
  const [applyingComposition, setApplyingComposition] = useState(false);
  const [compositionResult, setCompositionResult] = useState<{
    tone: "ok" | "danger" | "warn";
    title: string;
    detail?: string | null;
  } | null>(null);
  const [appliedCompositionSig, setAppliedCompositionSig] = useState<string | null>(null);

  // ------------------------------------------------------ quality/output ---
  const [applyingQuality, setApplyingQuality] = useState(false);
  const [qualityResult, setQualityResult] = useState<{
    tone: "ok" | "danger";
    title: string;
    detail?: string | null;
  } | null>(null);
  const [appliedQualitySig, setAppliedQualitySig] = useState<string | null>(null);
  const [appliedOutputSig, setAppliedOutputSig] = useState<string | null>(null);
  const [outputSettings, setOutputSettings] =
    useState<ObsStreamingOutputSettingsPayload | null>(null);
  const [outputMode, setOutputMode] = useState<string | null>(null);
  const [applyingOutput, setApplyingOutput] = useState(false);
  const [outputResult, setOutputResult] = useState<{
    tone: "ok" | "danger" | "warn";
    title: string;
    detail?: string | null;
  } | null>(null);

  // ----------------------------------------------------------- credentials ---
  const [streamKey, setStreamKey] = useState("");
  const [streamKeyPresent, setStreamKeyPresent] = useState(false);
  const [revealStreamKey, setRevealStreamKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [credentialMessage, setCredentialMessage] = useState<{
    tone: "ok" | "danger";
    title: string;
  } | null>(null);

  // -------------------------------------------------------------- silent ---
  const [silentResult, setSilentResult] = useState<{
    enabled: boolean;
    source: string;
    currentMonitorType: string;
    restoreMonitorType: string | null;
    inputMuted: boolean;
  } | null>(null);
  const [silentBusy, setSilentBusy] = useState(false);
  const [silentError, setSilentError] = useState<string | null>(null);

  // -------------------------------------------------------------- stream ---
  const [streamStatus, setStreamStatus] = useState<api.StreamStatusPayload | null>(null);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [statusStale, setStatusStale] = useState(false);
  const [lastStatusAt, setLastStatusAt] = useState<number | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const pollingRef = useRef(false);

  // ------------------------------------------------------------- notices ---
  const [notices, setNotices] = useState<Notice[]>([]);

  const pushNotice = useCallback(
    (tone: Notice["tone"], title: string, detail?: string | null) => {
      noticeSeed += 1;
      const notice: Notice = { id: noticeSeed, tone, title, detail };
      setNotices((prev) => [notice, ...prev].slice(0, 4));
    },
    [],
  );

  const dismissNotice = useCallback((id: number) => {
    setNotices((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const connectionConfig = useMemo(() => {
    if (!draft) return null;
    return obsConfigFromDraft(draft, obsPasswordRef.current);
  }, [draft]);

  const configRef = useRef<api.ObsConnectionConfig | null>(null);
  configRef.current = connectionConfig;

  // ------------------------------------------------------- save pipeline ---

  const persist = useCallback(
    async (profileId: string, snapshot: WorkspaceDraft) => {
      setSaveState("saving");
      try {
        const updated = await api.updateProfile({
          id: profileId,
          name: snapshot.name,
          service_type: snapshot.serviceType,
          server_url: snapshot.serverUrl,
          obs_connection: { host: snapshot.obsHost, port: snapshot.obsPort },
          quality: snapshot.quality,
          composition: snapshot.composition,
          adaptation: snapshot.adaptation,
        });
        setProfiles((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
        if (activeIdRef.current === profileId) {
          setActiveProfile(updated);
          setSaveState("saved");
          setSaveError(null);
          setSavedAt(Date.now());
        }
      } catch (error) {
        if (activeIdRef.current === profileId) {
          setSaveState("error");
          setSaveError(errorMessage(error));
        }
      }
    },
    [],
  );

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    await persist(pending.id, pending.draft);
  }, [persist]);

  const scheduleSave = useCallback((profileId: string, snapshot: WorkspaceDraft) => {
    pendingSaveRef.current = { id: profileId, draft: snapshot };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushSave();
    }, 700);
  }, [flushSave]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  /** Single entry point for editing the active profile. */
  const patchDraft = useCallback(
    (patch: Partial<WorkspaceDraft>) => {
      const current = draftRef.current;
      if (!current) return;
      const profileId = activeIdRef.current;
      const next: WorkspaceDraft = { ...current, ...patch };
      draftRef.current = next;
      setDraft(next);
      if (profileId && !isLiveRef.current) {
        setSaveState("dirty");
        scheduleSave(profileId, next);
      }
    },
    [scheduleSave],
  );

  const patchQuality = useCallback(
    (patch: Partial<QualitySettings>) => {
      const current = draftRef.current;
      if (!current) return;
      patchDraft({ quality: { ...current.quality, ...patch } });
    },
    [patchDraft],
  );

  const patchComposition = useCallback(
    (patch: Partial<WorkspaceDraft["composition"]>) => {
      const current = draftRef.current;
      if (!current) return;
      patchDraft({ composition: { ...current.composition, ...patch } });
    },
    [patchDraft],
  );

  // --------------------------------------------------------- profile load ---

  const loadSecrets = useCallback(async (profileId: string) => {
    try {
      const [key, password] = await Promise.all([
        api.getProfileStreamKey(profileId),
        api.getProfileObsPassword(profileId),
      ]);
      if (activeIdRef.current !== profileId) return;
      obsPasswordRef.current = password;
      setStreamKey(key ?? "");
      setStreamKeyPresent(Boolean(key));
      setRevealStreamKey(false);
      setObsPasswordDraft("");
    } catch {
      // Secrets are optional at load time; surfaced only when an action needs them.
    }
  }, []);

  const resetRuntimeState = useCallback(() => {
    setConnectionStatus(IDLE_STATUS);
    setConnState("idle");
    setConnError(null);
    setScenes([]);
    setScenesError(null);
    setPanLimits(EMPTY_LIMITS);
    setDetectResult(null);
    setCompositionResult(null);
    setAppliedCompositionSig(null);
    setQualityResult(null);
    setAppliedQualitySig(null);
    setAppliedOutputSig(null);
    setOutputSettings(null);
    setOutputMode(null);
    setOutputResult(null);
    setSilentResult(null);
    setSilentError(null);
    setCredentialMessage(null);
    setStreamStatus(null);
    setStreamError(null);
    setStatusStale(false);
    setLastStatusAt(null);
    setSaveState("idle");
    setSaveError(null);
  }, []);

  const boot = useCallback(async () => {
    setBootLoading(true);
    setBootError(null);
    try {
      const list = await api.listProfiles();
      setProfiles(list);
      const active = await api.getActiveProfile();
      const chosen = active ?? list[0] ?? null;
      if (chosen) {
        activeIdRef.current = chosen.id;
        setActiveProfile(chosen);
        setDraft(draftFromProfile(chosen));
        await loadSecrets(chosen.id);
      }
    } catch (error) {
      setBootError(errorMessage(error));
    } finally {
      setBootLoading(false);
    }
  }, [loadSecrets]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // ------------------------------------------------------ profile actions ---

  const selectProfile = useCallback(
    async (id: string) => {
      if (id === activeIdRef.current || switchingId) return;
      const token = switchSeq.current + 1;
      switchSeq.current = token;
      setSwitchingId(id);
      try {
        await flushSave();
        const profile = await api.setActiveProfile(id);
        if (switchSeq.current !== token) return;
        activeIdRef.current = profile.id;
        setActiveProfile(profile);
        setDraft(draftFromProfile(profile));
        resetRuntimeState();
        setProfiles((prev) =>
          prev.map((item) => (item.id === profile.id ? profile : item)),
        );
        await loadSecrets(profile.id);
      } catch (error) {
        if (switchSeq.current === token) {
          pushNotice("danger", "Could not switch profile", errorMessage(error));
        }
      } finally {
        if (switchSeq.current === token) setSwitchingId(null);
      }
    },
    [flushSave, loadSecrets, pushNotice, resetRuntimeState, switchingId],
  );

  const createProfile = useCallback(
    async (payload: api.CreateProfilePayload) => {
      try {
        const created = await api.createProfile(payload);
        setProfiles((prev) => [...prev, created]);
        pushNotice("ok", `Profile “${created.name}” created`);
        return created;
      } catch (error) {
        pushNotice("danger", "Could not create profile", errorMessage(error));
        throw error;
      }
    },
    [pushNotice],
  );

  const renameProfile = useCallback(
    async (id: string, name: string) => {
      const record = profiles.find((item) => item.id === id);
      if (!record) return;
      try {
        const updated = await api.updateProfile({
          id: record.id,
          name: name.trim(),
          service_type: record.service_type,
          server_url: record.server_url,
          obs_connection: record.obs_connection,
          quality: record.quality,
          composition: record.composition,
          adaptation: record.adaptation,
        });
        setProfiles((prev) => prev.map((item) => (item.id === id ? updated : item)));
        if (activeIdRef.current === id) {
          setActiveProfile(updated);
          patchDraft({ name: updated.name });
        }
        pushNotice("ok", `Renamed to “${updated.name}”`);
      } catch (error) {
        pushNotice("danger", "Rename failed", errorMessage(error));
        throw error;
      }
    },
    [patchDraft, profiles, pushNotice],
  );

  const duplicateProfile = useCallback(
    async (id: string) => {
      try {
        const copy = await api.duplicateProfile(id);
        setProfiles((prev) => [...prev, copy]);
        pushNotice(
          "ok",
          `Duplicated as “${copy.name}”`,
          "Credentials are not copied — set the stream key again for this profile.",
        );
      } catch (error) {
        pushNotice("danger", "Duplicate failed", errorMessage(error));
      }
    },
    [pushNotice],
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      try {
        await api.deleteProfile(id);
        const remaining = profiles.filter((item) => item.id !== id);
        setProfiles(remaining);
        if (activeIdRef.current === id) {
          const next = remaining[0] ?? null;
          activeIdRef.current = next?.id ?? null;
          setActiveProfile(next);
          setDraft(next ? draftFromProfile(next) : null);
          resetRuntimeState();
          if (next) await loadSecrets(next.id);
        }
        pushNotice("ok", "Profile deleted");
      } catch (error) {
        pushNotice("danger", "Could not delete profile", errorMessage(error));
      }
    },
    [loadSecrets, profiles, pushNotice, resetRuntimeState],
  );

  // --------------------------------------------------------- connection ---

  const testConnection = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    if (current.obsPort < 1 || current.obsPort > 65535) {
      setConnState("failed");
      setConnError("Port must be between 1 and 65535 before testing.");
      return;
    }
    const token = switchSeq.current;
    setConnState("testing");
    setConnError(null);
    try {
      const status = await api.testObsConnection(
        obsConfigFromDraft(current, obsPasswordRef.current),
      );
      if (switchSeq.current !== token) return;
      setConnectionStatus(status);
      if (status.connected) {
        setConnState("connected");
        setConnError(null);
        setScenesBusy(true);
        try {
          const list = await api.listScenes(
            obsConfigFromDraft(current, obsPasswordRef.current),
          );
          if (switchSeq.current === token) setScenes(list);
        } catch (error) {
          if (switchSeq.current === token) setScenesError(errorMessage(error));
        } finally {
          setScenesBusy(false);
        }
      } else {
        setConnState("failed");
        setConnError(status.error_message ?? "OBS rejected the connection attempt.");
      }
    } catch (error) {
      if (switchSeq.current === token) {
        setConnectionStatus(IDLE_STATUS);
        setConnState("failed");
        setConnError(errorMessage(error));
      }
    }
  }, []);

  const refreshScenes = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    setScenesBusy(true);
    setScenesError(null);
    try {
      const list = await api.listScenes(
        obsConfigFromDraft(current, obsPasswordRef.current),
      );
      setScenes(list);
      pushNotice("ok", `${list.length} scene${list.length === 1 ? "" : "s"} loaded`);
    } catch (error) {
      setScenesError(errorMessage(error));
      pushNotice("danger", "Scene discovery failed", errorMessage(error));
    } finally {
      setScenesBusy(false);
    }
  }, [pushNotice]);

  const saveConnection = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    setSavingConnection(true);
    try {
      await flushSave();
      setSaveState("saved");
      setSavedAt(Date.now());
      pushNotice("ok", "OBS connection saved to profile", `${current.obsHost}:${current.obsPort}`);
    } catch (error) {
      pushNotice("danger", "Connection save failed", errorMessage(error));
    } finally {
      setSavingConnection(false);
    }
  }, [flushSave, pushNotice]);

  const saveObsPassword = useCallback(async () => {
    const profileId = activeIdRef.current;
    if (!profileId) return;
    if (!obsPasswordDraft) {
      pushNotice("warn", "Password is empty", "Enter the OBS WebSocket password first.");
      return;
    }
    setSavingPassword(true);
    try {
      await api.setProfileObsPassword(profileId, obsPasswordDraft);
      obsPasswordRef.current = obsPasswordDraft;
      setObsPasswordDraft("");
      setProfiles((prev) =>
        prev.map((item) =>
          item.id === profileId ? { ...item, has_obs_password: true } : item,
        ),
      );
      setActiveProfile((prev) =>
        prev && prev.id === profileId ? { ...prev, has_obs_password: true } : prev,
      );
      setCredentialMessage({ tone: "ok", title: "OBS password stored securely" });
    } catch (error) {
      setCredentialMessage({ tone: "danger", title: errorMessage(error) });
    } finally {
      setSavingPassword(false);
    }
  }, [obsPasswordDraft, pushNotice]);

  // -------------------------------------------------------- composition ---

  const composition = draft?.composition;

  useEffect(() => {
    if (!composition) return;
    const {
      source_width,
      source_height,
      canvas_width,
      canvas_height,
      zoom,
      has_crop,
      crop,
    } = composition;

    if (
      source_width < 1 ||
      source_height < 1 ||
      canvas_width < 1 ||
      canvas_height < 1
    ) {
      setPanLimits(EMPTY_LIMITS);
      return;
    }

    let cancelled = false;
    setLimitsBusy(true);
    const handle = setTimeout(async () => {
      try {
        const limits = await api.calculatePanLimits({
          source_width,
          source_height,
          canvas_width,
          canvas_height,
          zoom,
          crop: has_crop ? crop : null,
        });
        if (cancelled) return;
        setPanLimits(limits);
        setLimitsError(null);
        setDraft((prev) => {
          if (!prev) return prev;
          const clampedX = Math.min(limits.max_x, Math.max(limits.min_x, prev.composition.pan_x));
          const clampedY = Math.min(limits.max_y, Math.max(limits.min_y, prev.composition.pan_y));
          if (clampedX === prev.composition.pan_x && clampedY === prev.composition.pan_y) {
            return prev;
          }
          return {
            ...prev,
            composition: { ...prev.composition, pan_x: clampedX, pan_y: clampedY },
          };
        });
      } catch (error) {
        if (!cancelled) setLimitsError(errorMessage(error));
      } finally {
        if (!cancelled) setLimitsBusy(false);
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(handle);
      setLimitsBusy(false);
    };
  }, [
    composition?.source_width,
    composition?.source_height,
    composition?.canvas_width,
    composition?.canvas_height,
    composition?.zoom,
    composition?.has_crop,
    composition?.crop?.left,
    composition?.crop?.top,
    composition?.crop?.right,
    composition?.crop?.bottom,
  ]);

  const detectDimensions = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    const path = current.composition.source_path.trim();
    setDetecting(true);
    setDetectResult(null);
    try {
      const result = await api.probeVideoDimensions(path);
      const prefix = api.SIMULATION_MODE ? "Simulated detection · " : "";
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              composition: {
                ...prev.composition,
                source_width: result.width,
                source_height: result.height,
              },
            }
          : prev,
      );
      if (activeIdRef.current) {
        const snapshot = draftRef.current;
        if (snapshot) {
          scheduleSave(activeIdRef.current, {
            ...snapshot,
            composition: {
              ...snapshot.composition,
              source_width: result.width,
              source_height: result.height,
            },
          });
        }
      }
      setDetectResult({
        tone: "ok",
        title: `${prefix}Actual dimensions ${result.width} × ${result.height}`,
        detail: api.SIMULATION_MODE
          ? "Preview adapter only. In the desktop build this is real ffprobe metadata."
          : null,
      });
    } catch (error) {
      setDetectResult({ tone: "danger", title: errorMessage(error) });
    } finally {
      setDetecting(false);
    }
  }, [scheduleSave]);

  const applyComposition = useCallback(async () => {
    const current = draftRef.current;
    const config = configRef.current;
    if (!current || !config) return;
    if (!connectionStatus.connected) {
      setCompositionResult({
        tone: "danger",
        title: "Connection required",
        detail: "Test the OBS connection before applying composition changes.",
      });
      return;
    }
    setApplyingComposition(true);
    setCompositionResult(null);
    try {
      const applied = await api.applyVideoComposition({
        obs_config: config,
        scene_name: current.composition.scene_name,
        source_name: current.composition.source_name,
        source_path: current.composition.source_path,
        source_width: current.composition.source_width,
        source_height: current.composition.source_height,
        canvas_width: current.composition.canvas_width,
        canvas_height: current.composition.canvas_height,
        zoom: current.composition.zoom,
        pan_x: current.composition.pan_x,
        pan_y: current.composition.pan_y,
        crop: current.composition.has_crop ? current.composition.crop : null,
      });
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              composition: {
                ...prev.composition,
                pan_x: applied.applied_pan_x,
                pan_y: applied.applied_pan_y,
              },
            }
          : prev,
      );
      setAppliedCompositionSig(qualitySignatureFingerprint(current));
      setCompositionResult({
        tone: "ok",
        title: "Composition applied to OBS",
        detail: `Pan clamped to X ${applied.applied_pan_x} · Y ${applied.applied_pan_y}`,
      });
    } catch (error) {
      setCompositionResult({ tone: "danger", title: "Composition failed", detail: errorMessage(error) });
    } finally {
      setApplyingComposition(false);
    }
  }, [connectionStatus.connected]);

  const resetComposition = useCallback(() => {
    setCompositionResult({
      tone: "warn",
      title: "Reset staged in the editor only",
      detail:
        "Scene, source, media path and detected source dimensions were preserved. Press Apply Composition to push the reset geometry to OBS.",
    });
    patchComposition({
      canvas_width: 720,
      canvas_height: 1280,
      zoom: 1,
      pan_x: 0,
      pan_y: 0,
      has_crop: false,
      crop: { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 },
    });
  }, [patchComposition]);

  // ------------------------------------------------------ quality/output ---

  const applyQuality = useCallback(async () => {
    const current = draftRef.current;
    const config = configRef.current;
    if (!current || !config) return;
    if (!connectionStatus.connected) {
      setQualityResult({
        tone: "danger",
        title: "Connection required",
        detail: "Test the OBS connection before applying quality settings.",
      });
      return;
    }
    setApplyingQuality(true);
    setQualityResult(null);
    try {
      const applied = await api.applyObsQualitySettings(
        config,
        {
          base_width: current.composition.canvas_width,
          base_height: current.composition.canvas_height,
          output_width: current.quality.output_width,
          output_height: current.quality.output_height,
          fps_numerator: current.quality.fps,
          fps_denominator: 1,
        },
        current.quality,
      );
      setAppliedQualitySig(qualitySignature(current.quality));
      setOutputMode(applied.output_mode);
      setQualityResult({
        tone: "ok",
        title: "Quality applied to OBS",
        detail: `${applied.video_settings.output_width}×${applied.video_settings.output_height} · ${
          applied.video_bitrate_kbps
        } kbps ${applied.encoder}/${applied.rate_control} · ${applied.output_mode} output`,
      });
    } catch (error) {
      setQualityResult({ tone: "danger", title: "Quality apply failed", detail: errorMessage(error) });
    } finally {
      setApplyingQuality(false);
    }
  }, [connectionStatus.connected]);

  const resetQuality = useCallback(() => {
    const preset = api.QUALITY_PRESETS.balanced;
    patchQuality({ ...preset });
    setQualityResult({
      tone: "ok",
      title: "Quality reset to the Balanced preset",
      detail: "Staged only — press Apply Quality Settings to push it to OBS.",
    });
  }, [patchQuality]);

  const readOutputSettings = useCallback(async () => {
    const config = configRef.current;
    if (!config) return;
    try {
      const settings = await api.getObsStreamingOutputSettings(config);
      setOutputSettings(settings);
      setOutputMode(settings.output_mode);
      setAppliedOutputSig(outputSignature(settings));
    } catch (error) {
      setOutputResult({ tone: "danger", title: "Could not read output settings", detail: errorMessage(error) });
    }
  }, []);

  const applyOutput = useCallback(async () => {
    const current = draftRef.current;
    const config = configRef.current;
    if (!current || !config) return;
    if (!connectionStatus.connected) {
      setOutputResult({
        tone: "danger",
        title: "Connection required",
        detail: "Test the OBS connection before applying output options.",
      });
      return;
    }
    setApplyingOutput(true);
    setOutputResult(null);
    try {
      const payload: api.ObsStreamingOutputOptionsPayload = {
        rescale_output_enabled: current.quality.rescale_output_enabled,
        rescale_output_width: current.quality.rescale_output_width,
        rescale_output_height: current.quality.rescale_output_height,
        rescale_filter: current.quality.rescale_filter,
        dynamic_bitrate_enabled: current.quality.dynamic_bitrate_enabled,
      };
      const applied = await api.applyObsStreamingOutputSettings(config, payload);
      setOutputSettings(applied);
      setOutputMode(applied.output_mode);
      setAppliedOutputSig(outputSignature(applied));
      setOutputResult({
        tone: applied.rescale_output_enabled !== payload.rescale_output_enabled ? "warn" : "ok",
        title: "Output options applied",
        detail: `Read-back: rescale ${
          applied.rescale_output_enabled
            ? `${applied.rescale_output_width}×${applied.rescale_output_height} ${applied.rescale_filter}`
            : "off"
        } · dynamic bitrate ${applied.dynamic_bitrate_enabled ? "on" : "off"} · ${applied.output_mode} mode`,
      });
    } catch (error) {
      setOutputResult({ tone: "danger", title: "Output apply failed", detail: errorMessage(error) });
    } finally {
      setApplyingOutput(false);
    }
  }, [connectionStatus.connected]);

  // ------------------------------------------------------------ silent ---

  const toggleSilentMode = useCallback(
    async (enabled: boolean) => {
      const current = draftRef.current;
      const config = configRef.current;
      if (!current || !config) return;
      if (!connectionStatus.connected) {
        setSilentError("Connection required: connect to OBS before changing Silent Mode.");
        return;
      }
      setSilentBusy(true);
      setSilentError(null);
      try {
        const result = await api.setObsLocalSilentMode(config, {
          source_name: current.composition.source_name,
          enabled,
          restore_monitor_type: enabled
            ? silentResult?.currentMonitorType ??
              (current.composition.silent_mode_restore_monitor_type || null)
            : current.composition.silent_mode_restore_monitor_type || null,
        });
        setSilentResult({
          enabled: result.silent_mode_enabled,
          source: result.source_name,
          currentMonitorType: result.current_monitor_type,
          restoreMonitorType: result.restore_monitor_type,
          inputMuted: result.input_muted,
        });
        patchComposition({
          silent_mode_enabled: result.silent_mode_enabled,
          silent_mode_source_name: result.source_name,
          silent_mode_restore_monitor_type: result.restore_monitor_type ?? "",
        });
        if (!result.silent_mode_enabled) {
          pushNotice(
            "ok",
            "Monitoring restored",
            `“${result.source_name}” monitor type is now ${result.current_monitor_type}.`,
          );
        } else {
          pushNotice(
            "ok",
            "Silent Mode enabled",
            `Local monitoring muted for “${result.source_name}”. Stream audio is unchanged.`,
          );
        }
      } catch (error) {
        setSilentError(errorMessage(error));
      } finally {
        setSilentBusy(false);
      }
    },
    [connectionStatus.connected, patchComposition, pushNotice, silentResult],
  );

  // ------------------------------------------------------- credentials ---

  const saveStreamKey = useCallback(async () => {
    const profileId = activeIdRef.current;
    if (!profileId) return;
    if (!streamKey.trim()) {
      setCredentialMessage({ tone: "danger", title: "Stream key cannot be empty." });
      return;
    }
    setSavingKey(true);
    try {
      await api.setProfileStreamKey(profileId, streamKey.trim());
      setStreamKeyPresent(true);
      setProfiles((prev) =>
        prev.map((item) => (item.id === profileId ? { ...item, has_credential: true } : item)),
      );
      setActiveProfile((prev) =>
        prev && prev.id === profileId ? { ...prev, has_credential: true } : prev,
      );
      setCredentialMessage({
        tone: "ok",
        title: api.SIMULATION_MODE
          ? "Preview key stored in memory only — not the Windows credential vault"
          : "Stream key stored in the secure credential store",
      });
    } catch (error) {
      setCredentialMessage({ tone: "danger", title: errorMessage(error) });
    } finally {
      setSavingKey(false);
    }
  }, [streamKey]);

  // ------------------------------------------------------------ stream ---

  const statusConfigKey = connectionConfig
    ? `${connectionConfig.host}:${connectionConfig.port}`
    : "none";

  isLiveRef.current = live;

  useEffect(() => {
    if (!live) return;
    let cancelled = false;

    const tick = async () => {
      const config = configRef.current;
      if (!config || pollingRef.current) return;
      pollingRef.current = true;
      try {
        const status = await api.getStreamStatus(config);
        if (cancelled) return;
        setStreamStatus(status);
        setStatusStale(false);
        setLastStatusAt(Date.now());
        if (!status.active) {
          setLive(false);
          setAwaitingConfirm(false);
        }
      } catch {
        if (!cancelled) setStatusStale(true);
      } finally {
        pollingRef.current = false;
      }
    };

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, 1600);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [live, statusConfigKey]);

  const startStreamingNow = useCallback(async () => {
    const current = draftRef.current;
    const config = configRef.current;
    const profileId = activeIdRef.current;
    if (!current || !config || !profileId) return;
    if (starting || stopping || live) return;
    if (!connectionStatus.connected) {
      setStreamError("Connection required: test the OBS connection before going live.");
      return;
    }
    if (current.quality.rescale_output_enabled && current.composition.canvas_width <= 0) {
      setStreamError("Canvas is not configured.");
      return;
    }
    setStarting(true);
    setStreamError(null);
    setOperation("start");
    try {
      await flushSave();
      await api.startProfileStream({ obs_config: config, profile_id: profileId });
      setAwaitingConfirm(true);
      // Do not report success from the request alone — confirm with OBS status.
      const status = await api.getStreamStatus(config);
      setStreamStatus(status);
      setLastStatusAt(Date.now());
      if (status.active) {
        setLive(true);
        setAwaitingConfirm(false);
        pushNotice("ok", "Stream is live", `${current.serverUrl || "Destination"} · ${current.name}`);
      } else {
        setLive(true); // begin polling until OBS reports the stream
        pushNotice(
          "warn",
          "Start request accepted",
          "Waiting for OBS to confirm the stream is live.",
        );
      }
    } catch (error) {
      setStreamError(errorMessage(error));
      setLive(false);
      setAwaitingConfirm(false);
    } finally {
      setStarting(false);
      setOperation(null);
    }
  }, [
    connectionStatus.connected,
    flushSave,
    live,
    pushNotice,
    starting,
    stopping,
  ]);

  const stopStreamingNow = useCallback(async () => {
    const config = configRef.current;
    if (!config) return;
    if (starting || stopping) return;
    setStopping(true);
    setStreamError(null);
    setOperation("stop");
    try {
      await api.stopStream(config);
      const status = await api.getStreamStatus(config);
      setStreamStatus(status);
      setLastStatusAt(Date.now());
      setLive(status.active);
      setAwaitingConfirm(false);
      if (!status.active) pushNotice("ok", "Broadcast stopped");
    } catch (error) {
      setStreamError(errorMessage(error));
    } finally {
      setStopping(false);
      setOperation(null);
    }
  }, [starting, stopping]);

  // ------------------------------------------------------------ derived ---

  const compositionSig = useMemo(
    () => (draft ? qualitySignatureFingerprint(draft) : null),
    [draft],
  );

  const qualityDirty = Boolean(
    draft && appliedQualitySig && appliedQualitySig !== qualitySignature(draft.quality),
  );
  const compositionDirty = Boolean(
    draft && appliedCompositionSig && appliedCompositionSig !== compositionSig,
  );
  const outputDirty = Boolean(
    draft &&
      appliedOutputSig &&
      appliedOutputSig !==
        outputSignature({
          rescale_output_enabled: draft.quality.rescale_output_enabled,
          rescale_output_width: draft.quality.rescale_output_width,
          rescale_output_height: draft.quality.rescale_output_height,
          rescale_filter: draft.quality.rescale_filter,
          dynamic_bitrate_enabled: draft.quality.dynamic_bitrate_enabled,
        }),
  );

  const rescaleSupported = outputMode !== null ? outputMode === "advanced" : null;

  const busy = Boolean(switchingId) || starting || stopping;

  return {
    // data
    profiles,
    activeProfile,
    draft,
    bootLoading,
    bootError,
    switchingId,
    busy,
    // persistence
    saveState,
    saveError,
    savedAt,
    flushSave,
    patchDraft,
    patchQuality,
    patchComposition,
    // connection
    connectionConfig,
    connectionStatus,
    connState,
    connError,
    scenes,
    scenesBusy,
    scenesError,
    testConnection,
    refreshScenes,
    saveConnection,
    savingConnection,
    obsPasswordDraft,
    setObsPasswordDraft,
    saveObsPassword,
    savingPassword,
    // composition
    panLimits,
    limitsBusy,
    limitsError,
    detecting,
    detectResult,
    detectDimensions,
    applyingComposition,
    compositionResult,
    applyComposition,
    resetComposition,
    compositionDirty,
    appliedCompositionSig,
    // quality
    applyingQuality,
    qualityResult,
    applyQuality,
    resetQuality,
    qualityDirty,
    appliedQualitySig,
    // output
    outputSettings,
    outputMode,
    applyingOutput,
    outputResult,
    applyOutput,
    readOutputSettings,
    outputDirty,
    rescaleSupported,
    // silent
    silentResult,
    silentBusy,
    silentError,
    toggleSilentMode,
    // credentials
    streamKey,
    setStreamKey,
    streamKeyPresent,
    revealStreamKey,
    setRevealStreamKey,
    saveStreamKey,
    savingKey,
    credentialMessage,
    // stream
    streamStatus,
    live,
    starting,
    stopping,
    streamError,
    statusStale,
    lastStatusAt,
    awaitingConfirm,
    startStreamingNow,
    stopStreamingNow,
    // notices
    notices,
    pushNotice,
    dismissNotice,
    // profile actions
    selectProfile,
    createProfile,
    renameProfile,
    duplicateProfile,
    deleteProfile,
    // misc
    reload: boot,
  };
}

/** Composition identity used for pending/applied comparison. */
function qualitySignatureFingerprint(draft: WorkspaceDraft): string {
  const c = draft.composition;
  return JSON.stringify({
    scene: c.scene_name,
    source: c.source_name,
    path: c.source_path,
    sw: c.source_width,
    sh: c.source_height,
    cw: c.canvas_width,
    ch: c.canvas_height,
    zoom: c.zoom,
    px: c.pan_x,
    py: c.pan_y,
    crop: c.has_crop ? c.crop : null,
  });
}

export type WorkspaceApi = ReturnType<typeof useWorkspace>;
