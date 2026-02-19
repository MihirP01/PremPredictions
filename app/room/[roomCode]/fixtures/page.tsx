"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronDown, Settings } from "lucide-react";
import { useAuth } from "../../../../components/AuthProvider";
import { db } from "../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import {
  collection,
  getDocs,
  onSnapshot,
  query,
} from "firebase/firestore";

type Fixture = {
  fixtureId: number;
  gameweek: number;
  kickoff: string; // ISO
  status: string;
  home: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
  away: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
  result?: string | null; // "2-1" if finished
};

type Player = { uid: string; displayName: string };

// picksByFixture[fixtureId][uid] = "2-1"
type PicksByFixture = Record<number, Record<string, string>>;

// goldenByUid[uid] = { fixtureId, score }
type GoldenByUid = Record<string, { fixtureId: number; score: string }>;
type RoomPlayerDoc = { displayName?: string; nickName?: string };
type PickDoc = { fixtureId?: number; uid?: string; score?: string };
type GoldenDoc = { fixtureId?: number; score?: string };
type FixturesResponse = { fixtures?: Fixture[]; generatedAt?: string };
type TableRow = {
  position: number;
  team: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  goalsScored: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};
type TableMode = "HOME" | "TOTAL" | "AWAY";
type TableView = "SHORT" | "FULL";
type TableResponse = {
  standingsTotal?: TableRow[];
  standingsHome?: TableRow[];
  standingsAway?: TableRow[];
  seasonKey?: string;
  error?: string;
};

const TABLE_MODE_OPTIONS: Array<{ key: TableMode; label: string }> = [
  { key: "HOME", label: "Home" },
  { key: "TOTAL", label: "Combined" },
  { key: "AWAY", label: "Away" },
];

const TABLE_MODE_SLIDER_LEFT: Record<TableMode, string> = {
  HOME: "left-1",
  TOTAL: "left-[calc(33.333%+0.02rem)]",
  AWAY: "left-[calc(66.666%+0.02rem)]",
};
const BTN_3D = "btn-3d-accent";
const SELECT_3D = "select-3d-accent";
function seasonLabel(seasonKey: string) {
  if (!/^\d{4}$/.test(seasonKey)) return seasonKey;
  return `${seasonKey.slice(0, 2)}/${seasonKey.slice(2)}`;
}

const MIN_GW = 1;
const MAX_GW = 38;

function fmtKickoffParts(iso: string) {
  const dt = new Date(iso);
  const dayNum = dt.getDate();
  const suffix =
    dayNum % 10 === 1 && dayNum % 100 !== 11
      ? "st"
      : dayNum % 10 === 2 && dayNum % 100 !== 12
        ? "nd"
        : dayNum % 10 === 3 && dayNum % 100 !== 13
          ? "rd"
          : "th";
  const monthYear = dt.toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
  });
  const time = dt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { dayNum, suffix, monthYear, time };
}


function fmtScore(s?: string | null) {
  if (!s) return "—";
  return String(s).replace("-", "–");
}

function parseOutcome(score?: string | null) {
  if (!score) return null;
  const m = String(score).trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  const home = Number(m[1]);
  const away = Number(m[2]);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home > away) return "H";
  if (home < away) return "A";
  return "D";
}

function TeamBadge({
  name,
  shortName,
  badge,
}: {
  name: string;
  shortName?: string;
  badge?: string | null;
}) {
  const fallback = (shortName || name || "FC").slice(0, 3).toUpperCase();
  return (
    <div className="h-10 w-10 rounded-full flex items-center justify-center overflow-hidden shrink-0">
      {badge ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={badge} alt={name} className="h-8 w-8 object-contain" loading="lazy" />
      ) : (
        <span className="text-[10px] font-bold text-foreground">{fallback}</span>
      )}
    </div>
  );
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function fmtDateTime(d: Date) {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function toInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function teamAbbr(team: { name?: string; tla?: string | null; shortName?: string }) {
  const tla = String(team.tla || "").trim().toUpperCase();
  if (/^[A-Z]{2,4}$/.test(tla)) return tla;

  const short = String(team.shortName || "").trim().toUpperCase();
  if (/^[A-Z0-9]{2,4}$/.test(short)) return short;

  const name = String(team.name || "").trim().toUpperCase();
  if (!name) return "FC";

  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w[0])
      .join("");
  }
  return name.slice(0, 3);
}

function fixtureAbbr(name?: string, tla?: string | null, shortName?: string) {
  const code = String(tla || "").trim().toUpperCase();
  if (/^[A-Z0-9]{2,4}$/.test(code)) return code;
  const short = String(shortName || "").trim().toUpperCase();
  if (/^[A-Z0-9]{2,4}$/.test(short)) return short;
  return teamAbbr({ name, shortName });
}

export default function FixturesPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode],
  );
  const router = useRouter();
  const { user, loading } = useAuth();

  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [picksByFixture, setPicksByFixture] = useState<PicksByFixture>({});
  const [goldenByUid, setGoldenByUid] = useState<GoldenByUid>({});
  const [error, setError] = useState<string | null>(null);
  const [gw, setGw] = useState<number>(1);
  const [seasonKey, setSeasonKey] = useState<string>("");
  const [seasonOptions, setSeasonOptions] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshingFixtures, setRefreshingFixtures] = useState(false);
  const [fixturesGeneratedAt, setFixturesGeneratedAt] = useState<Date | null>(
    null,
  );
  const [fixturesRefreshedAt, setFixturesRefreshedAt] = useState<Date | null>(
    null,
  );
  const [compactMode, setCompactMode] = useState(false);
  const [expandedFixtures, setExpandedFixtures] = useState<Record<number, boolean>>({});
  const [bootstrapped, setBootstrapped] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableMode, setTableMode] = useState<TableMode>("TOTAL");
  const [tableView, setTableView] = useState<TableView>("FULL");
  const [tableRowsByMode, setTableRowsByMode] = useState<Record<TableMode, TableRow[]>>({
    HOME: [],
    TOTAL: [],
    AWAY: [],
  });
  const [tableError, setTableError] = useState<string | null>(null);
  const settingsWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await getCurrentGameweekCached();
        const current = Number(data.currentGameweek ?? 1);
        if (!cancelled) {
          setGw(Number.isFinite(current) ? current : 1);
          setSeasonKey(String(data.seasonKey || ""));
        }
      } catch {
        if (!cancelled) {
          setGw(1);
          setSeasonKey("");
        }
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(db, "rooms", roomCode, "seasons"));
        const keys = snap.docs
          .map((d) => d.id)
          .filter((id) => /^\d{4}$/.test(id))
          .sort((a, b) => b.localeCompare(a));
        if (seasonKey && !keys.includes(seasonKey)) keys.unshift(seasonKey);
        if (!cancelled) setSeasonOptions(keys);
      } catch {
        if (!cancelled && seasonKey) setSeasonOptions([seasonKey]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomCode, seasonKey]);

  // Auth guard
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("fixturesCompactMode");
    setCompactMode(raw === "1");
  }, []);

  useEffect(() => {
    if (!fixtures?.length) return;
    const next: Record<number, boolean> = {};
    for (const fx of fixtures) next[fx.fixtureId] = !compactMode;
    setExpandedFixtures(next);
  }, [compactMode, fixtures]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (settingsWrapRef.current?.contains(target)) return;
      setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!tableOpen) return;
    const scrollY = window.scrollY;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyPosition = document.body.style.position;
    const prevBodyTop = document.body.style.top;
    const prevBodyWidth = document.body.style.width;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.position = prevBodyPosition;
      document.body.style.top = prevBodyTop;
      document.body.style.width = prevBodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, [tableOpen]);

  // Load room players (names)
  useEffect(() => {
    const q = query(collection(db, "rooms", roomCode, "players"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Player[] = snap.docs.map((d) => {
          const data = d.data() as RoomPlayerDoc;
          const nick = String(data.nickName || "").trim();
          return {
            uid: d.id,
            displayName: nick || data.displayName || "Player",
          };
        });
        setPlayers(list);
      },
      (e) =>
        setError(
          `Failed to load players: ${e?.message ?? "permission denied"}`,
        ),
    );
    return () => unsub();
  }, [roomCode]);

  const loadFixtures = useCallback(
    async (opts?: { force?: boolean; showSpinner?: boolean }) => {
      const force = !!opts?.force;
      const showSpinner = opts?.showSpinner ?? true;

      if (showSpinner) setFixtures(null);
      setError(null);

      const nonce = force ? `&t=${Date.now()}` : "";
      const seasonParam = seasonKey ? `&seasonKey=${encodeURIComponent(seasonKey)}` : "";
      const res = await fetch(`/api/fixtures?gameweek=${gw}${seasonParam}${nonce}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`fixtures ${res.status}`);

      const data = (await res.json()) as FixturesResponse;
      const fx: Fixture[] = Array.isArray(data.fixtures) ? data.fixtures : [];
      setFixtures(fx);
      setFixturesGeneratedAt(asDate(data.generatedAt));
      setFixturesRefreshedAt(new Date());
    },
    [gw, seasonKey],
  );

  // Load fixtures for selected GW
  useEffect(() => {
    if (!bootstrapped) return;
    let cancelled = false;
    (async () => {
      try {
        await loadFixtures({ showSpinner: true });
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : "";
          setFixtures([]);
          setError(`Failed to load fixtures for GW ${gw}. ${message}`.trim());
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootstrapped, gw, loadFixtures]);

  // Load minigame picks + golden for selected GW
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setError(null);
      setPicksByFixture({});
      setGoldenByUid({});

      if (!seasonKey) return;
      const picksSnap = await getDocs(
        collection(
          db,
          "rooms",
          roomCode,
          "seasons",
          seasonKey,
          "games",
          `gw-${gw}`,
          "picks",
        ),
      );

      const byFx: PicksByFixture = {};
      for (const d of picksSnap.docs) {
        const data = d.data() as PickDoc;
        const fixtureId = Number(data.fixtureId);
        const uid = String(data.uid);
        const score = String(data.score);
        if (!byFx[fixtureId]) byFx[fixtureId] = {};
        byFx[fixtureId][uid] = score;
      }

      const goldenSnap = await getDocs(
        collection(
          db,
          "rooms",
          roomCode,
          "seasons",
          seasonKey,
          "games",
          `gw-${gw}`,
          "golden",
        ),
      );

      const gByUid: GoldenByUid = {};
      for (const d of goldenSnap.docs) {
        const data = d.data() as GoldenDoc;
        gByUid[d.id] = {
          fixtureId: Number(data.fixtureId),
          score: String(data.score),
        };
      }

      if (!cancelled) {
        setPicksByFixture(byFx);
        setGoldenByUid(gByUid);
      }
    })().catch((e) => {
      const msg = String(e?.message ?? "");
      if (!cancelled && msg.toLowerCase().includes("permission")) {
        setError(`Failed to load minigame picks: ${msg}`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [roomCode, gw, seasonKey]);

  const gameweeks = useMemo(
    () => Array.from({ length: MAX_GW }, (_, i) => i + 1),
    [],
  );
  const isLoading = fixtures === null;

  async function refreshFixtures() {
    if (refreshingFixtures) return;
    setRefreshingFixtures(true);
    try {
      await loadFixtures({ force: true, showSpinner: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setError(`Failed to refresh fixtures for GW ${gw}. ${message}`.trim());
    } finally {
      setRefreshingFixtures(false);
    }
  }

  function toggleCompactMode() {
    setCompactMode((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("fixturesCompactMode", next ? "1" : "0");
      }
      return next;
    });
  }

  function toggleFixtureExpanded(fixtureId: number) {
    setExpandedFixtures((prev) => ({
      ...prev,
      [fixtureId]: !prev[fixtureId],
    }));
  }

  async function onSeasonChange(nextSeason: string) {
    setSeasonKey(nextSeason);
    if (!nextSeason) {
      setGw(1);
      return;
    }
    try {
      const data = await getCurrentGameweekCached(nextSeason);
      const current = Number(data.currentGameweek ?? 1);
      setGw(Number.isFinite(current) ? current : 1);
    } catch {
      setGw(1);
    }
  }

  async function openTablePopup() {
    if (tableOpen || tableLoading) return;
    setTableOpen(true);
    setTableLoading(true);
    setTableError(null);
    setTableMode("TOTAL");
    setTableView("FULL");
    try {
      const seasonParam = seasonKey ? `?seasonKey=${encodeURIComponent(seasonKey)}` : "";
      const res = await fetch(`/api/table${seasonParam}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as TableResponse;
      if (!res.ok) throw new Error(data?.error || "Failed to load table.");
      setTableRowsByMode({
        TOTAL: Array.isArray(data.standingsTotal) ? data.standingsTotal : [],
        HOME: Array.isArray(data.standingsHome) ? data.standingsHome : [],
        AWAY: Array.isArray(data.standingsAway) ? data.standingsAway : [],
      });
    } catch (e) {
      setTableError(e instanceof Error ? e.message : "Failed to load table.");
      setTableRowsByMode({ HOME: [], TOTAL: [], AWAY: [] });
    } finally {
      setTableLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] p-6 bg-app">

      <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        {/* Header */}
        <div className="relative z-30 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-[clamp(1.5rem,2.2vw,2.1rem)] font-semibold text-foreground">PL Fixtures</h1>
              <div className="text-[clamp(0.85rem,1.1vw,1rem)] text-muted">
                {roomCode} • {seasonLabel(seasonKey || "----")} • GW {gw} Fixtures
              </div>
            </div>
            <div className="ml-auto flex gap-2 page-actions-enter">
              <button
                onClick={() => router.push(`/room/${roomCode}`)}
                className={`h-10 text-sm rounded-lg px-3 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 whitespace-nowrap inline-flex items-center justify-center page-action-btn ${BTN_3D}`}
                data-action="back"
              >
                Back
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            {!!seasonOptions.length && (
              <div className="w-[132px] sm:w-[140px] relative">
                <label className="sr-only" htmlFor="fixtures-season-select">
                  Select season
                </label>
                <select
                  id="fixtures-season-select"
                  value={seasonKey}
                  onChange={(e) => onSeasonChange(e.target.value)}
                  className={`w-full h-10 rounded-lg border border-teal-500 bg-surface text-foreground text-sm font-semibold px-8 text-center appearance-none [text-align-last:center] focus:outline-none focus:ring-2 focus:ring-teal-500 ${SELECT_3D}`}
                >
                  {seasonOptions.map((s) => (
                    <option key={s} value={s}>
                      {seasonLabel(s)}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                  ▼
                </span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={openTablePopup}
                disabled={tableOpen || tableLoading}
                className={`h-10 text-sm rounded-lg px-3 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 whitespace-nowrap disabled:opacity-60 ${BTN_3D}`}
              >
                {tableLoading ? "Loading…" : "Table"}
              </button>
            <div ref={settingsWrapRef} className="relative page-actions-enter">
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className={`h-10 w-10 text-sm rounded-lg bg-surface border border-teal-500 text-foreground hover:bg-surface-2 inline-flex items-center justify-center page-action-btn ${BTN_3D}`}
                data-action="settings"
                aria-label="Open settings"
              >
                <Settings size={16} />
              </button>
              {settingsOpen && (
                <div className="absolute top-0 right-[calc(100%+12px)] w-60 sm:w-72 rounded-xl border border-teal-500 bg-surface-2 p-3 space-y-2 shadow-card z-20 settings-panel-enter">
                  <div className="font-semibold text-foreground">Settings</div>
                  <button
                    onClick={refreshFixtures}
                    disabled={refreshingFixtures}
                    className={`w-full text-sm rounded-lg px-4 py-2 bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-60 ${BTN_3D}`}
                  >
                    {refreshingFixtures ? "Refreshing..." : "Refresh Fixtures"}
                  </button>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>

        {/* GW nav */}
        <div className="flex items-center gap-3 w-full max-w-md mx-auto">
          <button
            disabled={isLoading || gw === MIN_GW}
            onClick={() => setGw((x) => Math.max(MIN_GW, x - 1))}
            className={`
    h-[clamp(2.45rem,3.2vw,2.85rem)] w-[clamp(2.45rem,3.2vw,2.85rem)]
    flex items-center justify-center p-0 leading-none
    rounded-lg
    bg-surface
    border border-teal-500
    text-foreground
    hover:bg-surface-2
    disabled:opacity-40
    ${BTN_3D}
  `}
          >
            <span className="block shrink-0 text-sm leading-none">◀</span>
          </button>

          <div className="relative min-w-0 flex-1">
            <select
              value={gw}
              disabled={isLoading}
              onChange={(e) => setGw(Number(e.target.value))}
              className={`
      w-full
      h-[clamp(2.45rem,3.2vw,2.85rem)]
      px-8
      rounded-lg
      border border-teal-500
      bg-surface
      text-foreground
      text-[clamp(0.85rem,1.1vw,1rem)] font-semibold
      text-center
      appearance-none
      [text-align-last:center]
      focus:outline-none
      focus:ring-2
      focus:ring-teal-500
      ${SELECT_3D}
    `}
            >
              {gameweeks.map((n) => (
                <option key={n} value={n}>
                  GW {n}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
              ▼
            </span>
          </div>

          <button
            disabled={isLoading || gw === MAX_GW}
            onClick={() => setGw((x) => Math.min(MAX_GW, x + 1))}
            className={`
    h-[clamp(2.45rem,3.2vw,2.85rem)] w-[clamp(2.45rem,3.2vw,2.85rem)]
    flex items-center justify-center p-0 leading-none
    rounded-lg
    bg-surface
    border border-teal-500
    text-foreground
    hover:bg-surface-2
    disabled:opacity-40
    ${BTN_3D}
  `}
          >
            <span className="block shrink-0 text-sm leading-none">▶</span>
          </button>
        </div>

        <div className="rounded-xl p-3 bg-surface-2 border border-teal-500">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-foreground">Prediction Key</div>
            <label className="inline-flex items-center gap-2 text-xs text-foreground select-none">
              <span>Compact</span>
              <button
                type="button"
                role="switch"
                aria-checked={compactMode}
                onClick={toggleCompactMode}
                className={[
                  "relative h-6 w-11 rounded-full border transition-colors",
                  compactMode
                    ? "bg-accent/20 border-teal-400"
                    : "bg-surface border-teal-500",
                ].join(" ")}
              >
                <span
                  className={[
                    "absolute top-0.5 h-4 w-4 rounded-full bg-foreground transition-all",
                    compactMode ? "left-6" : "left-0.5",
                  ].join(" ")}
                />
              </button>
            </label>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-muted">
            <div className="rounded-md border border-emerald-400/70 bg-emerald-500/20 px-2 py-1 text-center">
              Correct Result
            </div>
            <div className="rounded-md border border-purple-400/70 bg-purple-500/20 px-2 py-1 text-center">
              Exact Score
            </div>
            <div className="rounded-md border border-yellow-300/60 bg-[linear-gradient(45deg,rgba(250,204,21,0.20)_0%,rgba(250,204,21,0.20)_48%,rgba(16,185,129,0.20)_52%,rgba(16,185,129,0.20)_100%)] px-2 py-1 text-center">
              Golden + Result
            </div>
            <div className="rounded-md border border-yellow-300/60 bg-[linear-gradient(135deg,rgba(168,85,247,0.20)_0%,rgba(168,85,247,0.20)_48%,rgba(250,204,21,0.20)_52%,rgba(250,204,21,0.20)_100%)] px-2 py-1 text-center">
              Golden + Exact
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        {/* Fixtures */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 items-start">
          {isLoading && (
            <div className="col-span-full text-center text-muted">Loading fixtures…</div>
          )}

          {!isLoading && fixtures.length === 0 && (
            <div className="col-span-full text-center text-muted">
              No fixtures available for this gameweek.
            </div>
          )}

          {!isLoading &&
            fixtures.length > 0 &&
            (() => {
              const leftColumn: Array<{ fixture: Fixture; idx: number }> = [];
              const rightColumn: Array<{ fixture: Fixture; idx: number }> = [];
              fixtures.forEach((fixture, idx) => {
                if (idx % 2 === 0) leftColumn.push({ fixture, idx });
                else rightColumn.push({ fixture, idx });
              });

              const renderFixtureCard = (f: Fixture, idx: number) => {
              const actual = f.result ?? null;
              const kickoffParts = fmtKickoffParts(f.kickoff);
              const isExpanded = expandedFixtures[f.fixtureId] ?? !compactMode;
              const mobileOddPredictions = players.length % 2 !== 0;
              const desktopOddPredictions = players.length % 3 !== 0;

              return (
                <div
                  key={f.fixtureId}
                  className="border border-teal-500 rounded-xl p-[clamp(0.75rem,1.1vw,1.25rem)] bg-surface-2 page-action-btn cursor-pointer"
                  style={{
                    animationDelay: `${120 + Math.min(idx, 12) * 110}ms`,
                    animationDuration: "520ms",
                  }}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleFixtureExpanded(f.fixtureId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleFixtureExpanded(f.fixtureId);
                    }
                  }}
                >
                  <div className="space-y-2">
                    <div>
                      <div className="text-[clamp(0.72rem,0.95vw,0.9rem)] text-muted mb-2">
                        <div className="sm:hidden flex items-center justify-between gap-2">
                          <span>
                            {kickoffParts.dayNum}
                            <sup className="text-[9px] ml-[1px]">{kickoffParts.suffix}</sup>{" "}
                            {kickoffParts.monthYear}
                          </span>
                          <span>{kickoffParts.time}</span>
                        </div>
                        <div className="hidden sm:flex items-center justify-between gap-2">
                          <span>
                            {kickoffParts.dayNum}
                            <sup className="text-[9px] ml-[1px]">{kickoffParts.suffix}</sup>{" "}
                            {kickoffParts.monthYear}
                          </span>
                          <span>{kickoffParts.time}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:hidden">
                        <div className="flex flex-col items-center gap-1">
                          <TeamBadge
                            name={f.home.name}
                            shortName={f.home.shortName}
                            badge={f.home.badge}
                          />
                          <span className="text-[10px] text-muted uppercase tracking-wide">
                            {fixtureAbbr(f.home.name, f.home.tla, f.home.shortName)}
                          </span>
                        </div>
                        <span className="text-[10px] font-semibold text-muted uppercase">vs</span>
                        <div className="flex flex-col items-center gap-1">
                          <TeamBadge
                            name={f.away.name}
                            shortName={f.away.shortName}
                            badge={f.away.badge}
                          />
                          <span className="text-[10px] text-muted uppercase tracking-wide">
                            {fixtureAbbr(f.away.name, f.away.tla, f.away.shortName)}
                          </span>
                        </div>
                      </div>

                      <div className="hidden sm:grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                        <div className="flex flex-col items-center text-center min-w-0">
                          <TeamBadge
                            name={f.home.name}
                            shortName={f.home.shortName}
                            badge={f.home.badge}
                          />
                          <span className="mt-1 text-[clamp(0.82rem,1.05vw,1rem)] font-semibold text-foreground truncate w-full">
                            {f.home.shortName || f.home.name}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-muted uppercase">H vs A</span>
                        <div className="flex flex-col items-center text-center min-w-0">
                          <TeamBadge
                            name={f.away.name}
                            shortName={f.away.shortName}
                            badge={f.away.badge}
                          />
                          <span className="mt-1 text-[clamp(0.82rem,1.05vw,1rem)] font-semibold text-foreground truncate w-full">
                            {f.away.shortName || f.away.name}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[clamp(0.85rem,1.1vw,1rem)] text-muted">Result</div>
                      <div className="text-[clamp(1rem,1.5vw,1.3rem)] font-semibold text-foreground">
                        {actual ? actual.replace("-", " – ") : "TBD"}
                      </div>
                    </div>
                    <div className="flex items-center justify-center gap-1 text-xs text-muted">
                      <span>{isExpanded ? "Hide" : "Show"} Predictions</span>
                      <ChevronDown
                        size={14}
                        className={`transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </div>
                  </div>

                  <div
                    className={[
                      "grid overflow-hidden transition-all duration-400 ease-out",
                      isExpanded ? "grid-rows-[1fr] opacity-100 mt-4" : "grid-rows-[0fr] opacity-0 mt-0",
                    ].join(" ")}
                  >
                    <div className="min-h-0">
                    <div className="text-[clamp(0.85rem,1.1vw,1rem)] font-semibold mb-2 text-muted text-center">
                      Predictions
                    </div>

                    {players.length === 0 ? (
                      <div className="text-sm text-muted">
                        No players found.
                      </div>
                    ) : (
                      <div
                        className={[
                          "gap-2",
                          mobileOddPredictions
                            ? "flex flex-wrap justify-center"
                            : "grid grid-cols-2",
                          desktopOddPredictions
                            ? "sm:flex sm:flex-wrap sm:justify-center"
                            : "sm:grid sm:grid-cols-3",
                        ].join(" ")}
                      >
                        {players.map((p) => {
                          const pred =
                            picksByFixture?.[f.fixtureId]?.[p.uid] ?? "";
                          const golden = goldenByUid[p.uid];
                          const isGolden =
                            !!golden &&
                            golden.fixtureId === f.fixtureId &&
                            golden.score === pred;
                          const predNorm = String(pred || "").trim();
                          const actualNorm = String(actual || "").trim();
                          const isExact =
                            !!predNorm && !!actualNorm && predNorm === actualNorm;
                          const isOutcomeOnly =
                            !isExact &&
                            !!predNorm &&
                            !!actualNorm &&
                            parseOutcome(predNorm) != null &&
                            parseOutcome(predNorm) === parseOutcome(actualNorm);

                          const toneClass = isExact
                            ? "bg-purple-500/20 border-purple-400/70"
                            : isOutcomeOnly
                              ? "bg-emerald-500/20 border-emerald-400/70"
                              : "bg-surface border-teal-500";
                          const goldenToneClass =
                            isExact || isOutcomeOnly
                              ? isExact
                                ? "bg-[linear-gradient(135deg,rgba(168,85,247,0.20)_0%,rgba(168,85,247,0.20)_48%,rgba(250,204,21,0.20)_52%,rgba(250,204,21,0.20)_100%)] border-yellow-300/60"
                                : "bg-[linear-gradient(45deg,rgba(250,204,21,0.20)_0%,rgba(250,204,21,0.20)_48%,rgba(16,185,129,0.20)_52%,rgba(16,185,129,0.20)_100%)] border-yellow-300/60"
                              : "bg-yellow-300/10 border-yellow-300/60";

                          return (
                            <div
                              key={p.uid}
                              className={[
                                "rounded-lg px-2 py-2 text-center overflow-hidden border",
                                mobileOddPredictions
                                  ? "basis-[calc(50%-0.25rem)]"
                                  : "",
                                desktopOddPredictions
                                  ? "sm:basis-[calc(33.333%-0.5rem)]"
                                  : "sm:basis-auto",
                                isGolden
                                  ? goldenToneClass
                                  : toneClass,
                              ].join(" ")}
                            >
                              <div
                                className={[
                                  "text-[clamp(0.66rem,0.85vw,0.82rem)] font-semibold truncate",
                                  "text-muted",
                                ].join(" ")}
                              >
                                {p.displayName}
                              </div>

                              <div
                                className={[
                                  "mt-1 flex w-full items-center justify-center gap-1 text-[clamp(0.7rem,1.1vw,1rem)] font-bold",
                                  "text-foreground",
                                ].join(" ")}
                              >
                                {fmtScore(pred.replace("-", " - "))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    </div>
                  </div>
                </div>
              );
              };

              return (
                <>
                  <div className="space-y-3 sm:space-y-4">
                    {leftColumn.map(({ fixture, idx }) => renderFixtureCard(fixture, idx))}
                  </div>
                  <div className="space-y-3 sm:space-y-4">
                    {rightColumn.map(({ fixture, idx }) => renderFixtureCard(fixture, idx))}
                  </div>
                </>
              );
            })()}
        </div>

        {(fixturesGeneratedAt || fixturesRefreshedAt) && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-xs text-muted">
            {fixturesGeneratedAt && (
              <div>Fixture snapshot time: {fmtDateTime(fixturesGeneratedAt)}</div>
            )}
            {fixturesRefreshedAt && (
              <div>Fixtures page last refreshed: {fmtDateTime(fixturesRefreshedAt)}</div>
            )}
          </div>
        )}
      </div>

      {tableOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl border border-teal-500 bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-subtle p-4">
              <div className="text-lg font-semibold text-foreground">
                Premier League Table • {seasonLabel(seasonKey || "----")}
              </div>
              <button
                onClick={() => setTableOpen(false)}
                className={`h-9 w-9 rounded-lg border border-teal-500 bg-surface text-foreground hover:bg-surface-2 ${BTN_3D}`}
                aria-label="Close table"
              >
                ×
              </button>
            </div>
            <div className="p-4 overflow-auto max-h-[calc(85vh-72px)]">
              {tableLoading ? (
                <div className="text-sm text-muted">Loading table…</div>
              ) : tableError ? (
                <div className="text-sm text-danger">{tableError}</div>
              ) : (tableRowsByMode[tableMode] ?? []).length === 0 ? (
                <div className="text-sm text-muted">No table data available.</div>
              ) : (
                <>
                  <div className="mb-2">
                    <div className="relative grid grid-cols-3 rounded-lg border border-teal-500 bg-surface-2 p-1 overflow-hidden">
                      <span
                        aria-hidden
                        className={[
                          "absolute top-1 bottom-1 w-[calc(33.333%-0.28rem)] rounded-md bg-accent border border-teal-400 transition-all duration-300",
                          TABLE_MODE_SLIDER_LEFT[tableMode],
                        ].join(" ")}
                      />
                      {TABLE_MODE_OPTIONS.map((opt) => (
                        <button
                          key={opt.key}
                          onClick={() => setTableMode(opt.key)}
                          className={[
                            "relative z-10 rounded-md px-3 py-2 text-xs font-semibold transition-colors",
                            tableMode === opt.key
                              ? "text-accent-foreground"
                              : "text-foreground",
                          ].join(" ")}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mb-3">
                    <div className="relative grid grid-cols-2 rounded-lg border border-teal-500 bg-surface-2 p-1 overflow-hidden">
                      <span
                        aria-hidden
                        className={[
                          "absolute top-1 bottom-1 w-[calc(50%-0.25rem)] rounded-md bg-accent border border-teal-400 transition-all duration-300",
                          tableView === "SHORT" ? "left-1" : "left-[calc(50%+0.125rem)]",
                        ].join(" ")}
                      />
                      <button
                        onClick={() => setTableView("SHORT")}
                        className={[
                          "relative z-10 rounded-md px-3 py-2 text-xs font-semibold transition-colors",
                          tableView === "SHORT"
                            ? "text-accent-foreground"
                            : "text-foreground",
                        ].join(" ")}
                      >
                        Short
                      </button>
                      <button
                        onClick={() => setTableView("FULL")}
                        className={[
                          "relative z-10 rounded-md px-3 py-2 text-xs font-semibold transition-colors",
                          tableView === "FULL"
                            ? "text-accent-foreground"
                            : "text-foreground",
                        ].join(" ")}
                      >
                        Full
                      </button>
                    </div>
                  </div>
                  <table className="w-full table-fixed text-sm">
                    {tableView === "FULL" ? (
                      <colgroup>
                        <col style={{ width: "8%" }} />
                        <col style={{ width: "22%" }} />
                        <col style={{ width: "8.75%" }} />
                        <col style={{ width: "8.75%" }} />
                        <col style={{ width: "8.75%" }} />
                        <col style={{ width: "8.75%" }} />
                        <col style={{ width: "8.75%" }} />
                        <col style={{ width: "8.75%" }} />
                        <col style={{ width: "8.75%" }} />
                        <col style={{ width: "8.75%" }} />
                      </colgroup>
                    ) : (
                      <colgroup>
                        <col style={{ width: "8%" }} />
                        <col style={{ width: "52%" }} />
                        <col style={{ width: "13%" }} />
                        <col style={{ width: "13%" }} />
                        <col style={{ width: "14%" }} />
                      </colgroup>
                    )}
                    <thead className="text-muted">
                      <tr className="border-b border-subtle">
                        <th className="py-2 px-1 text-left">#</th>
                        <th className="py-2 px-1 text-left">Club</th>
                        <th className="py-2 px-0.5 sm:px-1 text-center">P</th>
                        {tableView === "FULL" && (
                          <>
                            <th className="py-2 px-0.5 sm:px-1 text-center">W</th>
                            <th className="py-2 px-0.5 sm:px-1 text-center">D</th>
                            <th className="py-2 px-0.5 sm:px-1 text-center">L</th>
                            <th className="py-2 px-0.5 sm:px-1 text-center">GF</th>
                            <th className="py-2 px-0.5 sm:px-1 text-center">GA</th>
                          </>
                        )}
                        <th className="py-2 px-1 text-center">GD</th>
                        <th className="py-2 px-1 text-center">Pts</th>
                      </tr>
                    </thead>
                    <tbody key={`${tableMode}-${tableView}`}>
                      {(tableRowsByMode[tableMode] ?? []).map((r, idx) => (
                        <tr
                          key={`${tableMode}-${tableView}-${r.position}-${r.team.name}`}
                          className="border-b border-subtle last:border-0 page-action-btn"
                          style={{
                            animationDelay: `${Math.min(idx, 12) * 35}ms`,
                            animationDuration: "380ms",
                          }}
                        >
                          <td className="py-2 px-1 text-foreground">{r.position}</td>
                          <td className="py-2 px-1">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-full flex items-center justify-center overflow-hidden shrink-0">
                                {r.team.badge ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={r.team.badge}
                                    alt={r.team.name}
                                    className="h-5 w-5 object-contain"
                                    loading="lazy"
                                  />
                                ) : (
                                  <span className="text-[9px] font-bold text-foreground">
                                    {(r.team.shortName || r.team.name || "FC").slice(0, 3).toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <span
                                className={[
                                  "text-foreground font-medium truncate",
                                  tableView === "FULL" ? "inline text-[10px] sm:text-sm" : "inline",
                                ].join(" ")}
                              >
                                {tableView === "FULL"
                                  ? teamAbbr(r.team)
                                  : (r.team.shortName || r.team.name)}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 px-0.5 sm:px-1 text-center text-foreground">{toInt(r.playedGames)}</td>
                          {tableView === "FULL" && (
                            <>
                              <td className="py-2 px-0.5 sm:px-1 text-center text-foreground">{toInt(r.won)}</td>
                              <td className="py-2 px-0.5 sm:px-1 text-center text-foreground">{toInt(r.draw)}</td>
                              <td className="py-2 px-0.5 sm:px-1 text-center text-foreground">{toInt(r.lost)}</td>
                              <td className="py-2 px-0.5 sm:px-1 text-center text-foreground">{toInt(r.goalsScored)}</td>
                              <td className="py-2 px-0.5 sm:px-1 text-center text-foreground">{toInt(r.goalsAgainst)}</td>
                            </>
                          )}
                          <td className="py-2 px-1 text-center text-foreground">{toInt(r.goalDifference)}</td>
                          <td className="py-2 px-1 text-center font-semibold text-foreground">{toInt(r.points)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
