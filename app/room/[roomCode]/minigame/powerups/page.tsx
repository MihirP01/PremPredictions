"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../../../../components/AuthProvider";
import SpecialBreak from "../../../../../components/SpecialBreak";
import TeamBadge from "../../../../../components/TeamBadge";
import TeamLabel from "../../../../../components/TeamLabel";
import { getRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { getFixturesCached } from "@/lib/fixturesClient";
import { getGameDataCached } from "@/lib/gameDataClient";
import { getRoomGameStateCached } from "@/lib/gameStateClient";
import {
  subscribeRoomGameDoc,
  subscribeRoomGoldens,
  subscribeRoomMeta,
  subscribeRoomPicks,
  subscribeRoomPowerups,
} from "@/lib/liveGameBus";
import {
} from "@/lib/dateDisplay";

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "POWERUPS" | "REVEAL";
  players: string[];
  fixtureIds: number[];
  powerupsEnabled?: boolean;
};

type Fixture = {
  fixtureId: number;
  kickoff: string;
  home: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
  away: { name: string; tla?: string | null; shortName?: string; badge?: string | null };
};

type PickDoc = {
  uid: string;
  fixtureId: number;
  score: string;
};

type PowerupDoc = {
  uid: string;
  fixtureId: number;
  powerupType: "ALL_IN" | "SAFETY_NET";
  locked: boolean;
};

type GoldenDoc = {
  uid: string;
  fixtureId: number;
  score: string;
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

const POWERUP_OPTIONS = [
  {
    type: "ALL_IN" as const,
    label: "All-In",
    icon: "/icons/powerups/all-in-v2.svg",
    className: "border-red-300/75 bg-red-500/10",
    help: "Exact score = 6, else 0.",
  },
  {
    type: "SAFETY_NET" as const,
    label: "Safety Net",
    icon: "/icons/powerups/safety-net-v2.svg",
    className: "border-blue-300/75 bg-blue-500/10",
    help: "If 0 points, becomes 1.",
  },
];

export default function PowerupsPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = useMemo(() => String(params.roomCode).toUpperCase(), [params.roomCode]);
  const router = useRouter();
  const { user, loading } = useAuth();

  const [gw, setGw] = useState<number | null>(null);
  const [seasonKey, setSeasonKey] = useState<string | null>(null);
  const [game, setGame] = useState<GameDoc | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [allPicks, setAllPicks] = useState<PickDoc[]>([]);
  const [myPicksByFixture, setMyPicksByFixture] = useState<Record<number, string>>({});
  const [powerupsByUid, setPowerupsByUid] = useState<Record<string, PowerupDoc>>({});
  const [goldensByUid, setGoldensByUid] = useState<Record<string, GoldenDoc>>({});
  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(null);
  const [selectedPowerupType, setSelectedPowerupType] = useState<PowerupDoc["powerupType"]>("SAFETY_NET");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowIdenticalPicks, setAllowIdenticalPicks] = useState(false);

  const routedRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/");
  }, [loading, router, user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getRoomBootstrapCached(roomCode);
        const n = Number(data.currentGameweek ?? 1);
        if (!cancelled) {
          setGw(Number.isFinite(n) ? n : 1);
          setSeasonKey(String(data.seasonKey || ""));
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
  }, [gw, roomCode, seasonKey]);

  useEffect(() => {
    if (!user || gw == null || !seasonKey) return;
    return subscribeRoomGameDoc(
      roomCode,
      seasonKey,
      gw,
      (data) => {
        const gameData = (data as GameDoc | null) ?? null;
        setGame(gameData);
        const st = String(gameData?.state || "").trim().toUpperCase();
        if (routedRef.current) return;
        if (st === "DRAFT") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/play`);
        } else if (st === "GOLDEN") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/golden`);
        } else if (st === "REVEAL") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame/reveal`);
        } else if (st === "LOBBY") {
          routedRef.current = true;
          router.replace(`/room/${roomCode}/minigame`);
        }
      },
      () => setError("Failed to load game state."),
    );
  }, [gw, roomCode, router, seasonKey, user]);

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

  useEffect(() => {
    if (gw == null || !seasonKey) return;
    let cancelled = false;
    (async () => {
      const data = await getGameDataCached(roomCode, seasonKey, gw);
      if (cancelled) return;
      setAllPicks(
        data.picks.map((p) => ({
          uid: p.uid,
          fixtureId: p.fixtureId,
          score: p.score,
        })),
      );
      const map: Record<string, PowerupDoc> = {};
      for (const p of data.powerups) {
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
      const goldenMap: Record<string, GoldenDoc> = {};
      for (const g of data.goldens) {
        goldenMap[g.uid] = {
          uid: g.uid,
          fixtureId: g.fixtureId,
          score: g.score,
          locked: g.locked,
        };
      }
      setGoldensByUid(goldenMap);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gw, roomCode, seasonKey]);

  useEffect(() => {
    if (gw == null || !seasonKey) return;
    return subscribeRoomPicks(
      roomCode,
      seasonKey,
      gw,
      (list) => {
        const picks = list as PickDoc[];
        setAllPicks(picks);
        if (!user) return;
        const mine: Record<number, string> = {};
        for (const p of picks) {
          if (p.uid === user.uid) mine[p.fixtureId] = p.score;
        }
        setMyPicksByFixture(mine);
        setSelectedFixtureId((prev) => {
          if (prev != null && mine[prev]) return prev;
          const first = Object.keys(mine)[0];
          return first ? Number(first) : null;
        });
      },
      () => setError("Failed to listen for picks."),
    );
  }, [gw, roomCode, seasonKey, user]);

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
  }, [gw, roomCode, seasonKey]);

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
  }, [gw, roomCode, seasonKey]);

  useEffect(() => {
    return subscribeRoomMeta(
      roomCode,
      (roomMeta) => {
        if (!roomMeta) return;
        const style = roomMeta.settings.gameModeStyle;
        const allow = style === "sprint" ? true : !roomMeta.settings.sameResultLock;
        setAllowIdenticalPicks(allow);
      },
      () => {},
    );
  }, [roomCode]);

  const fixtureMap = useMemo(() => {
    const m = new Map<number, Fixture>();
    (fixtures ?? []).forEach((f) => m.set(f.fixtureId, f));
    return m;
  }, [fixtures]);

  const picksByFixture = useMemo(() => {
    const m = new Map<number, PickDoc[]>();
    for (const p of allPicks) {
      if (!m.has(p.fixtureId)) m.set(p.fixtureId, []);
      m.get(p.fixtureId)?.push(p);
    }
    return m;
  }, [allPicks]);

  const playersCount = game?.players?.length ?? 0;
  const lockedCount = useMemo(
    () => Object.values(powerupsByUid).filter((p) => p.locked).length,
    [powerupsByUid],
  );
  const lockedProgressPct =
    playersCount > 0 ? Math.round((lockedCount / playersCount) * 100) : 0;

  const myPowerup = user ? powerupsByUid[user.uid] : undefined;
  const myPowerupLocked = !!myPowerup?.locked;
  const myPowerupLabel =
    myPowerup?.powerupType === "ALL_IN"
      ? "All-In"
      : "Safety Net";
  const myPowerupTheme =
    myPowerup?.powerupType === "ALL_IN"
      ? {
          border: "border-red-400/75",
          bg: "bg-[linear-gradient(180deg,rgba(239,68,68,0.14)_0%,rgba(239,68,68,0.05)_100%)]",
          shadow: "shadow-[0_10px_24px_rgba(239,68,68,0.16)]",
          pill: "border-red-300/75 bg-red-400/20",
          pick: "border-red-300/70 bg-[linear-gradient(135deg,rgba(239,68,68,0.18)_0%,rgba(45,212,191,0.14)_100%)]",
          progress: "border-red-300/60",
          bar: "bg-[linear-gradient(90deg,rgba(239,68,68,0.95)_0%,rgba(45,212,191,0.9)_100%)]",
        }
      : myPowerup?.powerupType === "SAFETY_NET"
        ? {
            border: "border-blue-400/75",
            bg: "bg-[linear-gradient(180deg,rgba(59,130,246,0.14)_0%,rgba(59,130,246,0.05)_100%)]",
            shadow: "shadow-[0_10px_24px_rgba(59,130,246,0.16)]",
            pill: "border-blue-300/75 bg-blue-400/20",
            pick: "border-blue-300/70 bg-[linear-gradient(135deg,rgba(59,130,246,0.18)_0%,rgba(45,212,191,0.14)_100%)]",
            progress: "border-blue-300/60",
            bar: "bg-[linear-gradient(90deg,rgba(59,130,246,0.95)_0%,rgba(45,212,191,0.9)_100%)]",
          }
        : {
            border: "border-blue-400/75",
            bg: "bg-[linear-gradient(180deg,rgba(59,130,246,0.14)_0%,rgba(59,130,246,0.05)_100%)]",
            shadow: "shadow-[0_10px_24px_rgba(59,130,246,0.16)]",
            pill: "border-blue-300/75 bg-blue-400/20",
            pick: "border-blue-300/70 bg-[linear-gradient(135deg,rgba(59,130,246,0.18)_0%,rgba(45,212,191,0.14)_100%)]",
            progress: "border-blue-300/60",
          bar: "bg-[linear-gradient(90deg,rgba(59,130,246,0.95)_0%,rgba(45,212,191,0.9)_100%)]",
        };
  const roomLockTheme =
    selectedPowerupType === "ALL_IN"
      ? {
          box: "border-red-300/65 bg-[linear-gradient(180deg,rgba(248,113,113,0.2)_0%,rgba(239,68,68,0.07)_100%)]",
          pill: "border-red-300/70 bg-red-500/15",
          pct: "text-red-200",
          progress: "border-red-300/60",
          bar: "bg-[linear-gradient(90deg,rgba(248,113,113,0.65),rgba(239,68,68,0.98))] shadow-[0_0_12px_rgba(239,68,68,0.35)]",
        }
      : {
          box: "border-blue-300/65 bg-[linear-gradient(180deg,rgba(96,165,250,0.2)_0%,rgba(59,130,246,0.07)_100%)]",
          pill: "border-blue-300/70 bg-blue-500/15",
          pct: "text-blue-200",
          progress: "border-blue-300/60",
          bar: "bg-[linear-gradient(90deg,rgba(96,165,250,0.65),rgba(59,130,246,0.98))] shadow-[0_0_12px_rgba(59,130,246,0.35)]",
        };
  const myGoldenFixtureId = user ? goldensByUid[user.uid]?.fixtureId ?? null : null;

  useEffect(() => {
    setSelectedFixtureId((prev) => {
      if (prev != null && prev !== myGoldenFixtureId && myPicksByFixture[prev]) return prev;
      const next = Object.keys(myPicksByFixture)
        .map((v) => Number(v))
        .find((fid) => Number.isFinite(fid) && fid !== myGoldenFixtureId);
      return typeof next === "number" ? next : null;
    });
  }, [myGoldenFixtureId, myPicksByFixture]);

  async function lockPowerup() {
    if (!user || gw == null || selectedFixtureId == null) return;
    if (!myPicksByFixture[selectedFixtureId]) {
      setError("You can only place a power-up on your own pick.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/game/powerup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          gw,
          uid: user.uid,
          fixtureId: selectedFixtureId,
          powerupType: selectedPowerupType,
          seasonKey,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to lock power-up.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to lock power-up.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) return null;
  if (gw == null || fixtures == null || !game) {
    return (
      <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">
        <div className="text-sm text-muted inline-flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          <span>Loading power-ups…</span>
        </div>
      </div>
    );
  }

  if (String(game.state).toUpperCase() !== "POWERUPS") {
    return (
      <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">
        <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 border border-teal-500">
          <div className="text-lg font-semibold text-foreground">Not in Power-Ups phase</div>
          <div className="text-sm text-muted mt-1">Current state: {game.state}</div>
        </div>
      </div>
    );
  }

  const orderedFixtureIds = game.fixtureIds?.length ? game.fixtureIds : fixtures.map((f) => f.fixtureId);
  return (
    <div className="min-h-0 px-2 pb-2 pt-0 sm:p-6 bg-app">
      <div className="w-full max-w-[1400px] mx-auto bg-surface rounded-2xl shadow-card page-shell-enter p-6 space-y-4 border border-subtle shadow-[0_10px_28px_rgba(var(--room-accent-rgb),0.1)]">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Power-Ups</h1>
          <div className="font-display text-sm text-muted">
            {roomCode} • GW {gw}
          </div>
        </div>

        {error && (
          <div className="rounded-xl p-3 bg-surface-2 border border-teal-500 text-danger">
            {error}
          </div>
        )}

        {myPowerupLocked ? (
          <div
            className={[
              "rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none p-4",
              "border",
              myPowerupTheme.border,
              myPowerupTheme.bg,
              myPowerupTheme.shadow,
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-foreground">Locked In</div>
                <div className="text-xs text-muted mt-0.5">Your power-up is saved.</div>
              </div>
              <span
                className={[
                  "font-display rounded-full border px-2.5 py-1 text-xs font-semibold text-foreground",
                  myPowerupTheme.pill,
                ].join(" ")}
              >
                {myPowerupLabel}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-2">
              <div className="rounded-lg border border-subtle bg-surface/80 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">Fixture</div>
                {(() => {
                  const lockedFixture = fixtureMap.get(myPowerup.fixtureId);
                  if (!lockedFixture) {
                    return (
                      <div className="font-display text-sm font-semibold text-foreground">
                        #{myPowerup.fixtureId}
                      </div>
                    );
                  }
                  return (
                    <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                      <div className="font-display text-xs font-semibold text-foreground truncate text-left">
                        {lockedFixture.home.tla || lockedFixture.home.shortName || lockedFixture.home.name}
                      </div>
                      <span className="font-display text-[10px] uppercase text-muted">vs</span>
                      <div className="font-display text-xs font-semibold text-foreground truncate text-right">
                        {lockedFixture.away.tla || lockedFixture.away.shortName || lockedFixture.away.name}
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className={["rounded-lg border px-3 py-2 text-center", myPowerupTheme.pick].join(" ")}>
                <div className="text-[11px] uppercase tracking-wide text-muted">Pick</div>
                <div className="font-display text-base font-semibold text-foreground tabular-nums">
                  {String(myPicksByFixture[myPowerup.fixtureId] || "—").replace("-", " - ")}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
                <span>Lobby lock progress</span>
                <span className="font-display text-foreground">
                  {lockedCount}/{playersCount || 0}
                </span>
              </div>
              <div className={["w-full h-2 rounded-full bg-surface border overflow-hidden", myPowerupTheme.progress].join(" ")}>
                <div
                  className={["h-full transition-all duration-500", myPowerupTheme.bar].join(" ")}
                  style={{
                    width: playersCount > 0 ? `${Math.round((lockedCount / playersCount) * 100)}%` : "0%",
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted mt-2 inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Waiting for others to lock in…</span>
            </div>
          </div>
        ) : (
          <>
            <div className="border border-teal-500 rounded-xl p-4 bg-surface-2 space-y-1">
              <div className="font-semibold text-foreground">Select Power-Up</div>
              <div className="grid grid-cols-1 min-[520px]:grid-cols-3 gap-2">
                {POWERUP_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => setSelectedPowerupType(opt.type)}
                    className={[
                      "rounded-lg border px-3 py-2 text-sm font-display text-left transition-all",
                      opt.className,
                      selectedPowerupType === opt.type
                        ? "scale-[1.02] ring-2 ring-[color:rgba(var(--room-accent-rgb),0.85)] shadow-[0_0_0_1px_rgba(var(--room-accent-rgb),0.28)_inset,0_10px_22px_rgba(var(--room-accent-rgb),0.16)]"
                        : "opacity-85 hover:opacity-100",
                    ].join(" ")}
                  >
                    <div className="inline-flex items-center gap-2 font-semibold text-foreground">
                      <Image
                        src={opt.icon}
                        alt=""
                        aria-hidden
                        width={16}
                        height={16}
                        className="h-4 w-4 shrink-0"
                      />
                      <span>{opt.label}</span>
                    </div>
                    <div className="text-xs text-muted">{opt.help}</div>
                  </button>
                ))}
              </div>
              <div className="text-sm text-muted">
                Choose one fixture (Golden fixture blocked).
              </div>
            </div>

            <SpecialBreak className="mb-3" />
            <div className="grid items-start gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {orderedFixtureIds.map((fid) => {
                const f = fixtureMap.get(fid);
                const myScore = myPicksByFixture[fid];
                const others = (picksByFixture.get(fid) ?? [])
                  .filter((p) => p.uid !== user.uid)
                  .map((p) => p.score);
                const isSelected = selectedFixtureId === fid;
                const isGoldenFixture = myGoldenFixtureId != null && fid === myGoldenFixtureId;
                const pickToneClass =
                  selectedPowerupType === "ALL_IN"
                    ? "border-red-400/75 bg-red-500/10 shadow-[0_0_0_1px_rgba(248,113,113,0.2)_inset]"
                    : "border-blue-400/75 bg-blue-500/10 shadow-[0_0_0_1px_rgba(96,165,250,0.2)_inset]";
                const selectedFixtureToneClass =
                  selectedPowerupType === "ALL_IN"
                    ? "border-red-400/90 bg-[rgba(239,68,68,0.08)] shadow-[0_8px_18px_rgba(239,68,68,0.18),inset_0_0_0_1px_rgba(248,113,113,0.22)]"
                    : "border-blue-400/90 bg-[rgba(59,130,246,0.08)] shadow-[0_8px_18px_rgba(59,130,246,0.18),inset_0_0_0_1px_rgba(96,165,250,0.22)]";
                const homeColor = colorForTeam(f?.home.tla, f?.home.shortName, f?.home.name);
                const awayColor = colorForTeam(f?.away.tla, f?.away.shortName, f?.away.name);
                const clashBgStyle: React.CSSProperties = {
                  backgroundImage: `linear-gradient(120deg, ${hexToRgba(homeColor, isSelected ? 0.3 : 0.2)} 0%, rgba(9,12,22,0.92) 42%, rgba(9,12,22,0.92) 58%, ${hexToRgba(awayColor, isSelected ? 0.3 : 0.2)} 100%)`,
                };

                return (
                  <div key={fid} className="fixture-card-enter space-y-2 w-full">
                    <button
                      type="button"
                      onClick={() => setSelectedFixtureId(fid)}
                      disabled={!myScore || isGoldenFixture}
                      className={[
                        "fixture-clash-bg no-3d w-full text-left rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none border p-[clamp(0.75rem,1.1vw,1.25rem)] transition-all duration-200 page-action-btn",
                        isSelected
                          ? `scale-[1.02] origin-center ${selectedFixtureToneClass}`
                          : isGoldenFixture
                            ? "border-yellow-300/70 bg-[linear-gradient(135deg,rgba(250,204,21,0.16)_0%,rgba(250,204,21,0.05)_100%)]"
                          : "border-white/15",
                        !myScore || isGoldenFixture
                          ? "opacity-60 cursor-not-allowed"
                          : "",
                      ].join(" ")}
                      style={isGoldenFixture ? undefined : clashBgStyle}
                    >
                      {f ? (
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
                              showFullName={false}
                              wrapperClassName="mt-1 flex w-[78px] flex-col items-center gap-1 text-center"
                              abbrClassName="font-display w-full text-[10px] sm:text-[11px] text-foreground uppercase tracking-wide text-center"
                              fullNameWindowPx={68}
                            />
                          </div>
                          <span className="font-display text-[10px] sm:text-[11px] font-semibold text-muted uppercase inline-flex items-center justify-center">
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
                              showFullName={false}
                              wrapperClassName="mt-1 flex w-[78px] flex-col items-center gap-1 text-center"
                              abbrClassName="font-display w-full text-[10px] sm:text-[11px] text-foreground uppercase tracking-wide text-center"
                              fullNameWindowPx={68}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="font-semibold text-foreground">Fixture {fid}</div>
                      )}
                      <div
                        className={[
                          "mt-2 rounded-lg border px-3 py-2 text-center",
                          isGoldenFixture ? "border-yellow-300/75 bg-yellow-400/10" : pickToneClass,
                        ].join(" ")}
                      >
                        {isGoldenFixture ? (
                          <div className="h-[46px] flex items-center justify-center">
                            <span className="font-display inline-flex items-center rounded-full border border-yellow-300/75 bg-yellow-400/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground">
                              Golden Locked
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="text-xs text-muted">Your pick</div>
                            <div className="font-display text-lg font-semibold text-foreground tabular-nums">
                              {myScore ? myScore.replace("-", " - ") : "—"}
                            </div>
                          </>
                        )}
                      </div>
                      {!allowIdenticalPicks && others.length > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                          {others.slice(0, 8).map((score, index) => (
                            <span
                              key={`${fid}-${index}-${score}`}
                              className="font-display rounded-full border border-subtle px-2 py-1 text-xs text-muted tabular-nums whitespace-nowrap"
                            >
                              {String(score).replace("-", " - ")}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {!myScore && (
                        <div className="mt-2 text-xs text-danger">
                          You didn’t pick this fixture (can’t apply power-up).
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <SpecialBreak className="my-3" />
            <div className={["w-full rounded-xl border px-3 py-2.5", roomLockTheme.box].join(" ")}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={["font-display inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-foreground", roomLockTheme.pill].join(" ")}>
                  Room Lock-In
                </span>
                <span className={["font-display text-xs font-semibold tabular-nums", roomLockTheme.pct].join(" ")}>
                  {lockedProgressPct}%
                </span>
              </div>
              <div className={["h-2.5 w-full overflow-hidden rounded-full border bg-surface/80", roomLockTheme.progress].join(" ")}>
                <div
                  className={["h-full rounded-full transition-all duration-500", roomLockTheme.bar].join(" ")}
                  style={{ width: `${lockedProgressPct}%` }}
                />
              </div>
              <div className="mt-1.5 text-[11px] text-muted">
                <span className="font-display text-foreground">{lockedCount}</span>
                <span> of </span>
                <span className="font-display text-foreground">{playersCount || 0}</span>
                <span> players locked</span>
              </div>
            </div>

            <button
              onClick={lockPowerup}
              disabled={
                submitting ||
                selectedFixtureId == null ||
                !myPicksByFixture[selectedFixtureId] ||
                (myGoldenFixtureId != null && selectedFixtureId === myGoldenFixtureId)
              }
              className={[
                `w-full rounded-xl py-5 text-lg font-semibold border disabled:opacity-60 ${BTN_3D}`,
                selectedPowerupType === "ALL_IN"
                  ? "border-red-300/75 bg-[linear-gradient(180deg,rgba(248,113,113,0.22)_0%,rgba(239,68,68,0.08)_100%)] text-foreground shadow-[0_10px_24px_rgba(239,68,68,0.22)] hover:bg-[linear-gradient(180deg,rgba(248,113,113,0.28)_0%,rgba(239,68,68,0.12)_100%)]"
                  : "border-blue-300/75 bg-[linear-gradient(180deg,rgba(96,165,250,0.22)_0%,rgba(59,130,246,0.08)_100%)] text-foreground shadow-[0_10px_24px_rgba(59,130,246,0.22)] hover:bg-[linear-gradient(180deg,rgba(96,165,250,0.28)_0%,rgba(59,130,246,0.12)_100%)]",
              ].join(" ")}
            >
              {submitting ? "Locking…" : "Lock-In"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
