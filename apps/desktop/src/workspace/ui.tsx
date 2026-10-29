import { useEffect, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Info as InfoIcon,
  X,
  XCircle,
} from "lucide-react";

export type Tone =
  | "ok"
  | "warn"
  | "danger"
  | "info"
  | "idle"
  | "amber"
  | "live";

// ---------------------------------------------------------------- Spinner ---

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`tsm-spinner ${className}`} aria-hidden="true" />;
}

// ------------------------------------------------------------------ Panel ---

interface PanelProps {
  id?: string;
  title: string;
  icon?: ReactNode;
  sub?: string;
  end?: ReactNode;
  foot?: ReactNode;
  children: ReactNode;
  quiet?: boolean;
  labelledBy?: string;
}

export function Panel({
  id,
  title,
  icon,
  sub,
  end,
  foot,
  children,
  quiet = false,
}: PanelProps) {
  const headingId = `${id ?? title.replace(/\s+/g, "-").toLowerCase()}-title`;
  return (
    <section
      id={id}
      className={`tsm-panel${quiet ? " tsm-panel--quiet" : ""}`}
      aria-labelledby={headingId}
    >
      <header className="tsm-panel__head">
        {icon ? <span className="tsm-panel__icon">{icon}</span> : null}
        <h2 className="tsm-panel__title" id={headingId}>
          {title}
        </h2>
        {sub ? <span className="tsm-panel__sub">{sub}</span> : null}
        {end ? <div className="tsm-panel__head-end">{end}</div> : null}
      </header>
      <div className="tsm-panel__body">{children}</div>
      {foot ? <div className="tsm-panel__foot">{foot}</div> : null}
    </section>
  );
}

// ------------------------------------------------------------------- Chip ---

interface ChipProps {
  tone?: Tone;
  children: ReactNode;
  mono?: boolean;
  pulse?: boolean;
  title?: string;
}

export function Chip({ tone = "idle", children, mono, pulse, title }: ChipProps) {
  return (
    <span
      className={`tsm-chip tsm-chip--${tone}${mono ? " tsm-chip--mono" : ""}${
        pulse ? " tsm-pulse" : ""
      }`}
      title={title}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ Field ---

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, error, children, className }: FieldProps) {
  return (
    <div className={`tsm-field ${className ?? ""}`}>
      <label className="tsm-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="tsm-field__error" role="alert">
          <XCircle size={11} aria-hidden="true" />
          {error}
        </span>
      ) : hint ? (
        <span className="tsm-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------- SliderField ---

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  decimals?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  id: string;
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  decimals = 0,
  disabled,
  onChange,
  id,
}: SliderFieldProps) {
  const display = Number.isFinite(value) ? value.toFixed(decimals) : "—";
  return (
    <div className="tsm-slider">
      <div className="tsm-slider__head">
        <label className="tsm-slider__label" htmlFor={id}>
          {label}
        </label>
        <span className="tsm-slider__value">
          {display}
          {unit ? <span className="tsm-metric__unit">{unit}</span> : null}
        </span>
      </div>
      <div className="tsm-slider__row">
        <input
          id={id}
          className="tsm-slider__range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : min}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          className="tsm-slider__num"
          type="number"
          inputMode="decimal"
          aria-label={`${label} value`}
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isNaN(next)) onChange(next);
          }}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------- ToggleRow ---

interface ToggleRowProps {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  busy,
}: ToggleRowProps) {
  return (
    <div className={`tsm-toggle-row${disabled ? " is-disabled" : ""}`}>
      <span className="tsm-toggle-row__text">
        <span className="tsm-toggle-row__title">{label}</span>
        {hint ? <span className="tsm-toggle-row__hint">{hint}</span> : null}
      </span>
      {busy ? <Spinner /> : null}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="tsm-switch"
        disabled={disabled || busy}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

// ----------------------------------------------------------------- Alert ---

interface AlertProps {
  tone: "ok" | "warn" | "danger" | "info";
  title: string;
  detail?: string | null;
  simulated?: boolean;
}

const ALERT_ICONS = {
  ok: Check,
  warn: AlertTriangle,
  danger: XCircle,
  info: InfoIcon,
} as const;

export function Alert({ tone, title, detail, simulated }: AlertProps) {
  const Icon = ALERT_ICONS[tone];
  return (
    <div className={`tsm-alert tsm-alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon size={14} className="tsm-alert__icon" aria-hidden="true" />
      <div className="tsm-alert__body">
        <span className="tsm-alert__title">
          {title}
          {simulated ? " · simulated" : ""}
        </span>
        {detail ? (
          <div className="tsm-alert__detail" role="note">
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ MetricTile ---

interface MetricTileProps {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  decimals?: number;
  accent?: boolean;
  live?: boolean;
  simulated?: boolean;
}

export function MetricTile({
  label,
  value,
  unit,
  decimals = 0,
  accent,
  live,
  simulated,
}: MetricTileProps) {
  const numeric = typeof value === "number" ? value : null;
  const missing =
    value === null ||
    value === undefined ||
    (numeric !== null && !Number.isFinite(numeric)) ||
    (typeof value === "string" && value.trim() === "");

  const text =
    numeric !== null
      ? numeric.toFixed(decimals)
      : typeof value === "string"
        ? value
        : "Unavailable";

  return (
    <div
      className={`tsm-metric${accent ? " tsm-metric--accent" : ""}${
        live ? " tsm-metric--live" : ""
      }`}
    >
      <span className="tsm-metric__label">{label}</span>
      <span className={`tsm-metric__value${missing ? " is-missing" : ""}`}>
        {missing ? "Unavailable" : text}
        {!missing && unit ? <span className="tsm-metric__unit">{unit}</span> : null}
      </span>
      {simulated && !missing ? (
        <span className="tsm-metric__sim" aria-hidden="true">
          sim
        </span>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ Modal ---

interface ModalProps {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}

export function Modal({ title, sub, onClose, children, footer }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="tsm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="tsm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="tsm-modal__head">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 className="tsm-modal__title">{title}</h2>
              {sub ? <p className="tsm-modal__sub">{sub}</p> : null}
            </div>
            <button
              type="button"
              className="tsm-btn tsm-btn--ghost tsm-btn--icon"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="tsm-modal__body">{children}</div>
        <div className="tsm-modal__foot">{footer}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- KeyValue ---

export function KV({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  const missing = v === null || v === undefined || v === "";
  return (
    <div className="tsm-kv">
      <span className="tsm-kv__k">{k}</span>
      <span
        className={`tsm-kv__v${missing ? " is-missing" : ""}`}
        style={!mono ? { fontFamily: "var(--font-body)" } : undefined}
      >
        {missing ? "Unavailable" : v}
      </span>
    </div>
  );
}
