import { useState, useEffect, useRef, useTransition } from "react";
import {
  testObsConnection,
  listScenes,
  applyVideoComposition,
  calculatePanLimits,
  probeVideoDimensions,
  getObsVideoSettings,
  applyObsQualitySettings,
  getObsStreamingOutputSettings,
  applyObsStreamingOutputSettings,
  getStreamStatus,
  startProfileStream,
  stopStream,
  listProfiles,
  getActiveProfile,
  setActiveProfile as setActiveProfileApi,
  createProfile,
  updateProfile,
  duplicateProfile,
  deleteProfile,
  getProfileStreamKey,
  setProfileStreamKey,
  getProfileObsPassword,
  setProfileObsPassword,
  ObsConnectionConfig,
  ObsConnectionStatus,
  ApplyCompositionPayload,
  StreamStatusPayload,
  ProfileSummaryDto,
  ObsVideoSettingsPayload,
  PanLimitsResponsePayload,
} from "./api/obs";
import "./App.css";

export default function App() {
  // Connection settings are loaded from the selected profile. Passwords are read only from OS Credential Manager.
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

  const [availableScenes, setAvailableScenes] = useState<string[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [obsVideoSettings, setObsVideoSettingsState] = useState<ObsVideoSettingsPayload | null>(null);

  // ── Profiles ────────────────────────────────────────────────────────────
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>([]);
  const [activeProfile, setActiveProfileState] = useState<ProfileSummaryDto | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [isRenamingProfile, setIsRenamingProfile] = useState(false);
  const [profileRenameMessage, setProfileRenameMessage] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [streamKey, setStreamKey] = useState<string>("");
  const [showStreamKey, setShowStreamKey] = useState(false);
  const [keySavedMessage, setKeySavedMessage] = useState<string | null>(null);
  const [isSavingKey, setIsSavingKey] = useState(false);

  // Profile Modals
  const [showNewProfileModal, setShowNewProfileModal] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfilePreset, setNewProfilePreset] = useState("balanced");
  const [newProfileServer, setNewProfileServer] = useState("");
  const [newProfileKey, setNewProfileKey] = useState("");

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── Scene & Composition ─────────────────────────────────────────────────
  const [sceneName, setSceneName] = useState("Tango Scene");
  const [sourceName, setSourceName] = useState("Tango Video");
  // Empty until a real local video is selected/entered and its dimensions are detected or entered manually.
  const [sourcePath, setSourcePath] = useState("");

  // Source Size is user-editable; ffprobe is only an optional convenience.
  // Preserve the original geometry defaults and do not require external probing.
  const [sourceWidth, setSourceWidth] = useState(568);
  const [sourceHeight, setSourceHeight] = useState(762);
  const [isDetectingSourceDimensions, setIsDetectingSourceDimensions] = useState(false);
  const [sourceDimensionsMessage, setSourceDimensionsMessage] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(720);
  const [canvasHeight, setCanvasHeight] = useState(1280);

  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const [hasCrop, setHasCrop] = useState(false);
  const [cropLeft, setCropLeft] = useState(0.1);
  const [cropTop, setCropTop] = useState(0.1);
  const [cropRight, setCropRight] = useState(0.1);
  const [cropBottom, setCropBottom] = useState(0.1);

  // Computed Safe Pan Limits
  const [panLimits, setPanLimits] = useState<PanLimitsResponsePayload>({
    min_x: 0,
    max_x: 0,
    min_y: 0,
    max_y: 0,
    visible_width: 0,
    visible_height: 0,
    x_locked: true,
    y_locked: true,
  });

  const [isApplyingComposition, setIsApplyingComposition] = useState(false);
  const [applyResult, setApplyResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // ── Quality Settings & Staging ──────────────────────────────────────────
  const [isApplyingQuality, setIsApplyingQuality] = useState(false);
  const [isResettingQuality, setIsResettingQuality] = useState(false);
  const [isApplyingOutputOptions, setIsApplyingOutputOptions] = useState(false);
  const [obsOutputMode, setObsOutputMode] = useState<string | null>(null);
  const [outputOptionsMessage, setOutputOptionsMessage] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [qualityMessage, setQualityMessage] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // ── Streaming & Live Health ─────────────────────────────────────────────
  const [streamStatus, setStreamStatus] = useState<StreamStatusPayload | null>(null);
  const [isStartingStream, setIsStartingStream] = useState(false);
  const [isStoppingStream, setIsStoppingStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestProfileRef = useRef<ProfileSummaryDto | null>(null);
  const skipCompositionPersistenceRef = useRef(false);
  const skipConnectionPersistenceRef = useRef(false);
  const skipStreamKeyPersistenceRef = useRef(false);
  const skipObsPasswordPersistenceRef = useRef(false);
  const [isSavingObsConnection, setIsSavingObsConnection] = useState(false);
  const [obsConnectionMessage, setObsConnectionMessage] = useState<{ success: boolean; message: string } | null>(null);
  const [, startTransition] = useTransition();


  // Init: test OBS connection and load profiles
  useEffect(() => {
    loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    latestProfileRef.current = activeProfile;
  }, [activeProfile]);

  // Recalculate Safe Pan Limits whenever geometry inputs change
  useEffect(() => {
    async function updateLimits() {
      if (sourceWidth < 1 || sourceHeight < 1 || canvasWidth < 1 || canvasHeight < 1) {
        setPanLimits({
          min_x: 0, max_x: 0, min_y: 0, max_y: 0,
          visible_width: 0, visible_height: 0,
          x_locked: true, y_locked: true,
        });
        setPanX(0);
        setPanY(0);
        return;
      }
      try {
        const res = await calculatePanLimits({
          source_width: sourceWidth,
          source_height: sourceHeight,
          canvas_width: canvasWidth,
          canvas_height: canvasHeight,
          zoom,
          crop: hasCrop
            ? { left: cropLeft, top: cropTop, right: cropRight, bottom: cropBottom }
            : null,
        });

        setPanLimits(res);

        // Clamp pan values within the safe range
        setPanX((prev) => Math.max(res.min_x, Math.min(res.max_x, prev)));
        setPanY((prev) => Math.max(res.min_y, Math.min(res.max_y, prev)));
      } catch (err) {
        console.error("Failed to compute pan limits:", err);
      }
    }
    updateLimits();
  }, [sourceWidth, sourceHeight, canvasWidth, canvasHeight, zoom, hasCrop, cropLeft, cropTop, cropRight, cropBottom]);

  // Poll stream status every 2.5s while connected
  useEffect(() => {
    if (connectionStatus.connected) {
      pollStreamStatus();
      statusPollRef.current = setInterval(pollStreamStatus, 2500);
    } else {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
        statusPollRef.current = null;
      }
      setStreamStatus(null);
    }
    return () => {
      if (statusPollRef.current) clearInterval(statusPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus.connected, obsConfig.host, obsConfig.port, obsConfig.password]);

  // ── Profiles Management Handlers ────────────────────────────────────────
  async function loadProfiles() {
    try {
      const list = await listProfiles();
      setProfiles(list);
      const active = await getActiveProfile();
      if (active) {
        applyProfileToState(active);
      } else if (list.length > 0) {
        const first = await setActiveProfileApi(list[0].id);
        applyProfileToState(first);
      }
    } catch (err) {
      console.error("Failed to load profiles:", err);
    }
  }

  async function applyProfileToState(profile: ProfileSummaryDto) {
    skipCompositionPersistenceRef.current = true;
    skipConnectionPersistenceRef.current = true;
    skipStreamKeyPersistenceRef.current = true;
    skipObsPasswordPersistenceRef.current = true;
    setActiveProfileState(profile);

    // Restore all source geometry and canvas values belonging to this profile.
    setSceneName(profile.composition.scene_name);
    setSourceName(profile.composition.source_name);
    setSourcePath(profile.composition.source_path ?? "");
    setSourceWidth(profile.composition.source_width > 0 ? profile.composition.source_width : 568);
    setSourceHeight(profile.composition.source_height > 0 ? profile.composition.source_height : 762);
    setCanvasWidth(profile.composition.canvas_width);
    setCanvasHeight(profile.composition.canvas_height);
    setZoom(profile.composition.zoom ?? 1.0);
    setPanX(profile.composition.pan_x ?? 0);
    setPanY(profile.composition.pan_y ?? 0);
    const crop = profile.composition.crop ?? { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 };
    setHasCrop(profile.composition.has_crop ?? (profile.composition.crop !== null));
    setCropLeft(crop.left);
    setCropTop(crop.top);
    setCropRight(crop.right);
    setCropBottom(crop.bottom);
    setSourceDimensionsMessage(null);

    const nextConfig: ObsConnectionConfig = {
      host: profile.obs_connection?.host || "127.0.0.1",
      port: profile.obs_connection?.port || 4455,
      password: "",
    };
    setObsConnectionMessage(null);

    // Load both secrets before changing the connection state. This avoids a transient
    // blank-password render accidentally deleting a saved password during profile switch.
    const [keyResult, passwordResult] = await Promise.allSettled([
      getProfileStreamKey(profile.id),
      getProfileObsPassword(profile.id),
    ]);
    setStreamKey(keyResult.status === "fulfilled" ? keyResult.value ?? "" : "");

    if (passwordResult.status === "fulfilled") {
      const connection: ObsConnectionConfig = { ...nextConfig, password: passwordResult.value ?? "" };
      setObsConfig(connection);
      await handleTestConnection(connection);
    } else {
      setObsConfig(nextConfig);
      setConnectionStatus({
        connected: false,
        obs_version: null,
        obs_web_socket_version: null,
        rpc_version: null,
        error_message: `Could not load this profile's OBS password from the OS credential store: ${String(passwordResult.reason)}`,
      });
    }
  }


  async function persistCurrentComposition(profile: ProfileSummaryDto): Promise<ProfileSummaryDto> {
    const host = obsConfig.host.trim();
    const port = Math.trunc(Number(obsConfig.port));
    if (!host || port < 1 || port > 65535) {
      throw new Error("Enter a valid OBS host and a port from 1 to 65535 before switching profiles or starting a stream.");
    }
    const password = (obsConfig.password ?? "").trim();
    // Persist non-empty passwords when leaving the profile or starting a stream; blank input
    // never deletes a secret implicitly. Removing a stored password requires the explicit Save button.
    if (password) await setProfileObsPassword(profile.id, password);
    const saved = await updateProfile({
      ...profile,
      obs_connection: { host, port },
      composition: {
        ...profile.composition,
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
        has_crop: hasCrop,
        crop: { left: cropLeft, top: cropTop, right: cropRight, bottom: cropBottom },
      },
    });
    setProfiles((current) => current.map((item) => item.id === saved.id ? saved : item));
    setActiveProfileState((current) => current?.id === saved.id ? saved : current);
    return saved;
  }
  async function handleSwitchProfile(profileId: string) {
    if (streamStatus?.active) {
      alert("Cannot switch streaming profiles while live streaming. Stop the stream first.");
      return;
    }
    try {
      if (activeProfile) {
        await persistCurrentComposition(activeProfile);
        if (streamKey.trim() || activeProfile.has_credential) {
          await setProfileStreamKey(activeProfile.id, streamKey);
        }
      }
      const selected = await setActiveProfileApi(profileId);
      applyProfileToState(selected);
      setKeySavedMessage(null);
    } catch (err) {
      alert(`Failed to switch profile: ${err}`);
    }
  }

  function handleStartRenameProfile(profile: ProfileSummaryDto) {
    setEditingProfileId(profile.id);
    setProfileNameDraft(profile.name);
    setProfileRenameMessage(null);
  }

  function handleCancelRenameProfile() {
    setEditingProfileId(null);
    setProfileNameDraft("");
    setProfileRenameMessage(null);
  }

  async function handleRenameProfile(profile: ProfileSummaryDto) {
    const name = profileNameDraft.trim();
    if (!name) {
      setProfileRenameMessage({ success: false, message: "Profile name cannot be empty." });
      return;
    }
    if (name === profile.name) {
      handleCancelRenameProfile();
      return;
    }

    setIsRenamingProfile(true);
    setProfileRenameMessage(null);
    try {
      const updated = await updateProfile({ ...profile, name });
      setProfiles((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (activeProfile?.id === updated.id) {
        setActiveProfileState(updated);
      }
      setEditingProfileId(null);
      setProfileNameDraft("");
      setProfileRenameMessage({ success: true, message: `Profile renamed to "${updated.name}".` });
    } catch (err) {
      setProfileRenameMessage({ success: false, message: `Failed to rename profile: ${String(err)}` });
    } finally {
      setIsRenamingProfile(false);
    }
  }
  async function handleCreateProfile() {
    if (!newProfileName.trim()) return;
    try {
      const created = await createProfile({
        name: newProfileName.trim(),
        service_type: "tango",
        server_url: newProfileServer.trim(),
        stream_key: newProfileKey.trim(),
        preset: newProfilePreset,
      });
      setShowNewProfileModal(false);
      setNewProfileName("");
      setNewProfileServer("");
      setNewProfileKey("");
      await loadProfiles();
      applyProfileToState(created);
    } catch (err) {
      alert(`Failed to create profile: ${err}`);
    }
  }

  async function handleDuplicateProfile() {
    if (!activeProfile) return;
    try {
      const dup = await duplicateProfile(activeProfile.id);
      await loadProfiles();
      applyProfileToState(dup);
    } catch (err) {
      alert(`Failed to duplicate profile: ${err}`);
    }
  }

  async function handleDeleteProfile() {
    if (!activeProfile) return;
    if (profiles.length <= 1) {
      alert("Cannot delete the only remaining profile.");
      return;
    }
    try {
      await deleteProfile(activeProfile.id);
      setShowDeleteConfirm(false);
      await loadProfiles();
    } catch (err) {
      alert(`Failed to delete profile: ${err}`);
    }
  }

  async function handleSaveStreamKey() {
    if (!activeProfile) return;
    setIsSavingKey(true);
    setKeySavedMessage(null);
    try {
      await setProfileStreamKey(activeProfile.id, streamKey);
      setKeySavedMessage("Stream key saved securely in OS Credential Manager!");
      setTimeout(() => setKeySavedMessage(null), 4000);
      const updated = await listProfiles();
      setProfiles(updated);
      const refreshedActive = updated.find((profile) => profile.id === activeProfile.id);
      if (refreshedActive) setActiveProfileState(refreshedActive);
    } catch (err) {
      alert(`Failed to save stream key securely: ${err}`);
    } finally {
      setIsSavingKey(false);
    }
  }

  async function handleSaveObsConnection() {
    if (!activeProfile) return;
    const host = obsConfig.host.trim();
    const port = Math.trunc(Number(obsConfig.port));
    if (!host || port < 1 || port > 65535) {
      setObsConnectionMessage({ success: false, message: "Enter a valid OBS host and a port from 1 to 65535." });
      return;
    }

    const connection: ObsConnectionConfig = { host, port, password: (obsConfig.password ?? "").trim() };
    setIsSavingObsConnection(true);
    setObsConnectionMessage(null);
    try {
      if (!connection.password && activeProfile.has_obs_password) {
        await setProfileObsPassword(activeProfile.id, "");
      }
      const saved = await persistCurrentComposition(activeProfile);
      setActiveProfileState(saved);
      setProfiles((current) => current.map((item) => item.id === saved.id ? saved : item));
      setObsConfig(connection);
      setObsConnectionMessage({ success: true, message: "OBS host, port, and password saved for this profile. The password is stored in the OS credential vault." });
      await handleTestConnection(connection);
    } catch (err) {
      setObsConnectionMessage({ success: false, message: `Could not save this profile's OBS connection: ${String(err)}` });
    } finally {
      setIsSavingObsConnection(false);
    }
  }

  // ── Connection handlers ─────────────────────────────────────────────────
  async function handleTestConnection(config: ObsConnectionConfig = obsConfig) {
    setIsTesting(true);
    setApplyResult(null);
    try {
      const res = await testObsConnection(config);
      setConnectionStatus(res);
      if (res.connected) {
        try {
          const scenes = await listScenes(config);
          setAvailableScenes(scenes);
          const vs = await getObsVideoSettings(config);
          setObsVideoSettingsState(vs);
          try {
            const outputOptions = await getObsStreamingOutputSettings(config);
            setObsOutputMode(outputOptions.output_mode);
          } catch (outputOptionsError) {
            setObsOutputMode(null);
            console.warn("Could not read current OBS output mode:", outputOptionsError);
          }
        } catch {
          // ignore
        }
      }
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

  // ── Video Composition handlers ──────────────────────────────────────────
  async function handleDetectSourceDimensions() {
    const path = sourcePath.trim();
    if (!path) {
      setSourceDimensionsMessage({ success: false, message: "Enter the full path to a local video file first." });
      return;
    }

    setIsDetectingSourceDimensions(true);
    setSourceDimensionsMessage(null);
    try {
      const dimensions = await probeVideoDimensions(path);
      setSourceWidth(dimensions.width);
      setSourceHeight(dimensions.height);
      setPanX(0);
      setPanY(0);
      setSourceDimensionsMessage({
        success: true,
        message: `Detected actual video size: ${dimensions.width} × ${dimensions.height}. You may still override these values manually.`,
      });
    } catch (err) {
      setSourceDimensionsMessage({
        success: false,
        message: String(err),
      });
    } finally {
      setIsDetectingSourceDimensions(false);
    }
  }

  async function handleApplyComposition() {
    if (!sourcePath.trim() || sourceWidth < 1 || sourceHeight < 1) {
      setApplyResult({
        success: false,
        message: "Enter a real video file path and detect or enter valid source dimensions before applying composition.",
      });
      return;
    }
    setIsApplyingComposition(true);
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
        ? { left: cropLeft, top: cropTop, right: cropRight, bottom: cropBottom }
        : null,
    };

    try {
      const applied = await applyVideoComposition(payload);
      setPanX(applied.applied_pan_x);
      setPanY(applied.applied_pan_y);
      setApplyResult({
        success: true,
        message: `Composition applied to scene "${sceneName}" with safe Pan limits enforced by Rust.`,
      });
    } catch (err) {
      setApplyResult({ success: false, message: String(err) });
    } finally {
      setIsApplyingComposition(false);
    }
  }

  function handleResetComposition() {
    // Reset canvas and transform/crop controls only. Preserve the selected scene,
    // source name/path, and actual source dimensions detected from the media file.
    setCanvasWidth(720);
    setCanvasHeight(1280);
    setZoom(1.0);
    setPanX(0);
    setPanY(0);
    setHasCrop(false);
    setCropLeft(0.1);
    setCropTop(0.1);
    setCropRight(0.1);
    setCropBottom(0.1);
    setApplyResult(null);
  }
  // Auto-save the selected profile's stream key to its isolated OS credential entry.
  useEffect(() => {
    if (!activeProfile) return;
    if (skipStreamKeyPersistenceRef.current) {
      skipStreamKeyPersistenceRef.current = false;
      return;
    }
    if (!streamKey.trim() && !activeProfile.has_credential) return;

    const profileId = activeProfile.id;
    const value = streamKey;
    const timer = window.setTimeout(async () => {
      const latest = latestProfileRef.current;
      if (!latest || latest.id !== profileId) return;
      try {
        await setProfileStreamKey(profileId, value);
        const updated = await listProfiles();
        setProfiles(updated);
        const refreshed = updated.find((profile) => profile.id === profileId);
        if (refreshed) setActiveProfileState((current) => current?.id === profileId ? refreshed : current);
      } catch (err) {
        console.error("Failed to auto-save this profile's stream key securely:", err);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeProfile?.id, streamKey]);

  // Auto-save the OBS WebSocket password to this profile's separate OS credential entry.
  useEffect(() => {
    if (!activeProfile) return;
    if (skipObsPasswordPersistenceRef.current) {
      skipObsPasswordPersistenceRef.current = false;
      return;
    }
    const profileId = activeProfile.id;
    const value = (obsConfig.password ?? "").trim();
    const timer = window.setTimeout(async () => {
      const latest = latestProfileRef.current;
      if (!latest || latest.id !== profileId) return;
      if (!value && !latest.has_obs_password) return;
      try {
        await setProfileObsPassword(profileId, value);
        const updated = await listProfiles();
        setProfiles(updated);
        const refreshed = updated.find((profile) => profile.id === profileId);
        if (refreshed) setActiveProfileState((current) => current?.id === profileId ? refreshed : current);
      } catch (err) {
        console.error("Failed to auto-save the OBS password securely for this profile:", err);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeProfile?.id, obsConfig.password]);

  // Debounce profile-owned composition and OBS host/port together to avoid competing profile writes.
  useEffect(() => {
    if (!activeProfile) return;
    if (skipCompositionPersistenceRef.current || skipConnectionPersistenceRef.current) {
      skipCompositionPersistenceRef.current = false;
      skipConnectionPersistenceRef.current = false;
      return;
    }

    const profileId = activeProfile.id;
    const crop = { left: cropLeft, top: cropTop, right: cropRight, bottom: cropBottom };
    const host = obsConfig.host.trim();
    const port = Math.trunc(Number(obsConfig.port));
    const connectionIsValid = Boolean(host) && port >= 1 && port <= 65535;
    const existing = activeProfile.composition;
    const sameCrop = existing.has_crop === hasCrop && JSON.stringify(existing.crop ?? { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 }) === JSON.stringify(crop);
    const sameComposition = existing.scene_name === sceneName &&
      existing.source_name === sourceName && existing.source_path === sourcePath &&
      existing.source_width === sourceWidth && existing.source_height === sourceHeight &&
      existing.canvas_width === canvasWidth && existing.canvas_height === canvasHeight &&
      existing.zoom === zoom && existing.pan_x === panX && existing.pan_y === panY && sameCrop;
    const existingConnection = activeProfile.obs_connection;
    const sameConnection = connectionIsValid && host === existingConnection.host && port === existingConnection.port;
    if (sameComposition && (sameConnection || !connectionIsValid)) return;

    const timer = window.setTimeout(async () => {
      const latest = latestProfileRef.current;
      if (!latest || latest.id !== profileId) return;
      const updated: ProfileSummaryDto = {
        ...latest,
        obs_connection: connectionIsValid ? { host, port } : latest.obs_connection,
        composition: {
          ...latest.composition,
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
          has_crop: hasCrop,
          crop,
        },
      };
      try {
        const saved = await updateProfile(updated);
        setProfiles((current) => current.map((item) => item.id === saved.id ? saved : item));
        setActiveProfileState((current) => current?.id === saved.id ? saved : current);
      } catch (err) {
        console.error("Failed to auto-save settings to profile:", err);
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeProfile?.id, sceneName, sourceName, sourcePath, sourceWidth, sourceHeight,
      canvasWidth, canvasHeight, zoom, panX, panY, hasCrop, cropLeft, cropTop, cropRight, cropBottom,
      obsConfig.host, obsConfig.port]);


  // ── Quality Settings Staging handlers ───────────────────────────────────
  function handlePresetChange(preset: "balanced" | "low_bandwidth" | "very_low_bandwidth") {
    if (!activeProfile) return;
    let newQuality = { ...activeProfile.quality };
    if (preset === "balanced") {
      newQuality = {
        ...newQuality,
        output_width: 720,
        output_height: 1280,
        fps: 30,
        video_bitrate_kbps: 2500,
        audio_bitrate_kbps: 128,
      };
    } else if (preset === "low_bandwidth") {
      newQuality = {
        ...newQuality,
        output_width: 720,
        output_height: 1280,
        fps: 30,
        video_bitrate_kbps: 1500,
        audio_bitrate_kbps: 96,
      };
    } else if (preset === "very_low_bandwidth") {
      newQuality = {
        ...newQuality,
        output_width: 540,
        output_height: 960,
        fps: 25,
        video_bitrate_kbps: 800,
        audio_bitrate_kbps: 64,
      };
    }

    const updatedProfile: ProfileSummaryDto = {
      ...activeProfile,
      quality: newQuality,
    };
    setActiveProfileState(updatedProfile);
    updateProfile(updatedProfile).catch(console.error);
  }

  async function handleResetQualitySettings() {
    if (!activeProfile) return;
    if (isStreaming) {
      setQualityMessage({ success: false, message: "Stop the stream before resetting this profile's quality settings." });
      return;
    }

    const resetProfile: ProfileSummaryDto = {
      ...activeProfile,
      quality: {
        output_width: 720,
        output_height: 1280,
        fps: 30,
        video_bitrate_kbps: 2500,
        audio_bitrate_kbps: 128,
        encoder: "obs_x264",
        rate_control: "CBR",
        keyframe_interval_sec: 2,
        rescale_output_enabled: false,
        rescale_output_width: 720,
        rescale_output_height: 1280,
        rescale_filter: "lanczos",
        dynamic_bitrate_enabled: false,
      },
    };

    setIsResettingQuality(true);
    setQualityMessage(null);
    try {
      const saved = await updateProfile(resetProfile);
      setActiveProfileState(saved);
      setProfiles((current) => current.map((item) => item.id === saved.id ? saved : item));
      setQualityMessage({
        success: true,
        message: `Quality settings for "${saved.name}" were reset to Standard Balanced and saved to this profile. Press Apply Quality Settings to OBS to apply them.`,
      });
    } catch (err) {
      setQualityMessage({ success: false, message: `Could not reset quality settings: ${String(err)}` });
    } finally {
      setIsResettingQuality(false);
    }
  }
  async function handleApplyVideoSettingsToObs() {
    if (!activeProfile) return;
    if (streamStatus?.active) {
      setQualityMessage({
        success: false,
        message: "Stop the active stream before applying video and encoder quality settings.",
      });
      return;
    }
    setIsApplyingQuality(true);
    setQualityMessage(null);
    try {
      const applied = await applyObsQualitySettings(
        obsConfig,
        {
          base_width: activeProfile.composition.canvas_width,
          base_height: activeProfile.composition.canvas_height,
          output_width: activeProfile.quality.output_width,
          output_height: activeProfile.quality.output_height,
          fps_numerator: activeProfile.quality.fps,
          fps_denominator: 1,
        },
        activeProfile.quality
      );
      setObsVideoSettingsState(applied.video_settings);
      setQualityMessage({
        success: true,
        message: `OBS Simple Output settings saved and read back: ${applied.video_settings.output_width}x${applied.video_settings.output_height} @ ${Math.round(applied.video_settings.fps_numerator / (applied.video_settings.fps_denominator || 1))} FPS, video ${applied.video_bitrate_kbps} Kbps, audio ${applied.audio_bitrate_kbps} Kbps, encoder ${applied.encoder}, rate control ${applied.rate_control}, keyframe ${applied.keyframe_interval_sec}s. Encoder settings take effect on the next stream start.`,
      });
    } catch (err) {
      setQualityMessage({
        success: false,
        message: String(err),
      });
    } finally {
      setIsApplyingQuality(false);
    }
  }

  function handleProfileQualityPatch(patch: Partial<ProfileSummaryDto["quality"]>) {
    if (!activeProfile || isStreaming || isApplyingQuality || isResettingQuality || isApplyingOutputOptions) return;
    const updated: ProfileSummaryDto = {
      ...activeProfile,
      quality: { ...activeProfile.quality, ...patch },
    };
    setActiveProfileState(updated);
    setProfiles((current) => current.map((item) => item.id === updated.id ? updated : item));
    setOutputOptionsMessage(null);
    updateProfile(updated).then((saved) => {
      // Avoid allowing an older async save response to overwrite a newer edit.
      setProfiles((current) => current.map((item) =>
        item.id === saved.id && JSON.stringify(item.quality) === JSON.stringify(updated.quality) ? saved : item
      ));
      setActiveProfileState((current) =>
        current?.id === saved.id && JSON.stringify(current.quality) === JSON.stringify(updated.quality) ? saved : current
      );
    }).catch((error) => {
      setOutputOptionsMessage({ success: false, message: `Could not save this profile's output settings: ${String(error)}` });
    });
  }

  async function handleApplyOutputOptionsToObs() {
    if (!activeProfile) return;
    if (isStreaming) {
      setOutputOptionsMessage({ success: false, message: "Stop the live stream before applying these OBS output/network settings." });
      return;
    }

    setIsApplyingOutputOptions(true);
    setOutputOptionsMessage(null);
    try {
      const quality = activeProfile.quality;
      const applied = await applyObsStreamingOutputSettings(obsConfig, {
        rescale_output_enabled: quality.rescale_output_enabled,
        rescale_output_width: quality.rescale_output_width,
        rescale_output_height: quality.rescale_output_height,
        rescale_filter: quality.rescale_filter,
        dynamic_bitrate_enabled: quality.dynamic_bitrate_enabled,
      });
      setObsOutputMode(applied.output_mode);
      if (applied.output_mode === "Advanced") {
        setOutputOptionsMessage({
          success: true,
          message: `OBS settings read back successfully. Output Mode: Advanced. Streaming Rescale: ${applied.rescale_output_enabled ? `${applied.rescale_output_width}×${applied.rescale_output_height}, ${applied.rescale_filter}` : "Disabled"}. Dynamic Bitrate: ${applied.dynamic_bitrate_enabled ? "Enabled" : "Disabled"}. Rescale applies to the next stream start.`,
        });
      } else {
        setOutputOptionsMessage({
          success: true,
          message: `OBS setting verified. Output Mode: ${applied.output_mode}. Dynamic Bitrate: ${applied.dynamic_bitrate_enabled ? "Enabled" : "Disabled"}. Rescale Output is only used in Advanced Output mode and was not changed.`,
        });
      }
    } catch (error) {
      setOutputOptionsMessage({ success: false, message: String(error) });
    } finally {
      setIsApplyingOutputOptions(false);
    }
  }
  // ── Streaming handlers ──────────────────────────────────────────────────
  async function pollStreamStatus() {
    try {
      const status = await getStreamStatus(obsConfig);
      startTransition(() => {
        setStreamStatus(status);
      });
    } catch {
      // ignore
    }
  }

  async function handleStartStream() {
    if (!activeProfile) return;
    if (!activeProfile.server_url.trim()) {
      setStreamError("Server URL is empty. Please enter your ingest URL from Tango Web Desk.");
      return;
    }
    if (!streamKey.trim()) {
      setStreamError("Stream Key is empty. Please enter and save your stream key.");
      return;
    }

    setIsStartingStream(true);
    setStreamError(null);
    try {
      // Persist this profile's composition/connection and keep its secrets in separate vault entries.
      await persistCurrentComposition(activeProfile);
      await setProfileStreamKey(activeProfile.id, streamKey);
      const refreshedProfiles = await listProfiles();
      setProfiles(refreshedProfiles);
      const refreshedActive = refreshedProfiles.find((profile) => profile.id === activeProfile.id);
      if (refreshedActive) setActiveProfileState(refreshedActive);
      await startProfileStream({
        obs_config: obsConfig,
        profile_id: activeProfile.id,
      });
      await pollStreamStatus();
    } catch (err) {
      setStreamError(String(err));
    } finally {
      setIsStartingStream(false);
    }
  }

  async function handleStopStream() {
    setIsStoppingStream(true);
    setStreamError(null);
    try {
      await stopStream(obsConfig);
      await pollStreamStatus();
    } catch (err) {
      setStreamError(String(err));
    } finally {
      setIsStoppingStream(false);
    }
  }

  const isStreaming = streamStatus?.active ?? false;

  // Congestion percentage meter
  const congestionPct = streamStatus?.active ? Math.round(streamStatus.congestion * 100) : 0;
  const congestionColorClass =
    congestionPct < 25 ? "green" : congestionPct < 55 ? "yellow" : "red";

  return (
    <div className="app-layout">
      {/* ── App Header ── */}
      <header className="app-header">
        <div className="header-branding">
          <div className="brand-icon">T</div>
          <div>
            <h1 className="brand-title">Tango Stream Manager</h1>
            <p className="brand-subtitle">
              Professional Tango Streaming Profiles &amp; Video Composition
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          {isStreaming && (
            <div className="status-badge live">
              <span className="pulse-dot" />
              <span>LIVE&nbsp;{streamStatus?.timecode ?? ""}</span>
            </div>
          )}

          {activeProfile && (
            <div className="status-badge profile-badge">
              <span>Profile: <strong>{activeProfile.name}</strong></span>
            </div>
          )}

          {isTesting ? (
            <div className="status-badge testing">
              <span className="pulse-dot" />
              <span>Testing OBS…</span>
            </div>
          ) : connectionStatus.connected ? (
            <div className="status-badge connected">
              <span className="pulse-dot" />
              <span>OBS v{connectionStatus.obs_version}</span>
            </div>
          ) : (
            <div className="status-badge disconnected">
              <span className="pulse-dot" />
              <span>OBS Disconnected</span>
            </div>
          )}
        </div>
      </header>

      {/* ── Profile Toolbar ── */}
      <section className="profiles-panel" aria-label="Streaming profiles">
        <div className="profiles-panel-heading">
          <div>
            <h2 className="profiles-heading">Streaming Profiles</h2>
            <p className="profiles-caption">All profiles stay visible. Select a card to make it active, or rename it in place.</p>
          </div>
          <div className="profile-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowNewProfileModal(true)}
              disabled={isStreaming || editingProfileId !== null}
            >
              + New Profile
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleDuplicateProfile}
              disabled={isStreaming || !activeProfile || editingProfileId !== null}
            >
              Duplicate Active
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isStreaming || profiles.length <= 1 || !activeProfile || editingProfileId !== null}
            >
              Delete Active
            </button>
          </div>
        </div>

        <div className="profile-cards-grid">
          {profiles.map((profile) => {
            const selected = activeProfile?.id === profile.id;
            const editing = editingProfileId === profile.id;
            return (
              <article
                key={profile.id}
                className={`profile-tile ${selected ? "is-active" : ""}`}
              >
                <div className="profile-tile-top">
                  <button
                    type="button"
                    className="profile-tile-select"
                    onClick={() => { void handleSwitchProfile(profile.id); }}
                    disabled={isStreaming || isRenamingProfile || editingProfileId !== null}
                    aria-pressed={selected}
                  >
                    <span className="profile-indicator" aria-hidden="true" />
                    <span className="profile-tile-text">
                      <strong>{profile.name}</strong>
                      <span>{selected ? "ACTIVE PROFILE" : "Select to activate"}</span>
                    </span>
                  </button>
                  <span className={`profile-credential ${profile.has_credential ? "has-key" : "no-key"}`}>
                    {profile.has_credential ? "Key saved" : "No key"}
                  </span>
                </div>

                {editing ? (
                  <form
                    className="profile-rename-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleRenameProfile(profile);
                    }}
                  >
                    <label className="form-label" htmlFor={`profile-name-${profile.id}`}>Profile Name</label>
                    <input
                      id={`profile-name-${profile.id}`}
                      className="form-input"
                      value={profileNameDraft}
                      onChange={(event) => setProfileNameDraft(event.target.value)}
                      maxLength={60}
                      autoFocus
                      required
                    />
                    <div className="profile-rename-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        type="submit"
                        disabled={isRenamingProfile || !profileNameDraft.trim()}
                      >
                        {isRenamingProfile ? "Saving…" : "Save Name"}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        onClick={handleCancelRenameProfile}
                        disabled={isRenamingProfile}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm profile-rename-trigger"
                    onClick={() => handleStartRenameProfile(profile)}
                    disabled={isStreaming || isRenamingProfile || editingProfileId !== null}
                  >
                    Rename Profile
                  </button>
                )}
              </article>
            );
          })}
          {profiles.length === 0 && (
            <div className="profiles-empty">No profiles yet. Create a profile to get started.</div>
          )}
        </div>

        {profileRenameMessage && (
          <div className={`alert-box ${profileRenameMessage.success ? "alert-success" : "alert-error"}`} role="status">
            <span>{profileRenameMessage.message}</span>
          </div>
        )}
      </section>
      {/* ── Main Dashboard Grid ── */}
      <div className="dashboard-grid">

        {/* ── Left Column: OBS Connection & Scene Target ── */}
        <div className="glass-card">
          <div className="card-title">
            <span>OBS Connection &amp; Canvas</span>
            <span className="badge-tag">WebSocket v5</span>
          </div>

          <div className="input-row">
            <div className="form-group">
              <label className="form-label">Host</label>
              <input
                className="form-input font-mono"
                value={obsConfig.host}
                onChange={(e) => setObsConfig({ ...obsConfig, host: e.target.value })}
                placeholder="127.0.0.1"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Port</label>
              <input
                className="form-input font-mono"
                type="number"
                value={obsConfig.port}
                onChange={(e) => setObsConfig({ ...obsConfig, port: Number(e.target.value) })}
                placeholder="4455"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password (Optional) {activeProfile?.has_obs_password ? "· Stored securely for this profile" : "· Not saved"}</label>
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

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              className="btn btn-secondary"
              onClick={() => handleTestConnection()}
              disabled={isTesting}
            >
              {isTesting ? "Testing…" : "Test OBS Connection"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleSaveObsConnection}
              disabled={!activeProfile || isSavingObsConnection || isStreaming}
              title="Save this profile's OBS host, port, and password securely."
            >
              {isSavingObsConnection ? "Saving Connection…" : "Save Connection to Profile"}
            </button>
          </div>
          {obsConnectionMessage && (
            <div className={`alert-box ${obsConnectionMessage.success ? "alert-success" : "alert-error"}`}>
              <span>{obsConnectionMessage.message}</span>
            </div>
          )}

          {!connectionStatus.connected && connectionStatus.error_message && (
            <div className="alert-box alert-error">
              <strong>Connection Failed:</strong>
              <span>{connectionStatus.error_message}</span>
              <p className="alert-tip">
                Ensure OBS Studio is running with WebSocket Server enabled under <em>Tools → WebSocket Server Settings</em>.
              </p>
            </div>
          )}

          {obsVideoSettings && (
            <div className="alert-box alert-info" style={{ marginTop: "0.25rem" }}>
              <strong>OBS Base Canvas:</strong>
              <span>
                {obsVideoSettings.base_width} × {obsVideoSettings.base_height} (Output: {obsVideoSettings.output_width} × {obsVideoSettings.output_height} @ {Math.round(obsVideoSettings.fps_numerator / (obsVideoSettings.fps_denominator || 1))}fps)
              </span>
            </div>
          )}

          {/* Scene & Source */}
          <div className="card-title" style={{ marginTop: "0.5rem" }}>
            <span>Target Scene &amp; Media Source</span>
            <span className="badge-tag">Self-Healing</span>
          </div>

          <div className="input-row">
            <div className="form-group">
              <label className="form-label">Scene Name</label>
              <input
                className="form-input"
                list="obs-scenes-list"
                value={sceneName}
                onChange={(e) => setSceneName(e.target.value)}
                placeholder="Tango Scene"
              />
              <datalist id="obs-scenes-list">
                {availableScenes.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
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
              onChange={(e) => {
                setSourcePath(e.target.value);
                setPanX(0);
                setPanY(0);
                setSourceDimensionsMessage(null);
              }}
              placeholder="Full path, e.g. C:/Videos/stream.mp4"
            />
            <div className="input-row" style={{ alignItems: "center" }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleDetectSourceDimensions}
                disabled={isDetectingSourceDimensions || !sourcePath.trim()}
              >
                {isDetectingSourceDimensions ? "Detecting dimensions…" : "Detect Actual Dimensions (ffprobe)"}
              </button>
              <span className="form-label">Detection is optional. Verify/edit Source Size for this file; Zoom 1.0x remains centered Fill/Cover.</span>
            </div>
            {sourceDimensionsMessage && (
              <div className={`alert-box ${sourceDimensionsMessage.success ? "alert-success" : "alert-error"}`}>
                <span>{sourceDimensionsMessage.message}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Right Column: Video Composition & Safe Pan Geometry ── */}
        <div className="glass-card">
          <div className="card-title">
            <span>Video Composition &amp; Geometry</span>
            <button className="btn btn-secondary btn-sm" onClick={handleResetComposition}>
              Reset Composition Settings
            </button>
          </div>

          <div className="input-row">
            <div className="form-group">
              <label className="form-label">Source Size (WxH)</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  className="form-input font-mono"
                  type="number"
                  min="1"
                  aria-label="Source video width in pixels"
                  value={sourceWidth || ""}
                  placeholder="Width"
                  onChange={(e) => setSourceWidth(e.target.value === "" ? 0 : Math.max(1, Number(e.target.value)))}
                />
                <input
                  className="form-input font-mono"
                  type="number"
                  min="1"
                  aria-label="Source video height in pixels"
                  value={sourceHeight || ""}
                  placeholder="Height"
                  onChange={(e) => setSourceHeight(e.target.value === "" ? 0 : Math.max(1, Number(e.target.value)))}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Canvas Frame (9:16)</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  className="form-input font-mono"
                  type="number"
                  value={canvasWidth}
                  onChange={(e) => setCanvasWidth(Math.max(1, Number(e.target.value)))}
                />
                <input
                  className="form-input font-mono"
                  type="number"
                  value={canvasHeight}
                  onChange={(e) => setCanvasHeight(Math.max(1, Number(e.target.value)))}
                />
              </div>
            </div>
          </div>

          {/* Zoom Slider */}
          <div className="slider-group">
            <div className="slider-header">
              <span>Zoom Multiplier (1.0x = Baseline Fill/Cover)</span>
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
            <span style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
              Cover mode fills the entire frame preserving aspect ratio. Overflow beyond canvas is normal.
            </span>
          </div>

          {/* Dynamic Safe Pan Sliders */}
          <div className="input-row">
            <div className="slider-group">
              <div className="slider-header">
                <span>
                  Pan X {panLimits.x_locked && <span className="badge-tag badge-locked">Locked (0px)</span>}
                </span>
                <span className="slider-val">{panX.toFixed(0)}px</span>
              </div>
              <input
                type="range"
                min={panLimits.min_x}
                max={panLimits.max_x}
                step="1"
                value={panX}
                disabled={panLimits.x_locked}
                onChange={(e) => setPanX(Number(e.target.value))}
              />
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                Safe range: [{panLimits.min_x.toFixed(0)} .. {panLimits.max_x.toFixed(0)}] px
              </span>
            </div>

            <div className="slider-group">
              <div className="slider-header">
                <span>
                  Pan Y {panLimits.y_locked && <span className="badge-tag badge-locked">Locked (0px)</span>}
                </span>
                <span className="slider-val">{panY.toFixed(0)}px</span>
              </div>
              <input
                type="range"
                min={panLimits.min_y}
                max={panLimits.max_y}
                step="1"
                value={panY}
                disabled={panLimits.y_locked}
                onChange={(e) => setPanY(Number(e.target.value))}
              />
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                Safe range: [{panLimits.min_y.toFixed(0)} .. {panLimits.max_y.toFixed(0)}] px
              </span>
            </div>
          </div>

          {/* Normalized Crop */}
          <div className="form-group" style={{ marginTop: "0.25rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasCrop}
                onChange={(e) => setHasCrop(e.target.checked)}
                style={{ width: "16px", height: "16px" }}
              />
              <span className="form-label" style={{ color: "var(--text-primary)" }}>
                Enable Source Crop Region (OBS integer pixel rounding)
              </span>
            </label>
          </div>

          {hasCrop && (
            <div className="input-row">
              <div className="slider-group">
                <div className="slider-header">
                  <span>Horizontal Crop (L/R)</span>
                  <span className="slider-val">{(cropLeft * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="0.45"
                  step="0.02"
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
                  <span>Vertical Crop (T/B)</span>
                  <span className="slider-val">{(cropTop * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="0.45"
                  step="0.02"
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

          <button
            className="btn btn-primary"
            onClick={handleApplyComposition}
            disabled={isApplyingComposition || !connectionStatus.connected}
            style={{ marginTop: "auto" }}
          >
            {isApplyingComposition ? "Applying to OBS…" : "Apply Video Composition to OBS"}
          </button>

          {applyResult && (
            <div className={`alert-box ${applyResult.success ? "alert-success" : "alert-error"}`}>
              <strong>{applyResult.success ? "Success" : "Error"}:</strong>
              <span>{applyResult.message}</span>
            </div>
          )}
        </div>

        {/* ── Full-Width: Streaming Quality (Profile-Bound) ── */}
        <div className="glass-card full-width-card">
          <div className="card-title">
            <span>Streaming Quality &amp; Presets (Profile: {activeProfile?.name ?? "Default"})</span>
            <span className="badge-tag">Encoding</span>
          </div>

          {/* Presets Bar */}
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <span className="form-label" style={{ fontWeight: 600 }}>Quick Preset:</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handlePresetChange("balanced")}
            >
              Standard Balanced (720p @ 2500 Kbps)
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handlePresetChange("low_bandwidth")}
            >
              Low Bandwidth (720p @ 1500 Kbps)
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handlePresetChange("very_low_bandwidth")}
            >
              Very Low Bandwidth (540p @ 800 Kbps)
            </button>
          </div>

          <div className="input-row-3">
            <div className="form-group">
              <label className="form-label">Output Resolution (9:16 Portrait)</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  className="form-input font-mono"
                  type="number"
                  value={activeProfile?.quality.output_width ?? 720}
                  onChange={(e) => {
                    if (!activeProfile) return;
                    const w = Math.max(1, Number(e.target.value));
                    const updated = {
                      ...activeProfile,
                      quality: { ...activeProfile.quality, output_width: w },
                    };
                    setActiveProfileState(updated);
                    updateProfile(updated).catch(console.error);
                  }}
                  disabled={isStreaming}
                />
                <input
                  className="form-input font-mono"
                  type="number"
                  value={activeProfile?.quality.output_height ?? 1280}
                  onChange={(e) => {
                    if (!activeProfile) return;
                    const h = Math.max(1, Number(e.target.value));
                    const updated = {
                      ...activeProfile,
                      quality: { ...activeProfile.quality, output_height: h },
                    };
                    setActiveProfileState(updated);
                    updateProfile(updated).catch(console.error);
                  }}
                  disabled={isStreaming}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Target Framerate (FPS)</label>
              <select
                className="form-input font-mono"
                value={activeProfile?.quality.fps ?? 30}
                onChange={(e) => {
                  if (!activeProfile) return;
                  const fps = Number(e.target.value);
                  const updated = {
                    ...activeProfile,
                    quality: { ...activeProfile.quality, fps },
                  };
                  setActiveProfileState(updated);
                  updateProfile(updated).catch(console.error);
                }}
                disabled={isStreaming}
              >
                <option value={60}>60 FPS</option>
                <option value={30}>30 FPS (Standard)</option>
                <option value={25}>25 FPS (Low Bandwidth)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Video Bitrate (Kbps)</label>
              <input
                className="form-input font-mono"
                type="number"
                step="100"
                value={activeProfile?.quality.video_bitrate_kbps ?? 2500}
                onChange={(e) => {
                  if (!activeProfile) return;
                  const v = Number(e.target.value);
                  const updated = {
                    ...activeProfile,
                    quality: { ...activeProfile.quality, video_bitrate_kbps: v },
                  };
                  setActiveProfileState(updated);
                  updateProfile(updated).catch(console.error);
                }}
                disabled={isStreaming || isResettingQuality || isApplyingQuality}
              />
            </div>
          </div>

          <div className="input-row-3">
            <div className="form-group">
              <label className="form-label">Audio Bitrate (Kbps)</label>
              <select
                className="form-input font-mono"
                value={activeProfile?.quality.audio_bitrate_kbps ?? 128}
                onChange={(e) => {
                  if (!activeProfile) return;
                  const v = Number(e.target.value);
                  const updated = {
                    ...activeProfile,
                    quality: { ...activeProfile.quality, audio_bitrate_kbps: v },
                  };
                  setActiveProfileState(updated);
                  setProfiles((current) => current.map((item) => item.id === updated.id ? updated : item));
                  updateProfile(updated).catch(console.error);
                }}
                disabled={isStreaming || !activeProfile}
              >
                <option value={160}>160 Kbps (High)</option>
                <option value={128}>128 Kbps (Balanced)</option>
                <option value={96}>96 Kbps (Low)</option>
                <option value={64}>64 Kbps (Voice only)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Video Encoder</label>
              <select
                className="form-input font-mono"
                value={activeProfile?.quality.encoder ?? "obs_x264"}
                onChange={(e) => {
                  if (!activeProfile) return;
                  const updated = {
                    ...activeProfile,
                    quality: { ...activeProfile.quality, encoder: e.target.value },
                  };
                  setActiveProfileState(updated);
                  setProfiles((current) => current.map((item) => item.id === updated.id ? updated : item));
                  updateProfile(updated).catch(console.error);
                }}
                disabled={isStreaming || !activeProfile}
              >
                <option value="auto">Auto — keep current OBS encoder</option>
                <option value="obs_x264">Software x264</option>
                <option value="jim_nvenc">NVIDIA NVENC H.264</option>
                <option value="jim_qsv">Intel Quick Sync H.264</option>
                <option value="amd_h264">AMD H.264</option>
                <option value="apple_h264">Apple VideoToolbox H.264</option>
              </select>
              <span className="form-label">Availability depends on the OBS build and installed hardware encoders.</span>
            </div>

            <div className="form-group">
              <label className="form-label">Rate Control</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <select
                  className="form-input font-mono"
                  value={activeProfile?.quality.rate_control ?? "CBR"}
                  onChange={(e) => {
                    if (!activeProfile) return;
                    const updated = {
                      ...activeProfile,
                      quality: { ...activeProfile.quality, rate_control: e.target.value },
                    };
                    setActiveProfileState(updated);
                    setProfiles((current) => current.map((item) => item.id === updated.id ? updated : item));
                    updateProfile(updated).catch(console.error);
                  }}
                  disabled={isStreaming || !activeProfile}
                  style={{ flex: 1, minWidth: 0 }}
                  title="The current verified integration applies CBR only in OBS Simple Output mode. Other choices are profile preferences and will be rejected during apply until Advanced Output support is implemented."
                >
                  <option value="CBR">CBR — supported in Simple Output</option>
                  <option value="VBR">VBR — Advanced Output required</option>
                  <option value="CRF">CRF — Advanced Output required</option>
                  <option value="CQP">CQP — Advanced Output required</option>
                </select>
                <input
                  className="form-input font-mono"
                  value={`${activeProfile?.quality.keyframe_interval_sec ?? 2}s Keyframe`}
                  readOnly
                  aria-label="Keyframe interval"
                  title="The current Simple Output workflow enforces a 2-second keyframe interval."
                  style={{ width: "118px" }}
                />
              </div>
              <span className="form-label">Only CBR is applied by the current Simple Output integration; alternative modes are saved per profile but not yet applied.</span>
            </div>
          </div>

          <div className="quality-action-row" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "flex-end", alignItems: "center" }}>
            <button
              className="btn btn-secondary"
              onClick={handleResetQualitySettings}
              disabled={!activeProfile || isStreaming || isResettingQuality || isApplyingQuality}
              title="Reset this profile's quality preferences to Standard Balanced defaults. This does not apply them to OBS."
            >
              {isResettingQuality ? "Resetting…" : "Reset Quality Settings"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleApplyVideoSettingsToObs}
              disabled={!connectionStatus.connected || isStreaming || isApplyingQuality || isResettingQuality}
              title={
                isStreaming
                  ? "Stop the live stream before applying video and encoder quality settings."
                  : "Apply video and encoder quality settings in OBS Simple Output mode"
              }
            >
              {isApplyingQuality ? "Applying…" : "Apply Quality Settings to OBS"}
            </button>
          </div>

          {activeProfile && activeProfile.quality.rate_control !== "CBR" && (
            <div className="alert-box alert-warning">
              <strong>Rate Control not yet applicable:</strong>
              <span>
                {activeProfile.quality.rate_control} is saved with this profile, but the verified OBS integration currently applies CBR only in Simple Output mode. Applying this profile will be rejected until proper Advanced Output encoder support is implemented. Choose CBR to apply the current workflow.
              </span>
            </div>
          )}


          {isStreaming && (
            <div className="alert-box alert-warning">
              <strong>Live Stream Active:</strong>
              <span>
                Stop the active stream before applying resolution, FPS, bitrate, or encoder settings. This workflow currently supports OBS Simple Output mode; Advanced Output is rejected safely.
              </span>
            </div>
          )}

          {qualityMessage && (
            <div className={`alert-box ${qualityMessage.success ? "alert-success" : "alert-error"}`}>
              <span>{qualityMessage.message}</span>
            </div>
          )}
          {/* Profile-local OBS streaming rescale and network options */}
          <div className="quality-output-options" style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
            <div className="card-title">
              <span>OBS Streaming Output &amp; Network</span>
              <span className="badge-tag">{obsOutputMode ? `Output: ${obsOutputMode}` : "Output mode unknown"}</span>
            </div>
            <p className="form-label">
              These preferences are saved with the selected Tango profile. Apply them explicitly to write and verify the values in the active OBS profile.
            </p>

            <label style={{ display: "flex", alignItems: "center", gap: "0.55rem", cursor: obsOutputMode === "Advanced" ? "pointer" : "not-allowed" }}>
              <input
                type="checkbox"
                checked={activeProfile?.quality.rescale_output_enabled ?? false}
                onChange={(e) => handleProfileQualityPatch({ rescale_output_enabled: e.target.checked })}
                disabled={!activeProfile || isStreaming || isApplyingOutputOptions || obsOutputMode !== "Advanced"}
                style={{ width: "16px", height: "16px" }}
              />
              <span className="form-label" style={{ color: "var(--text-primary)" }}>
                Rescale Output (Streaming)
              </span>
            </label>
            {obsOutputMode !== "Advanced" && (
              <div className="alert-box alert-info">
                <span>OBS Settings → Output → Output Mode must be set to Advanced before Streaming → Rescale Output can be enabled. Dynamic Bitrate is available independently.</span>
              </div>
            )}

            <div className="input-row">
              <div className="form-group">
                <label className="form-label">Rescale Width</label>
                <input
                  className="form-input font-mono"
                  type="number"
                  min="2"
                  max="8192"
                  value={activeProfile?.quality.rescale_output_width ?? 720}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isInteger(value) && value >= 2 && value <= 8192) handleProfileQualityPatch({ rescale_output_width: value });
                  }}
                  disabled={!activeProfile || isStreaming || isApplyingOutputOptions}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Rescale Height</label>
                <input
                  className="form-input font-mono"
                  type="number"
                  min="2"
                  max="8192"
                  value={activeProfile?.quality.rescale_output_height ?? 1280}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isInteger(value) && value >= 2 && value <= 8192) handleProfileQualityPatch({ rescale_output_height: value });
                  }}
                  disabled={!activeProfile || isStreaming || isApplyingOutputOptions}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Rescale Filter</label>
                <select
                  className="form-input font-mono"
                  value={activeProfile?.quality.rescale_filter ?? "lanczos"}
                  onChange={(e) => handleProfileQualityPatch({ rescale_filter: e.target.value })}
                  disabled={!activeProfile || isStreaming || isApplyingOutputOptions}
                >
                  <option value="point">Point (fastest)</option>
                  <option value="bilinear">Bilinear</option>
                  <option value="bicubic">Bicubic</option>
                  <option value="lanczos">Lanczos (sharp)</option>
                  <option value="area">Area</option>
                </select>
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.55rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={activeProfile?.quality.dynamic_bitrate_enabled ?? false}
                onChange={(e) => handleProfileQualityPatch({ dynamic_bitrate_enabled: e.target.checked })}
                disabled={!activeProfile || isStreaming || isApplyingOutputOptions}
                style={{ width: "16px", height: "16px", marginTop: "0.2rem" }}
              />
              <span>
                <span className="form-label" style={{ color: "var(--text-primary)" }}>Enable OBS Dynamic Bitrate</span>
                <span className="form-label" style={{ display: "block" }}>Allow OBS to dynamically change bitrate to manage network congestion (OBS Settings → Advanced → Network).</span>
              </span>
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn btn-secondary"
                onClick={handleApplyOutputOptionsToObs}
                disabled={!activeProfile || !connectionStatus.connected || isStreaming || isApplyingOutputOptions}
              >
                {isApplyingOutputOptions ? "Applying & Verifying…" : "Apply Rescale & Dynamic Bitrate to OBS"}
              </button>
            </div>

            {outputOptionsMessage && (
              <div className={`alert-box ${outputOptionsMessage.success ? "alert-success" : "alert-error"}`}>
                <span>{outputOptionsMessage.message}</span>
              </div>
            )}
          </div>        </div>

        {/* ── Full-Width: Tango Live Stream Control & Health Metrics ── */}
        <div className="glass-card full-width-card">
          <div className="card-title">
            <span>Tango Broadcast Control &amp; Live Stream Health</span>
            <span className="badge-tag">{activeProfile?.service_type === "tango" ? "Tango RTMP" : "Custom RTMP"}</span>
          </div>

          {/* Official Tango Guidance Banner */}
          <div className="alert-box alert-info">
            <strong>Tango Web Desk Connection Instructions:</strong>
            <span>
              1. Open Tango Web Desk on your browser (<code className="font-mono">tango.me</code>) &rarr; click <strong>Start Stream</strong> &rarr; choose <strong>OBS Stream</strong>.<br />
              2. Copy the official <strong>RTMP Server URL</strong> and <strong>Stream Key</strong> provided and save them below. Stream keys are stored encrypted in your operating system&apos;s credential vault.
            </span>
          </div>

          {/* RTMP Destination & Secret Key */}
          <div className="input-row">
            <div className="form-group">
              <label className="form-label">RTMP Ingest Server URL</label>
              <input
                className="form-input font-mono"
                value={activeProfile?.server_url ?? ""}
                onChange={(e) => {
                  if (!activeProfile) return;
                  const updated = { ...activeProfile, server_url: e.target.value };
                  setActiveProfileState(updated);
                  updateProfile(updated).catch(console.error);
                }}
                placeholder="e.g. rtmp://live.tango.me/stream"
                disabled={isStreaming}
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Profile Stream Key {activeProfile?.has_credential && <span style={{ color: "#34d399" }}>● (Stored Securely)</span>}
              </label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  className="form-input font-mono"
                  type={showStreamKey ? "text" : "password"}
                  value={streamKey}
                  onChange={(e) => setStreamKey(e.target.value)}
                  placeholder="Paste your Tango stream key"
                  disabled={isStreaming}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-icon"
                  onClick={() => setShowStreamKey((v) => !v)}
                  title={showStreamKey ? "Hide key" : "Reveal key"}
                >
                  {showStreamKey ? "🙈" : "👁"}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleSaveStreamKey}
                  disabled={isStreaming || isSavingKey || (!streamKey.trim() && !activeProfile?.has_credential)}
                >
                  {isSavingKey ? "Saving…" : "Save Key"}
                </button>
              </div>
            </div>
          </div>

          {keySavedMessage && (
            <div className="alert-box alert-success">
              <span>{keySavedMessage}</span>
            </div>
          )}

          {/* Stream Action Buttons */}
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginTop: "0.5rem" }}>
            {!isStreaming ? (
              <button
                className="btn btn-live"
                onClick={handleStartStream}
                disabled={isStartingStream || !connectionStatus.connected || !streamKey.trim()}
              >
                {isStartingStream ? "Starting Stream…" : "▶ Go Live on Tango"}
              </button>
            ) : (
              <button
                className="btn btn-stop"
                onClick={handleStopStream}
                disabled={isStoppingStream}
              >
                {isStoppingStream ? "Stopping…" : "⏹ End Broadcast"}
              </button>
            )}

            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              {isStreaming
                ? "Broadcast is live. Resolution is locked."
                : "Ensure video composition and destination settings are ready before broadcasting."}
            </div>
          </div>

          {streamError && (
            <div className="alert-box alert-error">
              <strong>Stream Error:</strong>
              <span>{streamError}</span>
            </div>
          )}

          {/* Real-Time Stream Health Dashboard */}
          {streamStatus && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.75rem" }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                Live Stream Metrics &amp; Diagnostic Counters
              </div>

              <div className="health-grid">
                <div className="health-stat">
                  <span className="health-stat-label">Status</span>
                  <span className="health-stat-value" style={{ color: streamStatus.active ? "#f87171" : "#6e7681" }}>
                    {streamStatus.active ? (streamStatus.reconnecting ? "🟡 Reconnecting" : "🔴 LIVE") : "⚫ Offline"}
                  </span>
                </div>

                <div className="health-stat">
                  <span className="health-stat-label">Uptime</span>
                  <span className="health-stat-value font-mono">
                    {streamStatus.timecode ?? "—"}
                  </span>
                </div>

                <div className="health-stat">
                  <span className="health-stat-label">Output Bitrate</span>
                  <span className="health-stat-value font-mono">
                    {streamStatus.kbits_per_sec != null ? `${streamStatus.kbits_per_sec} Kbps` : "—"}
                  </span>
                </div>

                <div className="health-stat">
                  <span className="health-stat-label">Network Congestion</span>
                  <span className="health-stat-value font-mono">
                    {congestionPct}%
                  </span>
                  <div className="meter-bar-container">
                    <div
                      className={`meter-fill ${congestionColorClass}`}
                      style={{ width: `${Math.min(100, Math.max(5, congestionPct))}%` }}
                    />
                  </div>
                </div>

                <div className="health-stat">
                  <span className="health-stat-label">Network Dropped</span>
                  <span className="health-stat-value font-mono">
                    {streamStatus.dropped_frames} frames
                  </span>
                  <span className="health-stat-sub">Output buffer</span>
                </div>

                <div className="health-stat">
                  <span className="health-stat-label">Render Skipped</span>
                  <span className="health-stat-value font-mono">
                    {streamStatus.render_skipped_frames} frames
                  </span>
                  <span className="health-stat-sub">GPU/CPU lag</span>
                </div>

                <div className="health-stat">
                  <span className="health-stat-label">OBS CPU / FPS</span>
                  <span className="health-stat-value font-mono">
                    {streamStatus.cpu_usage.toFixed(1)}% / {Math.round(streamStatus.active_fps)} fps
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: Create New Profile ── */}
      {showNewProfileModal && (
        <div className="modal-overlay" onClick={() => setShowNewProfileModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create New Streaming Profile</h3>
              <button className="btn btn-icon" onClick={() => setShowNewProfileModal(false)}>✕</button>
            </div>

            <div className="form-group">
              <label className="form-label">Profile Name</label>
              <input
                className="form-input"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="e.g. Tango Portrait High-Q"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Starting Quality Preset</label>
              <select
                className="form-input"
                value={newProfilePreset}
                onChange={(e) => setNewProfilePreset(e.target.value)}
              >
                <option value="balanced">Standard Balanced (720x1280 @ 30fps, 2500 Kbps)</option>
                <option value="low_bandwidth">Low Bandwidth (720x1280 @ 30fps, 1500 Kbps)</option>
                <option value="very_low_bandwidth">Very Low Bandwidth (540x960 @ 25fps, 800 Kbps)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Tango RTMP Ingest URL (Optional)</label>
              <input
                className="form-input font-mono"
                value={newProfileServer}
                onChange={(e) => setNewProfileServer(e.target.value)}
                placeholder="e.g. rtmp://live.tango.me/stream"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Stream Key (Saved to OS Keyring)</label>
              <input
                className="form-input font-mono"
                type="password"
                value={newProfileKey}
                onChange={(e) => setNewProfileKey(e.target.value)}
                placeholder="Paste Tango stream key"
              />
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNewProfileModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateProfile}
                disabled={!newProfileName.trim()}
              >
                Create Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Delete Profile Confirmation ── */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Delete Profile</h3>
              <button className="btn btn-icon" onClick={() => setShowDeleteConfirm(false)}>✕</button>
            </div>

            <p style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Are you sure you want to delete profile <strong>&quot;{activeProfile?.name}&quot;</strong>?
              Its stored stream credentials in the OS Keyring will also be permanently removed.
            </p>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDeleteProfile}>
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
