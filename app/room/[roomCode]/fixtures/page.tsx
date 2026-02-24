"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronDown, Info, RefreshCw } from "lucide-react";
import { useAuth } from "../../../../components/AuthProvider";
import AnimatedModal from "../../../../components/AnimatedModal";
import ModalExitButton from "../../../../components/ModalExitButton";
import PageBackButton from "../../../../components/PageBackButton";
import GameweekNavigator from "../../../../components/GameweekNavigator";
import SectionCard from "../../../../components/SectionCard";
import SliderSwitch from "../../../../components/SliderSwitch";
import SpecialBreak from "../../../../components/SpecialBreak";
import TeamBadge from "../../../../components/TeamBadge";
import TeamLabel from "../../../../components/TeamLabel";
import { db } from "../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import { getRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { getFixturesCached, refreshFixturesCached } from "@/lib/fixturesClient";
import { getTableCached, type TableRow } from "@/lib/tableClient";
import { getMatchInfoCached, type MatchInfoData } from "@/lib/matchInfoClient";
import { getGameDataCached } from "@/lib/gameDataClient";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";
import {
  fixtureDayKey,
  fixtureDayLabel,
  formatDateTimeLabel,
  formatDateWithOrdinal,
  formatKickoffParts,
} from "@/lib/dateDisplay";
import { teamAbbr } from "@/lib/teamDisplay";
import {
  collection,
  onSnapshot,
  query,
} from "firebase/firestore";

type Fixture = {
  fixtureId: number;
  gameweek: number;
  kickoff: string; // ISO
  status: string;
  home: { id?: number; name: string; tla?: string | null; shortName?: string; badge?: string | null };
  away: { id?: number; name: string; tla?: string | null; shortName?: string; badge?: string | null };
  result?: string | null; // "2-1" if finished
};

type Player = { uid: string; displayName: string };

// picksByFixture[fixtureId][uid] = "2-1"
type PicksByFixture = Record<number, Record<string, string>>;

// goldenByUid[uid] = { fixtureId, score }
type GoldenByUid = Record<string, { fixtureId: number; score: string }>;
type PowerupByUid = Record<
  string,
  { fixtureId: number; powerupType: "DOUBLE"; locked: boolean }
>;
type RoomPlayerDoc = { displayName?: string; nickName?: string };
type TableMode = "HOME" | "TOTAL" | "AWAY";
type TableView = "SHORT" | "FULL";
type MatchInfoTab = "h2h" | "form";

const TABLE_MODE_OPTIONS: Array<{ key: TableMode; label: string }> = [
  { key: "HOME", label: "Home" },
  { key: "TOTAL", label: "Combined" },
  { key: "AWAY", label: "Away" },
];

const BTN_3D = "btn-3d-accent";
const SELECT_3D = "select-3d-accent";

function seasonLabel(seasonKey: string) {
  if (!/^\d{4}$/.test(seasonKey)) return seasonKey;
  return `${seasonKey.slice(0, 2)}/${seasonKey.slice(2)}`;
}

const MIN_GW = 1;
const MAX_GW = 38;


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

function displayResult(status: string, actual: string | null) {
  if (actual) return actual.replace("-", " – ");
  const s = String(status || "").toUpperCase();
  const inPlay =
    s.includes("IN_PLAY") ||
    s.includes("LIVE") ||
    s.includes("PAUSED") ||
    s === "1H" ||
    s === "2H" ||
    s === "HT";
  return inPlay ? "LIVE" : "TBD";
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

function toInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function competitionAbbr(name?: string | null, code?: string | null) {
  const n = String(name || "").toLowerCase();
  const c = String(code || "").toUpperCase();
  if (n.includes("champions")) return "UCL";
  if (n.includes("fa cup")) return "FA";
  if (n.includes("carabao") || n.includes("league cup") || n.includes("efl")) return "EFL";
  if (n.includes("premier") || c === "PL") return "PL";
  if (c) return c;
  return "PL";
}

function formatShortKickoff(iso: string) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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
  const [powerupByUid, setPowerupByUid] = useState<PowerupByUid>({});
  const [error, setError] = useState<string | null>(null);
  const [gw, setGw] = useState<number>(1);
  const [seasonKey, setSeasonKey] = useState<string>("");
  const [seasonOptions, setSeasonOptions] = useState<string[]>([]);
  const [refreshingFixtures, setRefreshingFixtures] = useState(false);
  const [refreshLockedUntil, setRefreshLockedUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [fixturesGeneratedAt, setFixturesGeneratedAt] = useState<Date | null>(
    null,
  );
  const [fixturesRefreshedAt, setFixturesRefreshedAt] = useState<Date | null>(
    null,
  );
  const [fixturesLoading, setFixturesLoading] = useState(false);
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
  const [tableAnimatingOut, setTableAnimatingOut] = useState(false);
  const tableSwapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [matchInfoOpen, setMatchInfoOpen] = useState(false);
  const [matchInfoFixtureId, setMatchInfoFixtureId] = useState<number | null>(null);
  const [matchInfoTab, setMatchInfoTab] = useState<MatchInfoTab>("h2h");
  const [matchInfoLoading, setMatchInfoLoading] = useState(false);
  const [matchInfoError, setMatchInfoError] = useState<string | null>(null);
  const [matchInfoByFixture, setMatchInfoByFixture] = useState<Record<number, MatchInfoData>>({});

  const scheduleTableSwap = useCallback((apply: () => void) => {
    if (tableSwapTimerRef.current) {
      clearTimeout(tableSwapTimerRef.current);
      tableSwapTimerRef.current = null;
    }
    setTableAnimatingOut(true);
    tableSwapTimerRef.current = setTimeout(() => {
      apply();
      setTableAnimatingOut(false);
      tableSwapTimerRef.current = null;
    }, 150);
  }, []);

  const selectTableMode = useCallback(
    (next: TableMode) => {
      if (next === tableMode) return;
      scheduleTableSwap(() => setTableMode(next));
    },
    [scheduleTableSwap, tableMode],
  );

  const selectTableView = useCallback(
    (next: TableView) => {
      if (next === tableView) return;
      scheduleTableSwap(() => setTableView(next));
    },
    [scheduleTableSwap, tableView],
  );

  const currentMatchInfo = useMemo(
    () => (matchInfoFixtureId != null ? matchInfoByFixture[matchInfoFixtureId] ?? null : null),
    [matchInfoByFixture, matchInfoFixtureId],
  );

  const openMatchInfo = useCallback(
    async (fixtureId: number, homeTeamId?: number, awayTeamId?: number) => {
      setMatchInfoFixtureId(fixtureId);
      setMatchInfoTab("h2h");
      setMatchInfoOpen(true);
      setMatchInfoError(null);

      if (matchInfoByFixture[fixtureId]) return;
      if (!seasonKey || !Number.isFinite(Number(homeTeamId)) || !Number.isFinite(Number(awayTeamId))) return;

      setMatchInfoLoading(true);
      try {
        const data = await getMatchInfoCached(fixtureId, seasonKey, homeTeamId, awayTeamId);
        setMatchInfoByFixture((prev) => ({ ...prev, [fixtureId]: data }));
      } catch (e: unknown) {
        setMatchInfoError(e instanceof Error ? e.message : "Failed to load match info.");
      } finally {
        setMatchInfoLoading(false);
      }
    },
    [matchInfoByFixture, seasonKey],
  );

  const selectedMatchFixture = useMemo(
    () =>
      matchInfoFixtureId != null
        ? (fixtures ?? []).find((f) => f.fixtureId === matchInfoFixtureId) ?? null
        : null,
    [fixtures, matchInfoFixtureId],
  );

  const h2hSummary = useMemo(() => {
    const rows = currentMatchInfo?.headToHead ?? [];
    const homeId = Number(selectedMatchFixture?.home?.id);
    const awayId = Number(selectedMatchFixture?.away?.id);
    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;

    for (const m of rows.slice(0, 5)) {
      const score = String(m.result || "");
      const parts = score.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!parts) continue;
      const h = Number(parts[1]);
      const a = Number(parts[2]);
      if (!Number.isFinite(h) || !Number.isFinite(a)) continue;
      if (h === a) {
        draws += 1;
        continue;
      }

      const matchHomeId = Number(m.homeTeam?.id);
      const matchAwayId = Number(m.awayTeam?.id);
      const matchWinnerId = h > a ? matchHomeId : matchAwayId;
      if (Number.isFinite(homeId) && matchWinnerId === homeId) homeWins += 1;
      else if (Number.isFinite(awayId) && matchWinnerId === awayId) awayWins += 1;
    }

    return { homeWins, draws, awayWins };
  }, [currentMatchInfo?.headToHead, selectedMatchFixture?.away?.id, selectedMatchFixture?.home?.id]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await getRoomBootstrapCached(roomCode);
        const current = Number(data.currentGameweek ?? 1);
        const options = Array.isArray(data.seasonOptions) ? data.seasonOptions : [];
        const season = String(data.seasonKey || "");
        if (!cancelled) {
          setGw(Number.isFinite(current) ? current : 1);
          setSeasonKey(season);
          setSeasonOptions(
            options.length
              ? options
              : season
                ? [season]
                : [],
          );
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
  }, [roomCode]);

  // Auth guard
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/");
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
    if (refreshLockedUntil <= nowMs) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [refreshLockedUntil, nowMs]);

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
    let cancelled = false;
    const q = query(collection(db, "rooms", roomCode, "players"));
    (async () => {
      try {
        const cached = await getRoomPlayersCached(roomCode);
        if (cancelled || !cached.length) return;
        const seeded: Player[] = cached.map((p) => ({
          uid: p.uid,
          displayName: String(p.nickName || "").trim() || p.displayName || "Player",
        }));
        setPlayers(seeded);
      } catch {
        // ignore
      }
    })();
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Player[] = snap.docs
          .map((d) => {
            const data = d.data() as RoomPlayerDoc;
            const nick = String(data.nickName || "").trim();
            return {
              uid: d.id,
              displayName: nick || data.displayName || "Player",
            };
          })
          .sort((a, b) =>
            a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
          );
        setPlayers(list);
      },
      (e) =>
        setError(
          `Failed to load players: ${e?.message ?? "permission denied"}`,
        ),
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [roomCode]);

  const loadFixtures = useCallback(
    async (opts?: { force?: boolean; showSpinner?: boolean }) => {
      const force = !!opts?.force;
      const showSpinner = opts?.showSpinner ?? true;

      if (showSpinner) setFixtures(null);
      setFixturesLoading(true);
      setError(null);

      if (!seasonKey) {
        setFixtures([]);
        setFixturesGeneratedAt(null);
        setFixturesRefreshedAt(new Date());
        return;
      }
      try {
        const data = force
          ? await refreshFixturesCached(gw, seasonKey)
          : await getFixturesCached(gw, seasonKey);
        const fx: Fixture[] = Array.isArray(data.fixtures) ? data.fixtures : [];
        setFixtures(fx);
        setFixturesGeneratedAt(asDate(data.generatedAt));
        setFixturesRefreshedAt(new Date());
      } finally {
        setFixturesLoading(false);
      }
    },
    [gw, seasonKey],
  );

  // Load fixtures for selected GW
  useEffect(() => {
    if (!bootstrapped) return;
    let cancelled = false;
    setFixtures(null);
    setFixturesLoading(true);
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      (async () => {
        try {
          await loadFixtures({ showSpinner: false });
        } catch (e) {
          if (!cancelled) {
            const message = e instanceof Error ? e.message : "";
            setFixtures([]);
            setError(`Failed to load fixtures for GW ${gw}. ${message}`.trim());
          }
        }
      })();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [bootstrapped, gw, loadFixtures]);

  // Load minigame picks + golden for selected GW
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setError(null);
      setPicksByFixture({});
      setGoldenByUid({});
      setPowerupByUid({});

      if (!seasonKey) return;
      const gameData = await getGameDataCached(roomCode, seasonKey, gw);

      const byFx: PicksByFixture = {};
      for (const data of gameData.picks) {
        const fixtureId = Number(data.fixtureId);
        const uid = String(data.uid);
        const score = String(data.score);
        if (!byFx[fixtureId]) byFx[fixtureId] = {};
        byFx[fixtureId][uid] = score;
      }

      const gByUid: GoldenByUid = {};
      for (const data of gameData.goldens) {
        gByUid[data.uid] = {
          fixtureId: Number(data.fixtureId),
          score: String(data.score),
        };
      }
      const pByUid: PowerupByUid = {};
      for (const data of gameData.powerups ?? []) {
        if (data.powerupType !== "DOUBLE") continue;
        pByUid[data.uid] = {
          fixtureId: Number(data.fixtureId),
          powerupType: "DOUBLE",
          locked: Boolean(data.locked),
        };
      }

      if (!cancelled) {
        setPicksByFixture(byFx);
        setGoldenByUid(gByUid);
        setPowerupByUid(pByUid);
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

  const isLoading = fixtures === null || fixturesLoading;
  const navLoading = !bootstrapped;
  const refreshLockSeconds = Math.max(
    0,
    Math.ceil((refreshLockedUntil - nowMs) / 1000),
  );

  async function refreshFixtures() {
    if (refreshingFixtures || refreshLockSeconds > 0) return;
    setRefreshLockedUntil(Date.now() + 10_000);
    setNowMs(Date.now());
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

  function setCompactModeValue(next: boolean) {
    setCompactMode(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("fixturesCompactMode", next ? "1" : "0");
    }
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
    if (tableSwapTimerRef.current) {
      clearTimeout(tableSwapTimerRef.current);
      tableSwapTimerRef.current = null;
    }
    setTableAnimatingOut(false);
    setTableOpen(true);
    setTableLoading(true);
    setTableError(null);
    setTableMode("TOTAL");
    setTableView("FULL");
    try {
      const data = await getTableCached(seasonKey);
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

  useEffect(() => {
    return () => {
      if (tableSwapTimerRef.current) clearTimeout(tableSwapTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!seasonKey) return;
    void getTableCached(seasonKey).catch(() => {});
  }, [seasonKey]);

  return (
    <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">

      <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        {/* Header */}
        <div className="relative z-30 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="font-display text-[clamp(1.5rem,2.2vw,2.1rem)] font-semibold text-foreground">Fixtures</h1>
              <div className="font-display text-[clamp(0.85rem,1.1vw,1rem)] text-muted">
                {roomCode} • {seasonLabel(seasonKey || "----")} • GW {gw} 
              </div>
            </div>
            <div className="ml-auto flex gap-2 page-actions-enter">
              <button
                onClick={refreshFixtures}
                disabled={refreshingFixtures || refreshLockSeconds > 0}
                className={`h-10 w-10 text-sm rounded-lg bg-surface border border-teal-500 text-foreground hover:bg-surface-2 inline-flex sm:hidden items-center justify-center page-action-btn disabled:opacity-60 ${BTN_3D}`}
                aria-label="Refresh fixtures"
                title={
                  refreshLockSeconds > 0
                    ? `Refresh locked (${refreshLockSeconds}s)`
                    : "Refresh fixtures"
                }
              >
                <RefreshCw
                  size={16}
                  className={refreshingFixtures ? "animate-spin" : ""}
                />
              </button>
              <PageBackButton
                onClick={() => router.push(`/room/${roomCode}`)}
                className={BTN_3D}
              />
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
              <button
                onClick={refreshFixtures}
                disabled={refreshingFixtures || refreshLockSeconds > 0}
                className={`h-10 w-10 text-sm rounded-lg bg-surface border border-teal-500 text-foreground hover:bg-surface-2 hidden sm:inline-flex items-center justify-center page-action-btn disabled:opacity-60 ${BTN_3D}`}
                aria-label="Refresh fixtures"
                title={
                  refreshLockSeconds > 0
                    ? `Refresh locked (${refreshLockSeconds}s)`
                    : "Refresh fixtures"
                }
              >
                <RefreshCw
                  size={16}
                  className={refreshingFixtures ? "animate-spin" : ""}
                />
              </button>
            </div>
          </div>
        </div>

        {/* GW nav */}
        <GameweekNavigator
          value={gw}
          min={MIN_GW}
          max={MAX_GW}
          disabled={navLoading}
          onChange={setGw}
          buttonClassName={`
            h-[clamp(2.45rem,3.2vw,2.85rem)] w-[clamp(2.45rem,3.2vw,2.85rem)]
            flex items-center justify-center p-0 leading-none rounded-lg
            bg-surface border border-teal-500 text-foreground hover:bg-surface-2 disabled:opacity-40
            ${BTN_3D}
          `}
          selectClassName={`
            w-full h-[clamp(2.45rem,3.2vw,2.85rem)] px-8 rounded-lg border border-teal-500
            bg-surface text-foreground text-[clamp(0.85rem,1.1vw,1rem)] font-semibold text-center
            appearance-none [text-align-last:center] focus:outline-none focus:ring-2 focus:ring-teal-500
            ${SELECT_3D}
          `}
        />

        <SectionCard className="rounded-xl p-3 bg-surface-2 border border-teal-500">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-foreground">Prediction Key</div>
            <SliderSwitch
              options={[
                { value: "full", label: "Full" },
                { value: "compact", label: "Compact" },
              ]}
              value={compactMode ? "compact" : "full"}
              onChange={(v) => setCompactModeValue(v === "compact")}
              className="relative grid rounded-lg border border-teal-500 bg-surface-2 p-1 overflow-hidden min-w-[152px]"
              buttonClassName="font-display relative z-10 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors text-foreground"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-muted">
            <div className="key-chip key-chip-result font-display rounded-md border border-emerald-400/70 bg-emerald-500/20 px-2 py-1 text-center">
              Correct Result
            </div>
            <div className="key-chip key-chip-exact font-display rounded-md border border-purple-400/70 bg-purple-500/20 px-2 py-1 text-center">
              Exact Score
            </div>
            <div className="font-display rounded-md border border-yellow-300/70 bg-yellow-400/10 px-2 py-1 text-center">
              Golden Pick
            </div>
            <div className="font-display rounded-md border border-red-400/80 bg-transparent px-2 py-1 text-center text-foreground">
              Double Points
            </div>
          </div>
        </SectionCard>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        {/* Fixtures */}
        <SpecialBreak />
        <div className="grid items-start gap-x-3 sm:gap-x-4 gap-y-[6px] sm:gap-y-[8px] grid-cols-1 min-[400px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
              const firstIdxByDay = new Map<string, number>();
              const lastIdxByDay = new Map<string, number>();
              fixtures.forEach((fixture, idx) => {
                const dayKey = fixtureDayKey(fixture.kickoff);
                if (!firstIdxByDay.has(dayKey)) firstIdxByDay.set(dayKey, idx);
                lastIdxByDay.set(dayKey, idx);
              });

              const renderFixtureCard = (
                f: Fixture,
                idx: number,
                showDayHeader: boolean,
                showDayFooter: boolean,
                dayLabel: string,
              ) => {
              const actual = f.result ?? null;
              const kickoffParts = formatKickoffParts(f.kickoff);
              const isExpanded = expandedFixtures[f.fixtureId] ?? !compactMode;
              return (
                <div
                  key={f.fixtureId}
                  className="fixture-card-enter space-y-[6px] sm:space-y-[8px] w-full"
                  style={{
                    animationDelay: `${120 + Math.min(idx, 12) * 110}ms`,
                    animationDuration: "520ms",
                  }}
                >
                  <div className="h-4 sm:h-5 flex items-center justify-center">
                    {showDayHeader ? (
                      <div className="w-full flex items-center gap-2">
                        <span className="h-px flex-1 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.08)_0%,rgba(var(--room-accent-rgb),0.45)_55%,rgba(var(--room-accent-rgb),0.08)_100%)]" />
                        <span className="font-display inline-flex items-center rounded-md border border-[color:rgba(var(--room-accent-rgb),0.65)] bg-[linear-gradient(180deg,rgba(var(--room-accent-rgb),0.2)_0%,rgba(var(--room-accent-rgb),0.08)_100%)] px-2.5 py-[2px] text-[10px] sm:text-xs font-semibold leading-none text-muted uppercase tracking-wide shadow-[0_4px_12px_rgba(var(--room-accent-rgb),0.15)]">
                          {dayLabel}
                        </span>
                        <span className="h-px flex-1 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.08)_0%,rgba(var(--room-accent-rgb),0.45)_55%,rgba(var(--room-accent-rgb),0.08)_100%)]" />
                      </div>
                    ) : showDayFooter ? (
                      <div className="w-full flex items-center justify-center gap-1.5">
                        <span className="h-px w-7 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.05)_0%,rgba(var(--room-accent-rgb),0.42)_100%)]" />
                        <span
                          className="h-1.5 w-1.5 rounded-full border border-[color:rgba(var(--room-accent-rgb),0.75)] bg-[color:rgba(var(--room-accent-rgb),0.55)]"
                          aria-hidden
                        />
                        <span className="h-px w-7 bg-[linear-gradient(90deg,rgba(var(--room-accent-rgb),0.42)_0%,rgba(var(--room-accent-rgb),0.05)_100%)]" />
                      </div>
                    ) : (
                      <span aria-hidden className="invisible w-full">_</span>
                    )}
                  </div>
                <div
                  className="border border-teal-500 rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none px-[clamp(0.75rem,1.1vw,1.25rem)] pt-[clamp(0.62rem,0.92vw,0.98rem)] pb-[clamp(0.58rem,0.92vw,0.95rem)] bg-surface-2 page-action-btn cursor-pointer"
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
                          <span className="font-display font-semibold">
                            {kickoffParts.dayNum}
                            <sup className="text-[9px] ml-[1px]">{kickoffParts.suffix}</sup>{" "}
                            {kickoffParts.monthYear}
                          </span>
                          <span className="font-display font-semibold">{kickoffParts.time}</span>
                        </div>
                        <div className="hidden sm:flex items-center justify-between gap-2">
                          <span className="font-display font-semibold">
                            {kickoffParts.dayNum}
                            <sup className="text-[9px] ml-[1px]">{kickoffParts.suffix}</sup>{" "}
                            {kickoffParts.monthYear}
                          </span>
                          <span className="font-display font-semibold">{kickoffParts.time}</span>
                        </div>
                      </div>
                      <div className="sm:hidden">
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <div className="flex flex-col items-center text-center min-w-0">
                            <TeamBadge
                              name={f.home.name}
                              tla={f.home.tla}
                              shortName={f.home.shortName}
                              badge={f.home.badge}
                            />
                            <TeamLabel
                              name={f.home.name}
                              tla={f.home.tla}
                              shortName={f.home.shortName}
                              wrapperClassName="mt-1 flex w-[78px] flex-col items-center gap-1 text-center"
                              abbrClassName="font-display w-full text-[10px] text-foreground uppercase tracking-wide text-center"
                              fullNameClassName="font-display w-full text-[9px] text-muted leading-tight"
                              fullNameWindowPx={68}
                            />
                          </div>
                          <span className="font-display text-[10px] font-semibold text-muted uppercase inline-flex items-center justify-center">
                            vs
                          </span>
                          <div className="flex flex-col items-center text-center min-w-0">
                            <TeamBadge
                              name={f.away.name}
                              tla={f.away.tla}
                              shortName={f.away.shortName}
                              badge={f.away.badge}
                            />
                            <TeamLabel
                              name={f.away.name}
                              tla={f.away.tla}
                              shortName={f.away.shortName}
                              wrapperClassName="mt-1 flex w-[78px] flex-col items-center gap-1 text-center"
                              abbrClassName="font-display w-full text-[10px] text-foreground uppercase tracking-wide text-center"
                              fullNameClassName="font-display w-full text-[9px] text-muted leading-tight"
                              fullNameWindowPx={68}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="hidden sm:grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                        <div className="flex flex-col items-center text-center min-w-0">
                          <TeamBadge
                            name={f.home.name}
                            tla={f.home.tla}
                            shortName={f.home.shortName}
                            badge={f.home.badge}
                          />
                          <TeamLabel
                            name={f.home.name}
                            tla={f.home.tla}
                            shortName={f.home.shortName}
                            wrapperClassName="mt-1 flex w-[96px] xl:w-[110px] flex-col items-center gap-1 text-center"
                            abbrClassName="font-display w-full text-[clamp(0.76rem,0.95vw,0.92rem)] font-semibold text-foreground uppercase tracking-wide text-center"
                            fullNameClassName="font-display w-full text-[10px] text-muted leading-tight"
                            fullNameWindowPx={88}
                          />
                        </div>
                        <span className="font-display text-xs font-semibold text-muted uppercase inline-flex items-center justify-center self-center h-full">
                          vs
                        </span>
                        <div className="flex flex-col items-center text-center min-w-0">
                          <TeamBadge
                            name={f.away.name}
                            tla={f.away.tla}
                            shortName={f.away.shortName}
                            badge={f.away.badge}
                          />
                          <TeamLabel
                            name={f.away.name}
                            tla={f.away.tla}
                            shortName={f.away.shortName}
                            wrapperClassName="mt-1 flex w-[96px] xl:w-[110px] flex-col items-center gap-1 text-center"
                            abbrClassName="font-display w-full text-[clamp(0.76rem,0.95vw,0.92rem)] font-semibold text-foreground uppercase tracking-wide text-center"
                            fullNameClassName="font-display w-full text-[10px] text-muted leading-tight"
                            fullNameWindowPx={88}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[clamp(0.85rem,1.1vw,1rem)] text-muted">Result</div>
                      <div className="font-display text-[clamp(1rem,1.5vw,1.3rem)] font-semibold text-foreground tabular-nums">
                        {displayResult(f.status, actual)}
                      </div>
                    </div>
                    <div className="flex items-center justify-center text-xs text-muted">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openMatchInfo(f.fixtureId, f.home?.id, f.away?.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-teal-500 px-2 py-1 bg-surface text-foreground hover:bg-surface-2"
                      >
                        <Info size={12} />
                        Match Info
                      </button>
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
                      <div className="w-full flex flex-wrap justify-center gap-2">
                        {players.map((p) => {
                          const pred =
                            picksByFixture?.[f.fixtureId]?.[p.uid] ?? "";
                          const golden = goldenByUid[p.uid];
                          const isGolden =
                            !!golden &&
                            golden.fixtureId === f.fixtureId &&
                            golden.score === pred;
                          const powerup = powerupByUid[p.uid];
                          const isDouble =
                            !!powerup &&
                            powerup.locked &&
                            powerup.powerupType === "DOUBLE" &&
                            powerup.fixtureId === f.fixtureId;
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
                            ? "key-chip key-chip-exact bg-purple-500/20 border-purple-400/70"
                            : isOutcomeOnly
                              ? "key-chip key-chip-result bg-emerald-500/20 border-emerald-400/70"
                              : "bg-surface border-teal-500";
                          const goldenToneClass =
                            isExact || isOutcomeOnly
                              ? isExact
                                ? "key-chip key-chip-golden-exact bg-[linear-gradient(135deg,rgba(168,85,247,0.20)_0%,rgba(168,85,247,0.20)_48%,rgba(250,204,21,0.20)_52%,rgba(250,204,21,0.20)_100%)] border-yellow-300/60"
                                : "key-chip key-chip-golden-result bg-[linear-gradient(45deg,rgba(250,204,21,0.20)_0%,rgba(250,204,21,0.20)_48%,rgba(16,185,129,0.20)_52%,rgba(16,185,129,0.20)_100%)] border-yellow-300/60"
                              : "bg-yellow-300/10 border-yellow-300/60";
                          const isGoldenScored = isGolden && (isExact || isOutcomeOnly);

                          return (
                            <div
                              key={p.uid}
                              className={[
                                "rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none px-2 py-2 text-center overflow-hidden border min-w-0 w-[calc(50%-0.25rem)] min-[460px]:w-[calc(33.333%-0.34rem)] lg:w-[calc(50%-0.25rem)] xl:w-[calc(33.333%-0.34rem)]",
                                isGoldenScored
                                  ? "rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none ring-1 ring-yellow-300/65 shadow-[0_10px_22px_rgba(250,204,21,0.22),inset_0_0_0_1px_rgba(250,204,21,0.35)]"
                                  : "rounded-lg",
                                isGolden
                                  ? goldenToneClass
                                  : toneClass,
                                isDouble ? "border-red-400/85 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.5)]" : "",
                              ].join(" ")}
                            >
                              <div
                                className={[
                                  "font-display text-[clamp(0.66rem,0.85vw,0.82rem)] font-semibold truncate",
                                  "text-muted",
                                ].join(" ")}
                              >
                                {p.displayName}
                              </div>

                              <div
                                className={[
                                  "font-display mt-1 flex w-full items-center justify-center gap-1 text-[clamp(0.7rem,1.1vw,1rem)] font-bold tabular-nums",
                                  "whitespace-nowrap",
                                  "text-foreground",
                                ].join(" ")}
                              >
                                {fmtScore(pred)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    </div>
                  </div>
                </div>
                </div>
              );
              };

              return fixtures.map((fixture, idx) => {
                const dayKey = fixtureDayKey(fixture.kickoff);
                const showDayHeader = firstIdxByDay.get(dayKey) === idx;
                const showDayFooter = lastIdxByDay.get(dayKey) === idx;
                const dayLabel = fixtureDayLabel(fixture.kickoff);
                return renderFixtureCard(
                  fixture,
                  idx,
                  showDayHeader,
                  showDayFooter,
                  dayLabel,
                );
              });
            })()}
        </div>

        {(fixturesGeneratedAt || fixturesRefreshedAt) && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-xs text-muted">
            {fixturesGeneratedAt && (
              <div>Fixture snapshot time: {formatDateTimeLabel(fixturesGeneratedAt)}</div>
            )}
            {fixturesRefreshedAt && (
              <div>Fixtures page last refreshed: {formatDateTimeLabel(fixturesRefreshedAt)}</div>
            )}
          </div>
        )}
      </div>

      <AnimatedModal
        open={matchInfoOpen}
        onClose={() => setMatchInfoOpen(false)}
        portal
        lockBackground
        zIndexClassName="z-[90]"
        overlayClassName="bg-black/50 backdrop-blur-sm"
        panelClassName="w-full max-w-2xl h-[min(88vh,760px)] overflow-hidden rounded-2xl border border-[color:rgba(var(--room-accent-rgb),0.7)] bg-surface shadow-card"
      >
        <div className="h-full p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-display text-lg font-semibold text-foreground">
                Match Info
              </div>
              <div className="text-xs text-muted">
                {selectedMatchFixture
                  ? `${teamAbbr({
                      name: selectedMatchFixture.home.name,
                      tla: selectedMatchFixture.home.tla,
                      shortName: selectedMatchFixture.home.shortName,
                    })} vs ${teamAbbr({
                      name: selectedMatchFixture.away.name,
                      tla: selectedMatchFixture.away.tla,
                      shortName: selectedMatchFixture.away.shortName,
                    })} • ${formatShortKickoff(selectedMatchFixture.kickoff)}`
                  : "Fixture details"}
              </div>
            </div>
            <ModalExitButton
              onClick={() => setMatchInfoOpen(false)}
              ariaLabel="Exit match info"
              className={`border-[color:rgba(var(--room-accent-rgb),0.65)] ${BTN_3D}`}
            />
          </div>

          <SliderSwitch
            options={[
              { value: "h2h", label: "Head to Head" },
              { value: "form", label: "Team Form" },
            ]}
            value={matchInfoTab}
            onChange={(v) => setMatchInfoTab(v as MatchInfoTab)}
            className="relative grid rounded-lg border border-[color:rgba(var(--room-accent-rgb),0.65)] bg-surface-2 p-1 overflow-hidden"
            buttonClassName="relative z-10 rounded-md px-3 py-2 text-xs font-semibold transition-colors text-foreground"
          />

          <SpecialBreak />

          <div className="min-h-0 flex-1 overflow-auto no-scrollbar space-y-3 pr-1">
            {matchInfoLoading && <div className="text-sm text-muted">Loading match info…</div>}
            {!matchInfoLoading && matchInfoError && (
              <div className="rounded-lg border border-teal-500 bg-surface-2 p-3 text-sm text-danger">
                {matchInfoError}
              </div>
            )}
            {!matchInfoLoading && !matchInfoError && currentMatchInfo && matchInfoTab === "h2h" && (
              <div className="space-y-2">
                {currentMatchInfo.headToHead.length ? currentMatchInfo.headToHead.map((m) => (
                  <div key={`h2h-${m.id ?? m.utcDate}`} className="rounded-lg border border-teal-500 bg-surface-2 p-3">
                    <div className="grid grid-cols-[84px_minmax(0,1fr)_40px] items-center gap-2 text-xs">
                      <span className="font-display text-muted whitespace-nowrap">
                        {(() => {
                          const d = formatDateWithOrdinal(m.utcDate);
                          return (
                            <>
                              {d.dayNum}
                              <sup className="text-[9px] ml-[1px]">{d.suffix}</sup> {d.monthYear}
                            </>
                          );
                        })()}
                      </span>
                      <span className="font-display text-sm text-foreground inline-flex min-w-0 items-center justify-center gap-1.5">
                        <span className="inline-flex w-[3.4ch] justify-end">
                          {teamAbbr({
                            name: m.homeTeam.name,
                            tla: m.homeTeam.tla,
                            shortName: null,
                          })}
                        </span>
                        <span className="inline-flex min-w-[3.2ch] justify-center tabular-nums text-foreground">
                          {fmtScore(m.result)}
                        </span>
                        <span className="inline-flex w-[3.4ch] justify-start">
                          {teamAbbr({
                            name: m.awayTeam.name,
                            tla: m.awayTeam.tla,
                            shortName: null,
                          })}
                        </span>
                      </span>
                      <span className="inline-flex h-5 min-w-[30px] rounded-full border border-subtle bg-surface items-center justify-center px-1 justify-self-end">
                        <span className="font-display text-[9px] text-muted leading-none">
                          {competitionAbbr(m.competition?.name, m.competition?.code)}
                        </span>
                      </span>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-lg border border-teal-500 bg-surface-2 p-3 text-sm text-muted">
                    No head-to-head data found.
                  </div>
                )}
                <div className="rounded-lg border border-teal-500 bg-surface-2 p-3">
                  <div className="font-display text-[11px] text-muted text-center mb-2">
                    Last 5 H2H
                  </div>
                  <div className="grid grid-cols-3 items-center gap-2 text-center">
                    <div className="font-display text-xs text-muted">
                      {teamAbbr({
                        name: selectedMatchFixture?.home?.name || "Team 1",
                        tla: selectedMatchFixture?.home?.tla || null,
                        shortName: selectedMatchFixture?.home?.shortName || null,
                      })}
                    </div>
                    <div className="font-display text-xs text-muted">Draws</div>
                    <div className="font-display text-xs text-muted">
                      {teamAbbr({
                        name: selectedMatchFixture?.away?.name || "Team 2",
                        tla: selectedMatchFixture?.away?.tla || null,
                        shortName: selectedMatchFixture?.away?.shortName || null,
                      })}
                    </div>
                    <div className="font-display text-lg font-semibold text-foreground tabular-nums">
                      {h2hSummary.homeWins}
                    </div>
                    <div className="font-display text-lg font-semibold text-foreground tabular-nums">
                      {h2hSummary.draws}
                    </div>
                    <div className="font-display text-lg font-semibold text-foreground tabular-nums">
                      {h2hSummary.awayWins}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!matchInfoLoading && !matchInfoError && currentMatchInfo && matchInfoTab === "form" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {([
                  {
                    side: "home" as const,
                    label: selectedMatchFixture?.home?.name || "Home",
                    list: currentMatchInfo.form.home,
                    badge: selectedMatchFixture?.home?.badge || null,
                    tla: selectedMatchFixture?.home?.tla || null,
                  },
                  {
                    side: "away" as const,
                    label: selectedMatchFixture?.away?.name || "Away",
                    list: currentMatchInfo.form.away,
                    badge: selectedMatchFixture?.away?.badge || null,
                    tla: selectedMatchFixture?.away?.tla || null,
                  },
                ]).map((block) => (
                  <div key={block.side} className="rounded-lg border border-teal-500 bg-surface-2 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-display text-sm font-semibold text-foreground">{block.label}</div>
                      <div className="h-6 w-6 rounded-full flex items-center justify-center overflow-hidden shrink-0">
                        {block.badge ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={block.badge}
                            alt={block.label}
                            className="h-5 w-5 object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <span className="font-display text-[9px] font-bold text-foreground">
                            {teamAbbr({ name: block.label, tla: block.tla, shortName: block.label })}
                          </span>
                        )}
                      </div>
                    </div>
                    {block.list.length ? block.list.map((m) => (
                      <div
                        key={`${block.side}-${m.id ?? m.utcDate}`}
                        className="grid grid-cols-[84px_minmax(0,1fr)_56px] items-center gap-2 text-xs"
                      >
                        <span className="font-display text-muted whitespace-nowrap text-left">
                          {(() => {
                            const d = formatDateWithOrdinal(m.utcDate);
                            return (
                              <>
                                {d.dayNum}
                                <sup className="text-[9px] ml-[1px]">{d.suffix}</sup> {d.monthYear}
                              </>
                            );
                          })()}
                        </span>
                        <span className="font-display text-foreground inline-flex min-w-0 items-center justify-center gap-1.5">
                          <span className="inline-flex w-[3.4ch] justify-end">
                            {teamAbbr({
                              name: m.homeTeam.name,
                              tla: m.homeTeam.tla,
                              shortName: null,
                            })}
                          </span>
                          <span className="inline-flex min-w-[3.2ch] justify-center tabular-nums text-foreground">
                            {fmtScore(m.result)}
                          </span>
                          <span className="inline-flex w-[3.4ch] justify-start">
                            {teamAbbr({
                              name: m.awayTeam.name,
                              tla: m.awayTeam.tla,
                              shortName: null,
                            })}
                          </span>
                        </span>
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <span className="h-5 min-w-[30px] rounded-full border border-subtle bg-surface inline-flex items-center justify-center px-1 shrink-0">
                            <span className="font-display text-[9px] text-muted leading-none">
                              {competitionAbbr(m.competition?.name, m.competition?.code)}
                            </span>
                          </span>
                          <span
                            className={[
                              "inline-flex h-5 w-5 items-center justify-center rounded-full font-display text-[10px] font-semibold",
                              m.form === "W"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/60"
                                : m.form === "L"
                                  ? "bg-rose-500/20 text-rose-300 border border-rose-400/60"
                                  : "bg-surface border border-subtle text-muted",
                            ].join(" ")}
                          >
                            {m.form || "—"}
                          </span>
                        </span>
                      </div>
                    )) : (
                      <div className="text-xs text-muted">No recent form data.</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </AnimatedModal>

      <AnimatedModal
        open={tableOpen}
        onClose={() => setTableOpen(false)}
        portal
        lockBackground
        zIndexClassName="z-[90]"
        overlayClassName="bg-black/50 backdrop-blur-sm"
        panelClassName="w-full max-w-2xl max-h-[95vh] overflow-hidden rounded-2xl border border-[color:rgba(var(--room-accent-rgb),0.7)] bg-surface shadow-card"
      >
            <div className="flex items-center justify-between p-4">
              <div className="font-display text-lg font-semibold text-foreground">
                PL Table • {seasonLabel(seasonKey || "----")}
              </div>
              <ModalExitButton
                onClick={() => setTableOpen(false)}
                ariaLabel="Exit table"
                className={`border-[color:rgba(var(--room-accent-rgb),0.65)] ${BTN_3D}`}
              />
            </div>
            <div className="max-h-[calc(95vh-176px)] flex flex-col">
              {tableLoading ? (
                <div className="p-4 text-sm text-muted">Loading table…</div>
              ) : tableError ? (
                <div className="p-4 text-sm text-danger">{tableError}</div>
              ) : (tableRowsByMode[tableMode] ?? []).length === 0 ? (
                <div className="p-4 text-sm text-muted">No table data available.</div>
              ) : (
                <>
                  <div className="px-4 pb-1 bg-surface-2 shadow-[0_6px_14px_rgba(0,0,0,0.12)]">
                    <div className="mb-2">
                      <SliderSwitch
                        options={TABLE_MODE_OPTIONS.map((opt) => ({
                          value: opt.key,
                          label: opt.label,
                        }))}
                        value={tableMode}
                        onChange={selectTableMode}
                        className="relative grid rounded-lg border border-[color:rgba(var(--room-accent-rgb),0.65)] bg-surface-2 p-1 overflow-hidden"
                        buttonClassName="relative z-10 rounded-md px-3 py-2 text-xs font-semibold transition-colors text-foreground"
                      />
                    </div>
                    <div className="mb-1">
                      <SliderSwitch
                        options={[
                          { value: "SHORT", label: "Short" },
                          { value: "FULL", label: "Full" },
                        ]}
                        value={tableView}
                        onChange={selectTableView}
                        className="relative grid rounded-lg border border-[color:rgba(var(--room-accent-rgb),0.65)] bg-surface-2 p-1 overflow-hidden"
                        buttonClassName="relative z-10 rounded-md px-3 py-2 text-xs font-semibold transition-colors text-foreground"
                      />
                    </div>
                  </div>
                  <div className="px-4 py-2">
                    <SpecialBreak />
                  </div>
                  <div
                    className={[
                      "overflow-auto no-scrollbar min-h-0 px-2 transition-all duration-150 ease-out",
                      tableAnimatingOut ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0",
                    ].join(" ")}
                  >
                    <table
                      key={`${tableMode}-${tableView}`}
                      className="w-full table-fixed text-sm fixture-card-enter"
                      style={{ animationDuration: "240ms" }}
                    >
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
                            className="border-b border-subtle last:border-0 fixture-card-enter"
                            style={{
                              animationDelay: `${Math.min(idx, 12) * 35}ms`,
                              animationDuration: "320ms",
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
                                    <span className="font-display text-[9px] font-bold text-foreground">
                                      {(r.team.shortName || r.team.name || "FC").slice(0, 3).toUpperCase()}
                                    </span>
                                  )}
                                </div>
                                <span
                                  className={[
                                    "font-display text-foreground font-medium truncate",
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
                  </div>
                </>
              )}
            </div>
            <div className="px-4 py-1 space-y-2">
              <SpecialBreak />
              <div className="flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/icon-192.png"
                alt="PL Predictions"
                className="h-10 w-10 object-contain opacity-95"
                loading="lazy"
              />
              </div>
            </div>
      </AnimatedModal>
    </div>
  );
}
