"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../../../../components/AuthProvider";
import PageBackButton from "../../../../../components/PageBackButton";
import SpecialBreak from "../../../../../components/SpecialBreak";
import TeamBadge from "../../../../../components/TeamBadge";
import TeamLabel from "../../../../../components/TeamLabel";
import { getRoomBootstrapCached, patchRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";
import { getFixturesCached } from "@/lib/fixturesClient";
import { getGameDataCached } from "@/lib/gameDataClient";
import { getRoomGameStateCached } from "@/lib/gameStateClient";
import {
  subscribeRoomGameDoc,
  subscribeRoomGoldens,
  subscribeRoomPicks,
  subscribeRoomPowerups,
  subscribeRoomPlayers,
} from "@/lib/liveGameBus";
import {
  fixtureDayKey,
  fixtureDayLabel,
  formatKickoffParts,
  formatUnlockDateParts,
} from "@/lib/dateDisplay";
import { getCountdownParts } from "../lock-utils";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "POWERUPS" | "REVEAL";
  players: string[];
  order?: string[];
  fixtureIds: number[];
  forcedReveal?: boolean;
};

type Fixture = {
  fixtureId: number;
  kickoff: string;
  status: string;
  home: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
  away: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
  result?: string | null;
};

type PickDoc = {
  uid: string;
  fixtureId: number;
  score: string; // "2-1"
};

type GoldenDoc = {
  uid: string;
  fixtureId: number;
  score: string;
  locked: boolean;
};

type PowerupDoc = {
  uid: string;
  fixtureId: number;
  powerupType: "ALL_IN" | "SAFETY_NET";
  locked: boolean;
};

const BTN_3D = "btn-3d-accent";
const TEAM_COLOR_BY_TLA: Record<string, string> = {
  ARS: "#ef4444",
  AVL: "#7c3aed",
  BHA: "#3b82f6",
  BOU: "#ef4444",
  BRE: "#dc2626",
  CHE: "#2563eb",
  CRY: "#1d4ed8",
  EVE: "#1e3a8a",
  FUL: "#f3f4f6",
  IPS: "#1d4ed8",
  LEI: "#1d4ed8",
  LIV: "#dc2626",
  MCI: "#38bdf8",
  MUN: "#dc2626",
  NEW: "#94a3b8",
  NFO: "#dc2626",
  SOU: "#ef4444",
  TOT: "#f8fafc",
  WHU: "#7c3aed",
  WOL: "#f59e0b",
  SUN: "#ef4444",
  BUR: "#7c3aed",
  LEE: "#f8fafc",
};

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => `${c}${c}`)
          .join("")
      : normalized.padEnd(6, "0");
  const int = Number.parseInt(full, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function colorForTeam(tla?: string | null, shortName?: string | null, name?: string | null) {
  const key = String(tla || shortName || name || "")
    .trim()
    .toUpperCase()
    .slice(0, 3);
  return TEAM_COLOR_BY_TLA[key] || "#475569";
}

function fmtScore(s?: string | null) {
  if (!s) return "—";
  return s.replace("-", "–");
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
    s === "HT" ||
    /^\d/.test(s);
  return inPlay ? "LIVE" : "TBD";
}

function statusHeading(status: string) {
  const raw = String(status || "").trim();
  const s = raw.toUpperCase();
  if (!raw || s === "TIMED" || s === "SCHEDULED" || s === "NOT_STARTED" || s === "TBD") {
    return "Scheduled";
  }
  if (s === "FINISHED" || s === "FT" || s === "AWARDED") return "FT";
  if (s === "CANCELLED" || s === "POSTPONED") return "Postponed";
  if (s === "LIVE") return "Live";
  return `Live - ${raw}`;
}

function byDisplayName(
  uidA: string,
  uidB: string,
  displayNamesByUid: Record<string, string>,
) {
  const a = displayNamesByUid[uidA] ?? uidA;
  const b = displayNamesByUid[uidB] ?? uidB;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export default function RevealPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode],
  );
  const router = useRouter();
  const { user, loading } = useAuth();

  const [gw, setGw] = useState<number | null>(null);
  const [seasonKey, setSeasonKey] = useState<string | null>(null);
  const [game, setGame] = useState<GameDoc | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);

  const [picks, setPicks] = useState<PickDoc[]>([]);
  const [goldensByUid, setGoldensByUid] = useState<Record<string, GoldenDoc>>(
    {},
  );
  const [powerupsByUid, setPowerupsByUid] = useState<Record<string, PowerupDoc>>({});
  const [displayNamesByUid, setDisplayNamesByUid] = useState<
    Record<string, string>
  >({});

  const routedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(0);
  const [clockReady, setClockReady] = useState(false);

  // auth guard
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/");
  }, [loading, user, router]);

  // current GW
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getRoomBootstrapCached(roomCode);
        const n = Number(data.currentGameweek ?? 1);
        const sk = String(data.seasonKey || "");
        const resolvedGw = Number.isFinite(n) ? n : 1;

        if (!cancelled) {
          setGw(resolvedGw);
          setSeasonKey(sk);
        }
      } catch {
        if (!cancelled) {
          setGw(1);
          setSeasonKey("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  // listen to game doc (for routing + player list + fixtureIds)
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    let cancelled = false;
    (async () => {
      const cached = await getRoomGameStateCached(roomCode, seasonKey, gw);
      if (!cancelled && cached) setGame(cached as GameDoc);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomCode, gw, seasonKey]);

  // listen to game doc (for routing + player list + fixtureIds)
  useEffect(() => {
    if (!user || gw == null || !seasonKey) return;
    const unsub = subscribeRoomGameDoc(
      roomCode,
      seasonKey,
      gw,
      (data) => {
        const gameData = (data as GameDoc | null) ?? null;
        setGame(gameData);

        const st = String(gameData?.state ?? "")
          .trim()
          .toUpperCase();
        if (st) patchRoomBootstrapCached(roomCode, { gameState: st });

        if (routedRef.current) return;

        // keep navigation consistent
        if (st === "DRAFT") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/play`);
        } else if (st === "GOLDEN") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/golden`);
        } else if (st === "POWERUPS") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/powerups`);
        } else if (st === "LOBBY") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame`);
        }
      },
      () => setError("Failed to load game state."),
    );

    return unsub;
  }, [user, roomCode, gw, router, seasonKey]);

  // load fixtures
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    let cancelled = false;

    (async () => {
      const d = await getFixturesCached(gw, seasonKey);
      const fx: Fixture[] = Array.isArray(d.fixtures) ? d.fixtures : [];
      if (!cancelled) setFixtures(fx);
    })().catch(() => !cancelled && setFixtures([]));

    return () => {
      cancelled = true;
    };
  }, [gw, seasonKey]);

  // listen picks
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    let cancelled = false;
    (async () => {
      const data = await getGameDataCached(roomCode, seasonKey, gw);
      if (cancelled) return;
      const list: PickDoc[] = data.picks.map((p) => ({
        uid: p.uid,
        fixtureId: p.fixtureId,
        score: p.score,
      }));
      const map: Record<string, GoldenDoc> = {};
      for (const g of data.goldens) {
        map[g.uid] = {
          uid: g.uid,
          fixtureId: g.fixtureId,
          score: g.score,
          locked: g.locked,
        };
      }
      const powerupMap: Record<string, PowerupDoc> = {};
      for (const p of data.powerups ?? []) {
        const t = String(p.powerupType || "").toUpperCase();
        if (t !== "ALL_IN" && t !== "SAFETY_NET") continue;
        powerupMap[p.uid] = {
          uid: p.uid,
          fixtureId: p.fixtureId,
          powerupType: t as PowerupDoc["powerupType"],
          locked: p.locked,
        };
      }
      setPicks(list);
      setGoldensByUid(map);
      setPowerupsByUid(powerupMap);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gw, roomCode, seasonKey]);

  // listen picks
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    return subscribeRoomPicks(
      roomCode,
      seasonKey,
      gw,
      (list) => setPicks(list as PickDoc[]),
      () => setError("Failed to listen for picks."),
    );
  }, [roomCode, gw, seasonKey]);

  // listen golden
  useEffect(() => {
    if (gw == null || !seasonKey) return;
    return subscribeRoomGoldens(
      roomCode,
      seasonKey,
      gw,
      (list) => {
        const map: Record<string, GoldenDoc> = {};
        for (const g of list) {
          map[g.uid] = {
            uid: g.uid,
            fixtureId: g.fixtureId,
            score: g.score,
            locked: g.locked,
          };
        }
        setGoldensByUid(map);
      },
      () => setError("Failed to listen for goldens."),
    );
  }, [roomCode, gw, seasonKey]);

  useEffect(() => {
    if (gw == null || !seasonKey) return;
    return subscribeRoomPowerups(
      roomCode,
      seasonKey,
      gw,
      (list) => {
        const map: Record<string, PowerupDoc> = {};
        for (const p of list) {
          const t = String(p.powerupType || "").toUpperCase();
          if (t !== "ALL_IN" && t !== "SAFETY_NET") continue;
          map[p.uid] = {
            uid: p.uid,
            fixtureId: p.fixtureId,
            powerupType: t as PowerupDoc["powerupType"],
            locked: p.locked,
          };
        }
        setPowerupsByUid(map);
      },
      () => setError("Failed to listen for power-ups."),
    );
  }, [roomCode, gw, seasonKey]);

  // seed + listen player display names (best-effort) so we can show names instead of UIDs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await getRoomPlayersCached(roomCode);
        if (cancelled || !cached.length) return;
        setDisplayNamesByUid((prev) => {
          const next = { ...prev };
          for (const player of cached) {
            const nick = String(player.nickName || "").trim();
            next[player.uid] = nick || player.displayName || next[player.uid] || "Player";
          }
          return next;
        });
      } catch {
        // ignore cache errors; live listener below can still populate
      }
    })();

    const unsub = subscribeRoomPlayers(
      roomCode,
      (players) => {
        setDisplayNamesByUid((prev) => {
          const map: Record<string, string> = { ...prev };
          for (const player of players) {
            const nick = String(player.nickName || "").trim();
            map[player.uid] = nick || player.displayName || map[player.uid] || "Player";
          }
          return map;
        });
      },
      () => {},
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [roomCode]);

  useEffect(() => {
    const tick = () => {
      setNowMs(Date.now());
      setClockReady(true);
    };
    const boot = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(boot);
      clearInterval(timer);
    };
  }, []);

  const players = useMemo(() => {
    // Prefer order if present (nice stable ordering)
    const arr = (game?.order?.length ? game.order : game?.players) ?? [];
    return Array.isArray(arr) ? arr : [];
  }, [game]);
  const playersSorted = useMemo(
    () => [...players].sort((a, b) => byDisplayName(a, b, displayNamesByUid)),
    [displayNamesByUid, players],
  );

  const fixtureIds = useMemo(() => {
    if (game?.fixtureIds?.length) return game.fixtureIds;
    return (fixtures ?? []).map((f) => f.fixtureId);
  }, [game, fixtures]);

  const fixtureMap = useMemo(() => {
    const m = new Map<number, Fixture>();
    (fixtures ?? []).forEach((f) => m.set(f.fixtureId, f));
    return m;
  }, [fixtures]);
  const dayBoundaryByIdx = useMemo(() => {
    const firstIdxByDay = new Map<string, number>();
    const lastIdxByDay = new Map<string, number>();
    fixtureIds.forEach((fid, idx) => {
      const fixture = fixtureMap.get(fid);
      const dayKey = fixtureDayKey(fixture?.kickoff || "");
      if (!firstIdxByDay.has(dayKey)) firstIdxByDay.set(dayKey, idx);
      lastIdxByDay.set(dayKey, idx);
    });
    return fixtureIds.map((fid, idx) => {
      const fixture = fixtureMap.get(fid);
      const dayKey = fixtureDayKey(fixture?.kickoff || "");
      return {
        showDayHeader: firstIdxByDay.get(dayKey) === idx,
        showDayFooter: lastIdxByDay.get(dayKey) === idx,
        dayLabel: fixtureDayLabel(fixture?.kickoff || ""),
      };
    });
  }, [fixtureIds, fixtureMap]);

  const picksByUserFixture = useMemo(() => {
    const m = new Map<string, string>(); // key = uid|fixtureId
    for (const p of picks)
      m.set(`${p.uid}|${p.fixtureId}`, String(p.score ?? "").trim());
    return m;
  }, [picks]);

  const lockedCount = useMemo(() => {
    return Object.values(goldensByUid).filter((g) => g?.locked).length;
  }, [goldensByUid]);

  const allLocked = !!game?.forcedReveal || (players.length > 0 && lockedCount >= players.length);
  const nextGw = gw != null ? gw + 1 : null;
  const unlockAtMs = useMemo(() => {
    if (!fixtures?.length) return null;
    const kickoffTimes = fixtures
      .map((f) => Date.parse(String(f.kickoff || "")))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (!kickoffTimes.length) return null;
    const unlock = new Date(kickoffTimes[kickoffTimes.length - 1]);
    unlock.setUTCDate(unlock.getUTCDate() + 1);
    unlock.setUTCHours(0, 1, 0, 0);
    return unlock.getTime();
  }, [fixtures]);
  const unlockMsLeft = unlockAtMs != null && clockReady ? Math.max(unlockAtMs - nowMs, 0) : 0;
  const unlockCountdown = getCountdownParts(unlockMsLeft);
  const unlockTotalSec = Math.floor(unlockMsLeft / 1000);
  const unlockDayValue = Math.floor(unlockTotalSec / 86400);
  const unlockHourValue = Math.floor((unlockTotalSec % 86400) / 3600);
  const unlockMinuteValue = Math.floor((unlockTotalSec % 3600) / 60);
  const unlockSecondValue = unlockTotalSec % 60;
  const unlockCountdownRings = [
    {
      label: "Days",
      value: !clockReady ? "--" : unlockCountdown.days,
      progress: !clockReady ? 0 : unlockDayValue > 0 ? Math.min((unlockDayValue / 7) * 100, 100) : 0,
    },
    {
      label: "Hours",
      value: !clockReady ? "--" : unlockCountdown.hours,
      progress: !clockReady ? 0 : (unlockHourValue / 24) * 100,
    },
    {
      label: "Minutes",
      value: !clockReady ? "--" : unlockCountdown.minutes,
      progress: !clockReady ? 0 : (unlockMinuteValue / 60) * 100,
    },
    {
      label: "Seconds",
      value: !clockReady ? "--" : unlockCountdown.seconds,
      progress: !clockReady ? 0 : (unlockSecondValue / 60) * 100,
    },
  ];

  if (loading || !user) return null;

  if (gw == null || fixtures == null || !game) {
    return (
      <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">
        <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-semibold text-foreground">Final Overview</h1>
              <div className="font-display text-sm text-muted">
                {roomCode} • GW {gw ?? "—"}
              </div>
            </div>
          </div>
          <div className="rounded-xl p-4 bg-surface-2 border border-teal-500">
            <div className="text-sm text-muted inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Loading reveal…</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const state = String(game.state ?? "").toUpperCase();
  if (state !== "REVEAL") {
    return (
      <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">

        <div className="w-full max-w-[900px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-3 border border-teal-500">
          <div className="text-xl font-semibold text-foreground">
            Reveal not ready
          </div>
          <div className="text-sm text-muted">Current state: {game.state}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">

      <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-teal-500">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">
              Final Overview
            </h1>
            <div className="font-display text-sm text-muted">
              {roomCode} • GW {gw}
            </div>
          </div>

          <div className="ml-auto flex gap-2 page-actions-enter">
            <PageBackButton
              label="Exit"
              className={BTN_3D}
              onClick={() => router.push(`/room/${roomCode}`)}
            />
          </div>
        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        <div className="border border-teal-500 rounded-xl p-3 bg-surface-2 space-y-1">
          <div className="text-xs text-muted">
            Next gameweek:{" "}
            <span className="font-display text-foreground">GW {nextGw ?? "—"}</span>
          </div>
          {unlockAtMs != null && (
            <>
              <div className="text-xs text-muted">
                Unlocks:{" "}
                <span className="font-display text-foreground">
                  {(() => {
                    const p = formatUnlockDateParts(unlockAtMs);
                    return (
                      <>
                        {p.day}
                        <span className="relative -top-[0.35em] ml-[1px] text-[0.72em] font-semibold">
                          {p.suffix}
                        </span>{" "}
                        {p.monthYear} {p.time}
                      </>
                    );
                  })()}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                {unlockCountdownRings.map((unit) => (
                  <div key={unit.label} className="flex flex-col items-center gap-2">
                    <div className="relative w-16 h-16 sm:w-[72px] sm:h-[72px]">
                      <svg
                        className="absolute inset-0 w-full h-full -rotate-90"
                        viewBox="0 0 80 80"
                        aria-hidden="true"
                      >
                        <circle
                          cx="40"
                          cy="40"
                          r="34"
                          fill="none"
                          stroke="rgba(var(--room-accent-rgb), 0.2)"
                          strokeWidth="4"
                        />
                        <circle
                          cx="40"
                          cy="40"
                          r="34"
                          fill="none"
                          stroke="rgb(var(--room-accent-rgb))"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray={213.63}
                          strokeDashoffset={
                            213.63 - (Math.max(Math.min(unit.progress, 100), 0) / 100) * 213.63
                          }
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="font-display text-lg sm:text-xl font-semibold text-foreground leading-none">
                          {unit.value}
                        </span>
                      </div>
                    </div>
                    <div className="font-display text-[11px] uppercase tracking-wide text-accent font-semibold">
                      {unit.label}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {!allLocked && (
          <div className="border border-yellow-300/65 rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none p-4 bg-[linear-gradient(180deg,rgba(250,204,21,0.12)_0%,rgba(250,204,21,0.04)_100%)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-foreground">Reveal is syncing</div>
                <div className="text-sm text-muted mt-1 inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Waiting for all locked picks to finish.</span>
                </div>
              </div>
              <span className="font-display rounded-full border border-yellow-300/70 bg-yellow-400/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-foreground">
                {lockedCount}/{players.length || 0} locked
              </span>
            </div>
          </div>
        )}

        <SpecialBreak />
        <div className="text-center">
          <div className="font-display inline-flex items-center rounded-md border border-[color:rgba(var(--room-accent-rgb),0.65)] bg-[linear-gradient(180deg,rgba(var(--room-accent-rgb),0.2)_0%,rgba(var(--room-accent-rgb),0.08)_100%)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-foreground shadow-[0_4px_12px_rgba(var(--room-accent-rgb),0.15)]">
            Gameweek {gw}
          </div>
        </div>
        <div className="grid items-start gap-3 sm:gap-4 grid-cols-1 min-[400px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {fixtureIds.map((fid, idx) => {
            const f = fixtureMap.get(fid);
            const kickoffParts = f ? formatKickoffParts(f.kickoff) : null;
            const homeColor = colorForTeam(f?.home.tla, f?.home.shortName, f?.home.name);
            const awayColor = colorForTeam(f?.away.tla, f?.away.shortName, f?.away.name);
            const clashBgStyle: React.CSSProperties = {
              backgroundImage: `linear-gradient(120deg, ${hexToRgba(homeColor, 0.2)} 0%, rgba(9,12,22,0.92) 42%, rgba(9,12,22,0.92) 58%, ${hexToRgba(awayColor, 0.2)} 100%)`,
            };
            const dayBoundary = dayBoundaryByIdx[idx];
            const showDayHeader = !!dayBoundary?.showDayHeader;
            const showDayFooter = !!dayBoundary?.showDayFooter;
            const dayLabel = dayBoundary?.dayLabel || "";

            return (
              <div
                key={fid}
                className="fixture-card-enter space-y-2 w-full"
                style={{
                  animationDelay: `${120 + Math.min(idx, 12) * 110}ms`,
                  animationDuration: "520ms",
                }}
              >
                <div className="h-5 sm:h-6 flex items-center justify-center">
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
                  className="fixture-clash-bg border border-white/15 rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none p-[clamp(0.75rem,1.1vw,1.25rem)]"
                  style={clashBgStyle}
                >
                  <div className="space-y-2">
                  <div className="text-[clamp(0.72rem,0.95vw,0.9rem)] text-muted mb-1">
                    {kickoffParts ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display font-semibold">
                          {kickoffParts.dayNum}
                          <span className="relative -top-[0.35em] ml-[1px] text-[0.72em] font-semibold">
                            {kickoffParts.suffix}
                          </span>{" "}
                          {kickoffParts.monthYear}
                        </span>
                        <span className="font-display font-semibold tabular-nums">{kickoffParts.time}</span>
                      </div>
                    ) : (
                      <span>Fixture {fid}</span>
                    )}
                  </div>

                  {f && (
                    <>
                      <div className="sm:hidden">
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <div className="flex flex-col items-center text-center min-w-0">
                            <TeamBadge
                              name={f.home.name}
                              shortName={f.home.shortName}
                              badge={f.home.badge}
                              tla={f.home.tla}
                            />
                            <TeamLabel
                              name={f.home.name}
                              tla={f.home.tla}
                              shortName={f.home.shortName}
                              wrapperClassName="mt-1 flex w-[78px] flex-col items-center gap-1 text-center"
                              abbrClassName="font-display w-full text-[10px] sm:text-[11px] text-foreground uppercase tracking-wide text-center"
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
                              shortName={f.away.shortName}
                              badge={f.away.badge}
                              tla={f.away.tla}
                            />
                            <TeamLabel
                              name={f.away.name}
                              tla={f.away.tla}
                              shortName={f.away.shortName}
                              wrapperClassName="mt-1 flex w-[78px] flex-col items-center gap-1 text-center"
                              abbrClassName="font-display w-full text-[10px] sm:text-[11px] text-foreground uppercase tracking-wide text-center"
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
                            shortName={f.home.shortName}
                            badge={f.home.badge}
                            tla={f.home.tla}
                          />
                          <TeamLabel
                            name={f.home.name}
                            tla={f.home.tla}
                            shortName={f.home.shortName}
                            wrapperClassName="mt-1 flex w-[96px] xl:w-[110px] flex-col items-center gap-1 text-center"
                            abbrClassName="font-display w-full text-[clamp(0.76rem,0.95vw,0.92rem)] font-semibold text-foreground uppercase tracking-wide text-center"
                            fullNameClassName="font-display w-full text-[10px] xl:text-[11px] text-muted leading-tight"
                            fullNameWindowPx={88}
                          />
                        </div>
                        <span className="font-display text-xs xl:text-sm font-semibold text-muted uppercase inline-flex items-center justify-center self-center h-full">
                          vs
                        </span>
                        <div className="flex flex-col items-center text-center min-w-0">
                          <TeamBadge
                            name={f.away.name}
                            shortName={f.away.shortName}
                            badge={f.away.badge}
                            tla={f.away.tla}
                          />
                          <TeamLabel
                            name={f.away.name}
                            tla={f.away.tla}
                            shortName={f.away.shortName}
                            wrapperClassName="mt-1 flex w-[96px] xl:w-[110px] flex-col items-center gap-1 text-center"
                            abbrClassName="font-display w-full text-[clamp(0.76rem,0.95vw,0.92rem)] font-semibold text-foreground uppercase tracking-wide text-center"
                            fullNameClassName="font-display w-full text-[10px] xl:text-[11px] text-muted leading-tight"
                            fullNameWindowPx={88}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <div className="text-xs text-muted text-center">Predictions</div>
                  <div className="w-full flex flex-wrap justify-center gap-2">
                    {playersSorted.map((uid) => {
                      const sc = picksByUserFixture.get(`${uid}|${fid}`) || "";
                      const g = goldensByUid[uid];
                      const isGolden = g?.locked && g?.fixtureId === fid;
                      const p = powerupsByUid[uid];
                      const powerupType =
                        p?.locked && p?.fixtureId === fid ? p.powerupType : null;
                      const toneClass = "bg-surface border-teal-500";
                      const goldenBorderClass = isGolden ? "!border-yellow-300/75" : "";
                      const goldenGlowClass = isGolden
                        ? "shadow-[inset_0_0_0_1px_rgba(250,204,21,0.55),0_8px_18px_rgba(250,204,21,0.16)]"
                        : "";
                      return (
                        <div
                          key={`${fid}-${uid}`}
                          className={[
                            "relative min-w-0 !overflow-visible w-[calc(50%-0.25rem)] min-[460px]:w-[calc(33.333%-0.34rem)] lg:w-[calc(50%-0.25rem)] xl:w-[calc(33.333%-0.34rem)]",
                          ].join(" ")}
                        >
                          {isGolden || powerupType ? (
                            <span className="absolute -right-1.5 -top-1.5 z-10 inline-flex flex-col items-end gap-1">
                              {isGolden ? (
                                <Image
                                  src="/icons/powerups/golden-pick-v2.svg"
                                  alt=""
                                  aria-hidden
                                  width={16}
                                  height={16}
                                  className="h-4 w-4 drop-shadow-[0_2px_5px_rgba(0,0,0,0.35)]"
                                />
                              ) : null}
                              {powerupType ? (
                                <Image
                                  src={
                                    powerupType === "ALL_IN"
                                      ? "/icons/powerups/all-in-v2.svg"
                                      : "/icons/powerups/safety-net-v2.svg"
                                  }
                                  alt=""
                                  aria-hidden
                                  width={16}
                                  height={16}
                                  className="h-4 w-4 drop-shadow-[0_2px_5px_rgba(0,0,0,0.35)]"
                                />
                              ) : null}
                            </span>
                          ) : null}
                          <div
                            className={[
                              "rounded-lg rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none px-2 py-2 text-center border",
                              toneClass,
                              goldenBorderClass,
                              goldenGlowClass,
                              powerupType === "ALL_IN"
                                ? "border-red-400/85 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.55),0_8px_18px_rgba(248,113,113,0.16)]"
                                : powerupType === "SAFETY_NET"
                                  ? "border-blue-400/85 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.55),0_8px_18px_rgba(96,165,250,0.16)]"
                                  : "",
                            ].join(" ")}
                          >
                            <div
                              className={[
                                "font-display text-[clamp(0.66rem,0.85vw,0.82rem)] font-semibold truncate",
                                "text-muted",
                              ].join(" ")}
                            >
                              {displayNamesByUid[uid] ?? uid.slice(0, 6)}
                            </div>
                            <div
                              className={[
                                "font-display mt-1 flex w-full items-center justify-center gap-1 text-[clamp(0.7rem,1.1vw,1rem)] font-bold tabular-nums whitespace-nowrap",
                                "text-foreground",
                              ].join(" ")}
                            >
                              {fmtScore(sc)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
