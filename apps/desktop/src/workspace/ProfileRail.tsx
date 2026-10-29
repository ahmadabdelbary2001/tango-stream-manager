import { useMemo, useState } from "react";
import {
  Copy,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { ProfileSummaryDto } from "@/api/obs";
import { Chip } from "@/workspace/ui";
import { qualitySummary } from "@/workspace/model";
import type { WorkspaceApi } from "@/workspace/useWorkspace";

interface RailProps {
  api: WorkspaceApi;
  collapsed: boolean;
  onCreate: () => void;
  onRename: (profile: ProfileSummaryDto) => void;
  onDelete: (profile: ProfileSummaryDto) => void;
}

export function ProfileRail({ api, collapsed, onCreate, onRename, onDelete }: RailProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return api.profiles;
    return api.profiles.filter(
      (profile) =>
        profile.name.toLowerCase().includes(needle) ||
        profile.service_type.toLowerCase().includes(needle) ||
        profile.server_url.toLowerCase().includes(needle),
    );
  }, [api.profiles, query]);

  return (
    <aside className={`tsm-rail${collapsed ? " is-collapsed" : ""}`} aria-label="Streaming profiles">
      <div className="tsm-rail__head">
        {!collapsed ? (
          <>
            <span className="tsm-rail__title">Profiles</span>
            <span className="tsm-rail__count">{api.profiles.length}</span>
          </>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="tsm-rail__search">
          <div className="tsm-input-wrap">
            <input
              className="tsm-input"
              type="search"
              placeholder="Search profiles"
              aria-label="Search profiles"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{ paddingLeft: 28 }}
            />
            <Search
              size={13}
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 9,
                color: "var(--text-mute)",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="tsm-rail__list tsm-scroll" role="list">
        {api.bootLoading ? (
          <p className="tsm-rail-empty">Loading profiles…</p>
        ) : api.bootError ? (
          <p className="tsm-rail-empty" style={{ color: "var(--danger)" }}>
            {api.bootError}
          </p>
        ) : filtered.length === 0 ? (
          <p className="tsm-rail-empty">
            {query ? `No profile matches “${query}”.` : "No profiles yet. Create one to begin."}
          </p>
        ) : (
          filtered.map((profile) => {
            const isActive = profile.id === api.activeProfile?.id;
            const switching = api.switchingId === profile.id;
            const connected = isActive && api.connState === "connected";
            return (
              <div key={profile.id} role="listitem" style={{ position: "relative" }}>
                <button
                  type="button"
                  className={`tsm-profile${isActive ? " is-active" : ""}${
                    collapsed ? " is-collapsed" : ""
                  }`}
                  onClick={() => void api.selectProfile(profile.id)}
                  aria-current={isActive ? "true" : undefined}
                  disabled={switching}
                  title={collapsed ? profile.name : undefined}
                >
                  {collapsed ? (
                    <span className="tsm-profile__initial" aria-hidden="true">
                      {profile.name.slice(0, 2).toUpperCase()}
                    </span>
                  ) : (
                    <>
                      <span className="tsm-profile__top">
                        <span className="tsm-profile__name">{profile.name}</span>
                        {switching ? (
                          <span className="tsm-spinner" aria-hidden="true" />
                        ) : (
                          <span
                            className={`tsm-profile__dot${connected ? " is-ok" : ""}`}
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span className="tsm-profile__meta">
                        {profile.service_type === "custom" ? "Custom RTMP" : "Tango"} ·{" "}
                        {profile.obs_connection.host}:{profile.obs_connection.port}
                      </span>
                      <span className="tsm-profile__flags">
                        <Chip tone="idle" mono>
                          {profile.quality.output_width}×{profile.quality.output_height}
                        </Chip>
                        <Chip tone={profile.has_credential ? "ok" : "warn"}>
                          {profile.has_credential ? "Key" : "No key"}
                        </Chip>
                      </span>
                    </>
                  )}
                </button>

                {isActive && !collapsed ? (
                  <div
                    style={{
                      display: "flex",
                      gap: 2,
                      padding: "2px 8px 6px 10px",
                      marginTop: -2,
                    }}
                  >
                    <button
                      type="button"
                      className="tsm-btn tsm-btn--ghost tsm-btn--sm"
                      onClick={() => onRename(profile)}
                      aria-label={`Rename ${profile.name}`}
                    >
                      <Pencil size={11} /> Rename
                    </button>
                    <button
                      type="button"
                      className="tsm-btn tsm-btn--ghost tsm-btn--sm"
                      onClick={() => void api.duplicateProfile(profile.id)}
                      aria-label={`Duplicate ${profile.name}`}
                    >
                      <Copy size={11} /> Copy
                    </button>
                    <button
                      type="button"
                      className="tsm-btn tsm-btn--ghost tsm-btn--sm"
                      style={{ color: "var(--danger)" }}
                      onClick={() => onDelete(profile)}
                      aria-label={`Delete ${profile.name}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="tsm-rail__foot">
        <button
          type="button"
          className="tsm-btn tsm-btn--primary tsm-btn--block"
          onClick={onCreate}
          aria-label="Create profile"
        >
          {collapsed ? <Plus size={14} /> : <FolderPlus size={13} />}
          {!collapsed ? "New profile" : null}
        </button>
      </div>
    </aside>
  );
}

export function railSummary(profile: ProfileSummaryDto): string {
  return qualitySummary(profile.quality);
}
