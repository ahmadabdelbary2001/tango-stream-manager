import type {
  AdaptationConfig,
  CropPayload,
  ObsConnectionConfig,
  ObsStreamingOutputOptionsPayload,
  PanLimitsResponsePayload,
  ProfileCompositionConfig,
  ProfileSummaryDto,
  QualitySettings,
} from "@/api/obs";
import { QUALITY_PRESETS } from "@/api/obs";

// ===========================================================================
// Workspace model
//
// The editable state of a profile is held as a single `WorkspaceDraft`. It is
// derived from a `ProfileSummaryDto` and saved through `updateProfile`, so the
// DTO shape stays the contract. Everything here is presentation logic or input
// validation — never authoritative geometry.
// ===========================================================================

export interface WorkspaceDraft {
  name: string;
  serviceType: string;
  serverUrl: string;
  obsHost: string;
  obsPort: number;
  quality: QualitySettings;
  composition: ProfileCompositionConfig;
  adaptation: AdaptationConfig;
}

export function draftFromProfile(
  profile: ProfileSummaryDto,
): WorkspaceDraft {
  return {
    name: profile.name,
    serviceType: profile.service_type,
    serverUrl: profile.server_url,
    obsHost: profile.obs_connection.host,
    obsPort: profile.obs_connection.port,
    quality: { ...profile.quality },
    composition: {
      ...profile.composition,
      crop: profile.composition.crop ? { ...profile.composition.crop } : null,
    },
    adaptation: { ...profile.adaptation },
  };
}

export function obsConfigFromDraft(
  draft: WorkspaceDraft,
  password?: string | null,
): ObsConnectionConfig {
  return {
    host: draft.obsHost.trim(),
    port: draft.obsPort,
    password: password ?? null,
  };
}

/** Stable comparison string for "is this staged value applied to OBS?" */
export function draftSignature(draft: WorkspaceDraft): string {
  return JSON.stringify({
    quality: draft.quality,
    composition: draft.composition,
    adaptation: draft.adaptation,
  });
}

export function qualitySignature(quality: QualitySettings): string {
  return JSON.stringify(quality);
}

export function outputSignature(
  settings: ObsStreamingOutputOptionsPayload,
): string {
  return JSON.stringify(settings);
}

// ------------------------------------------------------------- Validation ---

export type FieldErrors = Record<string, string>;

const INT = (value: number) => Number.isFinite(value) && Number.isInteger(value);

export function validateConnection(
  host: string,
  port: number,
): FieldErrors {
  const errors: FieldErrors = {};
  if (!host.trim()) {
    errors.host = "Enter the OBS hostname or IP address.";
  } else if (/\s/.test(host.trim())) {
    errors.host = "Host must not contain spaces.";
  } else if (host.trim().length > 253) {
    errors.host = "Host is longer than a valid hostname allows.";
  }
  if (!INT(port) || port < 1 || port > 65535) {
    errors.port = "Port must be a whole number between 1 and 65535.";
  }
  return errors;
}

export function validateQuality(quality: QualitySettings): FieldErrors {
  const errors: FieldErrors = {};
  const dims: Array<[keyof QualitySettings, number, number, string]> = [
    ["output_width", 160, 7680, "Output width"],
    ["output_height", 160, 7680, "Output height"],
    ["rescale_output_width", 160, 7680, "Rescale width"],
    ["rescale_output_height", 160, 7680, "Rescale height"],
  ];
  dims.forEach(([key, min, max, label]) => {
    const value = quality[key] as number;
    if (!INT(value) || value < min || value > max) {
      errors[key as string] = `${label} must be a whole number from ${min} to ${max}.`;
    }
  });
  if (!Number.isFinite(quality.fps) || quality.fps < 1 || quality.fps > 120) {
    errors.fps = "FPS must be between 1 and 120.";
  } else if (!Number.isInteger(quality.fps)) {
    errors.fps = "FPS must be a whole number.";
  }
  if (
    !INT(quality.video_bitrate_kbps) ||
    quality.video_bitrate_kbps < 200 ||
    quality.video_bitrate_kbps > 50000
  ) {
    errors.video_bitrate_kbps = "Video bitrate must be 200–50000 kbps.";
  }
  if (
    !INT(quality.audio_bitrate_kbps) ||
    quality.audio_bitrate_kbps < 32 ||
    quality.audio_bitrate_kbps > 512
  ) {
    errors.audio_bitrate_kbps = "Audio bitrate must be 32–512 kbps.";
  }
  if (
    !Number.isFinite(quality.keyframe_interval_sec) ||
    quality.keyframe_interval_sec < 0 ||
    quality.keyframe_interval_sec > 20
  ) {
    errors.keyframe_interval_sec = "Keyframe interval must be 0–20 seconds.";
  }
  if (
    quality.rescale_output_enabled &&
    !errors.output_width &&
    !errors.output_height
  ) {
    const baseAspect = quality.output_width / quality.output_height;
    const rescaleAspect =
      quality.rescale_output_width / quality.rescale_output_height;
    if (Math.abs(baseAspect - rescaleAspect) / baseAspect > 0.02) {
      errors.rescale_output_width =
        "Rescale aspect differs from the output canvas; OBS will stretch the image.";
    }
  }
  return errors;
}

export function validateComposition(
  composition: ProfileCompositionConfig,
): FieldErrors {
  const errors: FieldErrors = {};
  const finitePositive = (value: number) =>
    Number.isFinite(value) && value >= 1 && value <= 16384;

  if (!finitePositive(composition.source_width)) {
    errors.source_width = "Source width must be 1–16384 px.";
  }
  if (!finitePositive(composition.source_height)) {
    errors.source_height = "Source height must be 1–16384 px.";
  }
  if (!finitePositive(composition.canvas_width)) {
    errors.canvas_width = "Canvas width must be 1–16384 px.";
  }
  if (!finitePositive(composition.canvas_height)) {
    errors.canvas_height = "Canvas height must be 1–16384 px.";
  }
  if (!Number.isFinite(composition.zoom) || composition.zoom < 0.1 || composition.zoom > 4) {
    errors.zoom = "Zoom must be between 0.10× and 4.00×.";
  }
  if (!Number.isFinite(composition.pan_x) || Math.abs(composition.pan_x) > 20000) {
    errors.pan_x = "Pan X is out of range.";
  }
  if (!Number.isFinite(composition.pan_y) || Math.abs(composition.pan_y) > 20000) {
    errors.pan_y = "Pan Y is out of range.";
  }
  if (composition.has_crop && composition.crop) {
    const { left, top, right, bottom } = composition.crop;
    const sides: Array<[number, string]> = [
      [left, "left"],
      [top, "top"],
      [right, "right"],
      [bottom, "bottom"],
    ];
    sides.forEach(([value, name]) => {
      if (!Number.isFinite(value) || value < 0 || value > 0.9) {
        errors[`crop_${name}`] = `Crop ${name} must be between 0% and 90%.`;
      }
    });
    if (!errors.crop_left && !errors.crop_right && left + right >= 0.98) {
      errors.crop_left = "Left and right crop leave no visible width.";
    }
    if (!errors.crop_top && !errors.crop_bottom && top + bottom >= 0.98) {
      errors.crop_top = "Top and bottom crop leave no visible height.";
    }
  }
  return errors;
}

export function validateProfileName(
  name: string,
  others: ProfileSummaryDto[],
  currentId?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Profile name cannot be empty.";
  if (trimmed.length > 64) return "Keep the profile name under 64 characters.";
  const clash = others.find(
    (item) =>
      item.id !== currentId &&
      item.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) return `A profile named “${clash.name}” already exists.`;
  return null;
}

export function validateDestination(
  serverUrl: string,
  serviceType: string,
): string | null {
  const trimmed = serverUrl.trim();
  if (!trimmed) {
    return serviceType === "custom"
      ? "Enter the custom RTMP server URL."
      : "Destination server is empty.";
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\/|^[^/\s]+\.(?:com|net|org|tv|io|local)(?::\d+)?/i.test(trimmed)) {
    return "Server URL must include a scheme (rtmp:// or rtmps://) and a host.";
  }
  return null;
}

// ------------------------------------------------------------- Formatting ---

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function percent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

/** `568 × 762` — dimension display used across panels. */
export function dims(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return "—";
  return `${width} × ${height}`;
}

export function qualitySummary(quality: QualitySettings): string {
  return `${quality.output_width}×${quality.output_height} · ${quality.fps} fps · ${(
    quality.video_bitrate_kbps / 1000
  ).toFixed(1)} Mbps`;
}

export function matchingPreset(
  quality: QualitySettings,
): keyof typeof QUALITY_PRESETS | null {
  const keys = Object.keys(QUALITY_PRESETS) as Array<keyof typeof QUALITY_PRESETS>;
  for (const key of keys) {
    const preset = QUALITY_PRESETS[key];
    const same = (Object.keys(preset) as Array<keyof typeof preset>).every(
      (field) => preset[field] === quality[field],
    );
    if (same) return key;
  }
  return null;
}

// ------------------------------------------------------- Display geometry ---

export interface StageGeometry {
  /** Source frame size as a percentage of the canvas box. */
  frameWidthPct: number;
  frameHeightPct: number;
  /** Pan offset as a percentage of the canvas box. */
  offsetXPct: number;
  offsetYPct: number;
  /** Crop masks as percentages of the canvas box, or null when disabled. */
  crop: CropPayload | null;
  valid: boolean;
}

/**
 * Presentation-only projection of the camera state onto the stage diagram.
 * Uses the backend `visible_width` / `visible_height` readout, so the drawn
 * scale always matches the values Rust calculated.
 */
export function stageGeometry(
  composition: ProfileCompositionConfig,
  limits: PanLimitsResponsePayload | null,
): StageGeometry {
  const visibleWidth = limits?.visible_width ?? 0;
  const visibleHeight = limits?.visible_height ?? 0;
  if (
    !limits ||
    visibleWidth <= 0 ||
    visibleHeight <= 0 ||
    composition.source_width <= 0 ||
    composition.source_height <= 0
  ) {
    return {
      frameWidthPct: 100,
      frameHeightPct: 100,
      offsetXPct: 0,
      offsetYPct: 0,
      crop: null,
      valid: false,
    };
  }

  const frameWidthPct = (composition.source_width / visibleWidth) * 100;
  const frameHeightPct = (composition.source_height / visibleHeight) * 100;

  return {
    frameWidthPct: Math.min(frameWidthPct, 640),
    frameHeightPct: Math.min(frameHeightPct, 640),
    offsetXPct: (composition.pan_x / visibleWidth) * 100,
    offsetYPct: (composition.pan_y / visibleHeight) * 100,
    crop: composition.has_crop ? composition.crop : null,
    valid: true,
  };
}

export function cropMasks(crop: CropPayload | null): Array<{
  key: string;
  style: Record<string, string>;
}> {
  if (!crop) return [];
  return [
    {
      key: "left",
      style: { left: "0%", top: "0%", width: `${crop.left * 100}%`, height: "100%" },
    },
    {
      key: "right",
      style: {
        right: "0%",
        top: "0%",
        width: `${crop.right * 100}%`,
        height: "100%",
      },
    },
    {
      key: "top",
      style: {
        left: `${crop.left * 100}%`,
        top: "0%",
        width: `${(1 - crop.left - crop.right) * 100}%`,
        height: `${crop.top * 100}%`,
      },
    },
    {
      key: "bottom",
      style: {
        left: `${crop.left * 100}%`,
        bottom: "0%",
        width: `${(1 - crop.left - crop.right) * 100}%`,
        height: `${crop.bottom * 100}%`,
      },
    },
  ];
}

// ------------------------------------------------------------ Error text ---

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "An unknown error occurred.";
  }
}
