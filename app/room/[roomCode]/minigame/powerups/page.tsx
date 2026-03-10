"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../../../../components/AuthProvider";
import PageShell from "../../../../../components/PageShell";
import SectionCard from "../../../../../components/SectionCard";
import SectionStack from "../../../../../components/SectionStack";
import TeamBadge from "../../../../../components/TeamBadge";
import TeamLabel from "../../../../../components/TeamLabel";
import TopActionRow from "../../../../../components/TopActionRow";
import {
  getRoomBootstrapCached,
  patchRoomBootstrapCached,
} from "@/lib/roomBootstrapClient";
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

type GameDoc = {
  state: "LOBBY" | "DRAFT" | "GOLDEN" | "POWERUPS" | "REVEAL";
  players: string[];
  fixtureIds: number[];
  powerupsEnabled?: boolean;
};

type Fixture = {
  fixtureId: number;
  kickoff: string;
  home: {
    name: string;
    tla?: string | null;
    shortName?: string;
    badge?: string | null;
  };
  away: {
    name: string;
    tla?: string | null;
    shortName?: string;
    badge?: string | null;
  };
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

const DESK_SHELL =
  "rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.012))] p-1 shadow-[0_22px_48px_rgba(4,10,22,0.18)]";
const DESK_INNER =
  "rounded-[26px] border border-white/6 bg-[linear-gradient(180deg,rgba(6,10,18,0.97),rgba(8,13,22,0.94))] px-4 py-4 sm:px-5 sm:py-5";
const PANEL_SHELL =
  "rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.026),rgba(255,255,255,0.012))] p-1 shadow-[0_18px_38px_rgba(4,10,22,0.14)]";
const PANEL_INNER =
  "rounded-[22px] border border-white/6 bg-[linear-gradient(180deg,rgba(6,10,18,0.96),rgba(7,11,20,0.93))] px-4 py-4 sm:px-5 sm:py-5";
const MINI_LABEL =
  "font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/40";
const HEADER_STATUS_CARD =
  "min-w-[1px] rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,22,38,0.98),rgba(8,14,28,0.96))] px-4 py-3 text-right shadow-[0_16px_32px_rgba(4,8,16,0.32)]";
const ACTION_BTN_BASE =
  "w-full rounded-2xl border px-4 py-3 font-display text-sm font-semibold uppercase tracking-[0.14em] text-foreground shadow-[0_16px_30px_rgba(6,12,24,0.2)] transition disabled:opacity-60 disabled:cursor-not-allowed";
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

function colorForTeam(
  tla?: string | null,
  shortName?: string | null,
  name?: string | null,
) {
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
    help: "Exact score = 6, else 0.",
  },
  {
    type: "SAFETY_NET" as const,
    label: "Safety Net",
    help: "If 0 points, becomes 1.",
  },
];

export default function PowerupsPage() {
  const params = useParams<{ roomCode: string }>();
  const searchParams = useSearchParams();
  const roomCode = useMemo(
    () => String(params.roomCode).toUpperCase(),
    [params.roomCode],
  );
  const router = useRouter();
  const { user, loading } = useAuth();
  const devPreview =
    process.env.NODE_ENV !== "production" &&
    searchParams.get("devPreview") === "1";
  const previewLocked = devPreview && searchParams.get("locked") === "1";
  const previewPowerupType = (() => {
    const raw = String(searchParams.get("powerup") || "")
      .trim()
      .toUpperCase();
    return raw === "ALL_IN" ? "ALL_IN" : "SAFETY_NET";
  })() as PowerupDoc["powerupType"];

  const [gw, setGw] = useState<number | null>(null);
  const [seasonKey, setSeasonKey] = useState<string | null>(null);
  const [game, setGame] = useState<GameDoc | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [allPicks, setAllPicks] = useState<PickDoc[]>([]);
  const [myPicksByFixture, setMyPicksByFixture] = useState<
    Record<number, string>
  >({});
  const [powerupsByUid, setPowerupsByUid] = useState<
    Record<string, PowerupDoc>
  >({});
  const [goldensByUid, setGoldensByUid] = useState<Record<string, GoldenDoc>>(
    {},
  );
  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(
    null,
  );
  const [selectedPowerupType, setSelectedPowerupType] =
    useState<PowerupDoc["powerupType"]>("SAFETY_NET");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compactOtherPicks, setCompactOtherPicks] = useState(true);
  const [allowIdenticalPicks, setAllowIdenticalPicks] = useState(false);

  const routedRef = useRef(false);
  const previewPlayerIds = useMemo(() => {
    const base = user?.uid ? [user.uid] : [];
    return [...base, "preview-rival-a", "preview-rival-b"].slice(0, 3);
  }, [user?.uid]);

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
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("powerupsCompactOtherPicks");
    setCompactOtherPicks(raw !== "0");
  }, []);

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
        const st = String(gameData?.state || "")
          .trim()
          .toUpperCase();
        if (st) patchRoomBootstrapCached(roomCode, { gameState: st });
        if (devPreview) return;
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
        const allow =
          style === "sprint" ? true : !roomMeta.settings.sameResultLock;
        setAllowIdenticalPicks(allow);
      },
      () => {},
    );
  }, [roomCode]);

  useEffect(() => {
    if (!devPreview) return;
    setSelectedPowerupType(previewPowerupType);
  }, [devPreview, previewPowerupType]);

  const previewGame = useMemo<GameDoc | null>(() => {
    if (!devPreview || !fixtures?.length || !previewPlayerIds.length)
      return null;
    const fixtureIds = fixtures
      .slice(0, Math.min(10, fixtures.length))
      .map((fixture) => fixture.fixtureId);
    if (!fixtureIds.length) return null;
    return {
      state: "POWERUPS",
      players: previewPlayerIds,
      fixtureIds,
      powerupsEnabled: true,
    };
  }, [devPreview, fixtures, previewPlayerIds]);

  const previewGoldenFixtureId = previewGame?.fixtureIds?.[0] ?? null;
  const previewEligibleFixtureId =
    previewGame?.fixtureIds?.find((fid) => fid !== previewGoldenFixtureId) ??
    previewGame?.fixtureIds?.[0] ??
    null;

  const previewAllPicks = useMemo<PickDoc[]>(() => {
    if (!previewGame) return [];
    const targets = previewGame.fixtureIds.slice(
      0,
      Math.min(3, previewGame.fixtureIds.length),
    );
    const samples = ["2-1", "1-1", "3-2"];
    return previewGame.players.flatMap((uid, playerIdx) =>
      targets.map((fixtureId, fixtureIdx) => ({
        uid,
        fixtureId,
        score: samples[(playerIdx + fixtureIdx) % samples.length] || "1-0",
      })),
    );
  }, [previewGame]);

  const previewMyPicksByFixture = useMemo<Record<number, string>>(() => {
    if (!previewGame || !previewPlayerIds[0]) return {};
    const mine: Record<number, string> = {};
    for (const pick of previewAllPicks) {
      if (pick.uid === previewPlayerIds[0]) mine[pick.fixtureId] = pick.score;
    }
    return mine;
  }, [previewAllPicks, previewGame, previewPlayerIds]);

  const previewGoldensByUid = useMemo<Record<string, GoldenDoc>>(() => {
    if (!previewGame || previewGoldenFixtureId == null) return {};
    const map: Record<string, GoldenDoc> = {};
    for (const [idx, uid] of previewGame.players.entries()) {
      map[uid] = {
        uid,
        fixtureId:
          previewGame.fixtureIds[idx % previewGame.fixtureIds.length] ??
          previewGoldenFixtureId,
        score: idx === 0 ? "2-1" : idx === 1 ? "1-1" : "3-2",
        locked: true,
      };
    }
    return map;
  }, [previewGame, previewGoldenFixtureId]);

  const previewPowerupsByUid = useMemo<Record<string, PowerupDoc>>(() => {
    if (
      !previewGame ||
      !previewLocked ||
      previewEligibleFixtureId == null ||
      !previewPlayerIds[0]
    ) {
      return {};
    }
    return {
      [previewPlayerIds[0]]: {
        uid: previewPlayerIds[0],
        fixtureId: previewEligibleFixtureId,
        powerupType: previewPowerupType,
        locked: true,
      },
    };
  }, [
    previewEligibleFixtureId,
    previewGame,
    previewLocked,
    previewPlayerIds,
    previewPowerupType,
  ]);

  const previewGameActive =
    devPreview &&
    !!previewGame &&
    (!game || String(game.state).toUpperCase() !== "POWERUPS");
  const activeGame = previewGameActive ? previewGame : game;
  const activeAllPicks = previewGameActive ? previewAllPicks : allPicks;
  const activeMyPicksByFixture = previewGameActive
    ? previewMyPicksByFixture
    : myPicksByFixture;
  const activePowerupsByUid = previewGameActive
    ? previewPowerupsByUid
    : powerupsByUid;
  const activeGoldensByUid = previewGameActive
    ? previewGoldensByUid
    : goldensByUid;

  const fixtureMap = useMemo(() => {
    const m = new Map<number, Fixture>();
    (fixtures ?? []).forEach((f) => m.set(f.fixtureId, f));
    return m;
  }, [fixtures]);

  const picksByFixture = useMemo(() => {
    const m = new Map<number, PickDoc[]>();
    for (const p of activeAllPicks) {
      if (!m.has(p.fixtureId)) m.set(p.fixtureId, []);
      m.get(p.fixtureId)?.push(p);
    }
    return m;
  }, [activeAllPicks]);

  const playersCount = activeGame?.players?.length ?? 0;
  const lockedCount = useMemo(
    () => Object.values(activePowerupsByUid).filter((p) => p.locked).length,
    [activePowerupsByUid],
  );

  const myPowerup = user ? activePowerupsByUid[user.uid] : undefined;
  const myPowerupLocked = !!myPowerup?.locked;
  const myPowerupLabel =
    myPowerup?.powerupType === "ALL_IN" ? "All-In" : "Safety Net";
  const myGoldenFixtureId = user
    ? (activeGoldensByUid[user.uid]?.fixtureId ?? null)
    : null;
  const lockedPowerupFixture = fixtureMap.get(myPowerup?.fixtureId ?? -1);
  const lockedHomeColor = colorForTeam(
    lockedPowerupFixture?.home.tla,
    lockedPowerupFixture?.home.shortName,
    lockedPowerupFixture?.home.name,
  );
  const lockedAwayColor = colorForTeam(
    lockedPowerupFixture?.away.tla,
    lockedPowerupFixture?.away.shortName,
    lockedPowerupFixture?.away.name,
  );
  const lockedTone =
    myPowerup?.powerupType === "ALL_IN"
      ? {
          shell: "border-amber-300/18",
          overlay:
            "bg-[linear-gradient(128deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_34%,rgba(255,255,255,0)_62%,rgba(251,191,36,0.05)_100%)]",
          rail: "bg-[linear-gradient(180deg,rgba(251,191,36,0.95),rgba(245,158,11,0.42))]",
          pill: "border-amber-300/35 bg-[rgba(58,42,16,0.74)] text-amber-100/90",
          pick: "border-amber-300/35 bg-[linear-gradient(135deg,rgba(251,191,36,0.1),rgba(180,83,9,0.06))]",
        }
      : {
          shell: "border-sky-300/18",
          overlay:
            "bg-[linear-gradient(128deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_34%,rgba(255,255,255,0)_62%,rgba(96,165,250,0.06)_100%)]",
          rail: "bg-[linear-gradient(180deg,rgba(125,211,252,0.95),rgba(59,130,246,0.42))]",
          pill: "border-sky-300/35 bg-[rgba(16,40,58,0.72)] text-sky-100/90",
          pick: "border-sky-300/35 bg-[linear-gradient(135deg,rgba(125,211,252,0.1),rgba(3,105,161,0.06))]",
        };

  useEffect(() => {
    setSelectedFixtureId((prev) => {
      if (
        prev != null &&
        prev !== myGoldenFixtureId &&
        activeMyPicksByFixture[prev]
      )
        return prev;
      const next = Object.keys(activeMyPicksByFixture)
        .map((v) => Number(v))
        .find((fid) => Number.isFinite(fid) && fid !== myGoldenFixtureId);
      return typeof next === "number" ? next : null;
    });
  }, [activeMyPicksByFixture, myGoldenFixtureId]);

  function toggleCompactOtherPicks() {
    setCompactOtherPicks((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "powerupsCompactOtherPicks",
          next ? "1" : "0",
        );
      }
      return next;
    });
  }

  async function lockPowerup() {
    if (!user || gw == null || selectedFixtureId == null) return;
    if (previewGameActive) {
      setError("Preview mode only.");
      return;
    }
    if (!activeMyPicksByFixture[selectedFixtureId]) {
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
  if (gw == null || fixtures == null || !activeGame) {
    return (
      <PageShell
        width="wide"
        shellChrome={false}
        outerClassName="min-h-0 px-2 pb-0 pt-0 bg-app sm:px-3 sm:pb-0 sm:pt-0"
        contentClassName="relative z-[1]"
      >
        <SectionStack gap="page">
          <SectionCard className={PANEL_SHELL}>
            <div className="text-sm text-muted inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Loading power-ups…</span>
            </div>
          </SectionCard>
        </SectionStack>
      </PageShell>
    );
  }

  if (String(activeGame.state).toUpperCase() !== "POWERUPS") {
    return (
      <PageShell
        width="wide"
        shellChrome={false}
        outerClassName="min-h-0 px-2 pb-0 pt-0 bg-app sm:px-3 sm:pb-0 sm:pt-0"
        contentClassName="relative z-[1]"
      >
        <SectionStack gap="page">
          <SectionCard className={PANEL_SHELL}>
            <div className="text-lg font-semibold text-foreground">
              Not in Power-Ups phase
            </div>
            <div className="text-sm text-muted mt-1">
              Current state: {activeGame.state}
            </div>
          </SectionCard>
        </SectionStack>
      </PageShell>
    );
  }

  const orderedFixtureIds = activeGame.fixtureIds?.length
    ? activeGame.fixtureIds
    : fixtures.map((f) => f.fixtureId);
  const selectedFixture =
    selectedFixtureId != null ? fixtureMap.get(selectedFixtureId) : null;
  const selectedFixtureScore =
    selectedFixtureId != null
      ? activeMyPicksByFixture[selectedFixtureId]
      : null;
  return (
    <PageShell
      width="wide"
      shellChrome={false}
      outerClassName="min-h-0 px-2 pb-0 pt-0 bg-app sm:px-3 sm:pb-0 sm:pt-0"
      contentClassName="relative z-[1]"
    >
      <SectionStack gap="page">
        <TopActionRow
            title="Power-Ups"
            subtitle={`${roomCode} • GW ${gw}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"
            frameActions={false}
            actions={
              <div className={HEADER_STATUS_CARD}>
                <div className={MINI_LABEL}>Locked</div>
                <div className="mt-1 font-display text-[1.55rem] font-semibold leading-none text-foreground tabular-nums">
                  {lockedCount}
                  <span className="ml-1 text-[0.9rem] font-medium text-muted">
                    of {playersCount || 0}
                  </span>
                </div>
              </div>
            }
          />

        {error && (
          <SectionCard className="rounded-[22px] border border-rose-400/35 bg-[linear-gradient(180deg,rgba(127,29,29,0.18),rgba(127,29,29,0.08))] p-4 sm:p-4">
            <div className="text-sm text-rose-100">{error}</div>
          </SectionCard>
        )}

        {myPowerupLocked ? (
          <SectionCard className={PANEL_SHELL}>
            <div className={PANEL_INNER}>
              <div className={MINI_LABEL}>Power-up lock</div>

              <div
                className="mt-4 rounded-[20px] border border-white/10 p-[clamp(0.75rem,1vw,1rem)] fixture-clash-bg bg-[linear-gradient(120deg,var(--locked-home,rgba(11,22,42,0.9))_0%,rgba(9,12,22,0.92)_42%,rgba(9,12,22,0.92)_58%,var(--locked-away,rgba(11,22,42,0.9))_100%)] shadow-[0_16px_30px_rgba(4,10,22,0.2)]"
                style={
                  {
                    "--locked-home": hexToRgba(lockedHomeColor, 0.26),
                    "--locked-away": hexToRgba(lockedAwayColor, 0.26),
                  } as React.CSSProperties
                }
              >
                <div
                  className={[
                    "relative rounded-[16px] border bg-[linear-gradient(180deg,rgba(6,10,18,0.95),rgba(8,12,20,0.93))] px-3 py-3",
                    lockedTone.shell,
                  ].join(" ")}
                >
                  <span
                    className={[
                      "pointer-events-none absolute inset-0 rounded-[16px]",
                      lockedTone.overlay,
                    ].join(" ")}
                  />
                  <span
                    className={[
                      "absolute inset-y-3 left-0 w-[3px] rounded-r-full",
                      lockedTone.rail,
                    ].join(" ")}
                  />
                  <div className="relative z-[1]">
                    <div className="mb-2 flex justify-center sm:justify-end">
                      <span
                        className={[
                          "inline-flex rounded-full border px-2 py-0.5 font-display text-[0.55rem] uppercase tracking-[0.15em]",
                          lockedTone.pill,
                        ].join(" ")}
                      >
                        {myPowerupLabel} locked
                      </span>
                    </div>
                    {lockedPowerupFixture ? (
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                        <div className="flex flex-col items-center text-center min-w-0">
                          <TeamBadge
                            name={lockedPowerupFixture.home.name}
                            tla={lockedPowerupFixture.home.tla}
                            shortName={lockedPowerupFixture.home.shortName}
                            badge={lockedPowerupFixture.home.badge}
                          />
                          <TeamLabel
                            name={lockedPowerupFixture.home.name}
                            tla={lockedPowerupFixture.home.tla}
                            shortName={lockedPowerupFixture.home.shortName}
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
                            name={lockedPowerupFixture.away.name}
                            tla={lockedPowerupFixture.away.tla}
                            shortName={lockedPowerupFixture.away.shortName}
                            badge={lockedPowerupFixture.away.badge}
                          />
                          <TeamLabel
                            name={lockedPowerupFixture.away.name}
                            tla={lockedPowerupFixture.away.tla}
                            shortName={lockedPowerupFixture.away.shortName}
                            showFullName={false}
                            wrapperClassName="mt-1 flex w-[78px] flex-col items-center gap-1 text-center"
                            abbrClassName="font-display w-full text-[10px] sm:text-[11px] text-foreground uppercase tracking-wide text-center"
                            fullNameWindowPx={68}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-center font-display text-sm font-semibold text-foreground">
                        Fixture #{myPowerup?.fixtureId}
                      </div>
                    )}

                    <div
                      className={[
                        "mt-2 flex items-center justify-center rounded-xl border px-3 py-2",
                        lockedTone.pick,
                      ].join(" ")}
                    >
                      <span className="font-display text-xl font-semibold text-foreground tabular-nums">
                        {String(
                          activeMyPicksByFixture[myPowerup?.fixtureId ?? -1] ||
                            "—",
                        ).replace("-", " - ")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.008))] px-3 py-2.5">
                <div className="inline-flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Waiting for others to lock in…</span>
                </div>
              </div>
            </div>
          </SectionCard>
        ) : (
          <>
            <SectionCard className={DESK_SHELL}>
              <div className={DESK_INNER}>
                <div className="space-y-2">
                  <div className={MINI_LABEL}>Power-up desk</div>
                  <div className="font-display text-[clamp(1.5rem,4vw,2.6rem)] font-semibold tracking-tight text-foreground">
                    Power-up selection
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {POWERUP_OPTIONS.map((opt) => {
                    const tone =
                      opt.type === "ALL_IN"
                        ? {
                            idle: "border-amber-300/22 bg-[linear-gradient(180deg,rgba(250,204,21,0.06),rgba(250,204,21,0.015))] hover:border-amber-300/35",
                            active:
                              "scale-[1.01] border-amber-300/42 ring-1 ring-inset ring-amber-300/24 bg-[linear-gradient(160deg,rgba(255,255,255,0.07)_0%,rgba(251,191,36,0.08)_28%,rgba(10,14,24,0)_60%)] shadow-[0_14px_30px_rgba(64,35,10,0.24),0_0_0_1px_rgba(251,191,36,0.2),inset_0_1px_0_rgba(255,255,255,0.06)]",
                          }
                        : {
                            idle: "border-sky-300/22 bg-[linear-gradient(180deg,rgba(125,211,252,0.05),rgba(125,211,252,0.015))] hover:border-sky-300/35",
                            active:
                              "scale-[1.01] border-sky-300/42 ring-1 ring-inset ring-sky-300/24 bg-[linear-gradient(160deg,rgba(255,255,255,0.07)_0%,rgba(96,165,250,0.08)_28%,rgba(10,14,24,0)_60%)] shadow-[0_14px_30px_rgba(8,47,73,0.24),0_0_0_1px_rgba(96,165,250,0.2),inset_0_1px_0_rgba(255,255,255,0.06)]",
                          };
                    const isActive = selectedPowerupType === opt.type;
                    return (
                      <button
                        key={opt.type}
                        type="button"
                        onClick={() => setSelectedPowerupType(opt.type)}
                        className={[
                          "rounded-[22px] border px-4 py-3 text-left transition-all duration-200",
                          isActive ? tone.active : tone.idle,
                        ].join(" ")}
                      >
                        <div className={MINI_LABEL}>Chip</div>
                        <div className="mt-2 font-display text-xl font-semibold text-foreground">
                          {opt.label}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {opt.help}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </SectionCard>

            <SectionCard className={PANEL_SHELL}>
              <div className={PANEL_INNER}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className={MINI_LABEL}>Power-up draft board</div>
                    <div className="font-display text-lg font-semibold text-foreground">
                      Choose the fixture to upgrade
                    </div>
                    <div className="mt-2 text-sm text-muted">
                      Select one fixture you already predicted, then lock your
                      chip.
                    </div>
                  </div>
                  {!allowIdenticalPicks ? (
                    <button
                      type="button"
                      onClick={toggleCompactOtherPicks}
                      className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:border-white/18 hover:text-foreground"
                    >
                      {compactOtherPicks ? "Expand Others" : "Collapse Others"}
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 grid items-start gap-4 sm:gap-5 pt-2 grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {orderedFixtureIds.map((fid, idx) => {
                    const f = fixtureMap.get(fid);
                    const myScore = activeMyPicksByFixture[fid];
                    const others = (picksByFixture.get(fid) ?? [])
                      .filter((p) => p.uid !== user.uid)
                      .map((p) => p.score);
                    const isSelected = selectedFixtureId === fid;
                    const isGoldenFixture =
                      myGoldenFixtureId != null && fid === myGoldenFixtureId;
                    const selectedTone =
                      selectedPowerupType === "ALL_IN"
                        ? {
                            outer:
                              "z-20 overflow-visible border-amber-300/55 ring-1 ring-inset ring-amber-300/16 bg-[linear-gradient(160deg,rgba(255,255,255,0.07)_0%,rgba(251,191,36,0.08)_28%,rgba(10,14,24,0)_60%)] shadow-[0_16px_34px_rgba(64,35,10,0.32),0_0_0_1px_rgba(251,191,36,0.2),inset_0_1px_0_rgba(255,255,255,0.06)]",
                            inner:
                              "border-amber-300/20 ring-1 ring-inset ring-amber-300/12",
                            overlay:
                              "bg-[linear-gradient(128deg,rgba(255,255,255,0.1)_0%,rgba(255,255,255,0.02)_34%,rgba(255,255,255,0)_62%,rgba(251,191,36,0.06)_100%)]",
                            rail: "bg-[linear-gradient(180deg,rgba(251,191,36,0.95),rgba(245,158,11,0.42))]",
                            bottom:
                              "bg-[linear-gradient(90deg,rgba(255,255,255,0)_0%,rgba(251,191,36,0.24)_24%,rgba(251,191,36,0.24)_76%,rgba(255,255,255,0)_100%)]",
                            pill: "border-amber-300/35 bg-[rgba(58,42,16,0.74)] text-amber-100/90",
                          }
                        : {
                            outer:
                              "z-20 overflow-visible border-sky-300/55 ring-1 ring-inset ring-sky-300/16 bg-[linear-gradient(160deg,rgba(255,255,255,0.07)_0%,rgba(96,165,250,0.08)_28%,rgba(10,14,24,0)_60%)] shadow-[0_16px_34px_rgba(8,47,73,0.3),0_0_0_1px_rgba(96,165,250,0.18),inset_0_1px_0_rgba(255,255,255,0.06)]",
                            inner:
                              "border-sky-300/20 ring-1 ring-inset ring-sky-300/12",
                            overlay:
                              "bg-[linear-gradient(128deg,rgba(255,255,255,0.1)_0%,rgba(255,255,255,0.02)_34%,rgba(255,255,255,0)_62%,rgba(96,165,250,0.06)_100%)]",
                            rail: "bg-[linear-gradient(180deg,rgba(125,211,252,0.95),rgba(59,130,246,0.42))]",
                            bottom:
                              "bg-[linear-gradient(90deg,rgba(255,255,255,0)_0%,rgba(125,211,252,0.24)_24%,rgba(125,211,252,0.24)_76%,rgba(255,255,255,0)_100%)]",
                            pill: "border-sky-300/35 bg-[rgba(16,40,58,0.72)] text-sky-100/90",
                          };
                    const homeColor = colorForTeam(
                      f?.home.tla,
                      f?.home.shortName,
                      f?.home.name,
                    );
                    const awayColor = colorForTeam(
                      f?.away.tla,
                      f?.away.shortName,
                      f?.away.name,
                    );
                    const clashBgStyle: React.CSSProperties = {
                      backgroundImage: `linear-gradient(120deg, ${hexToRgba(homeColor, isSelected ? 0.32 : 0.22)} 0%, rgba(9,12,22,0.92) 42%, rgba(9,12,22,0.92) 58%, ${hexToRgba(awayColor, isSelected ? 0.32 : 0.22)} 100%)`,
                    };

                    return (
                      <div
                        key={fid}
                        className="fixture-card-enter [contain:none] space-y-2 w-full"
                        style={{
                          animationDelay: `${120 + Math.min(idx, 12) * 110}ms`,
                          animationDuration: "520ms",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedFixtureId(fid)}
                          disabled={!myScore || isGoldenFixture}
                          className={[
                            "fixture-clash-bg no-3d relative w-full text-left rounded-[20px] border p-[clamp(0.8rem,1.1vw,1.15rem)] transition-all duration-200 page-action-btn",
                            isSelected
                              ? selectedTone.outer
                              : isGoldenFixture
                                ? "overflow-hidden border-yellow-300/35 bg-[linear-gradient(135deg,rgba(250,204,21,0.12)_0%,rgba(250,204,21,0.03)_100%)]"
                                : "overflow-hidden border-white/12 opacity-[0.86] hover:opacity-100 hover:border-white/18",
                            !myScore || isGoldenFixture
                              ? "opacity-60 cursor-not-allowed"
                              : "",
                          ].join(" ")}
                          style={isGoldenFixture ? undefined : clashBgStyle}
                        >
                          <div
                            className={[
                              "relative z-[1] space-y-2.5 rounded-[16px] border bg-[linear-gradient(180deg,rgba(6,10,18,0.94),rgba(8,12,20,0.92))] px-2.5 py-2.5",
                              isSelected
                                ? selectedTone.inner
                                : "border-white/6",
                            ].join(" ")}
                          >
                            {isSelected ? (
                              <>
                                <span
                                  className={[
                                    "pointer-events-none absolute inset-0 rounded-[16px]",
                                    selectedTone.overlay,
                                  ].join(" ")}
                                />
                                <span
                                  className={[
                                    "absolute inset-y-3 left-0 w-[3px] rounded-r-full",
                                    selectedTone.rail,
                                  ].join(" ")}
                                />
                                <span
                                  className={[
                                    "absolute left-4 right-4 bottom-0 h-px",
                                    selectedTone.bottom,
                                  ].join(" ")}
                                />
                              </>
                            ) : null}
                            {isSelected ? (
                              <div className="mb-1 flex justify-center sm:justify-end">
                                <span
                                  className={[
                                    "inline-flex rounded-full border px-2 py-0.5 font-display text-[0.55rem] uppercase tracking-[0.15em]",
                                    selectedTone.pill,
                                  ].join(" ")}
                                >
                                  Selected
                                </span>
                              </div>
                            ) : null}
                            <div>
                              {f ? (
                                <>
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
                                        showFullName={false}
                                        wrapperClassName="mt-1 flex w-[96px] xl:w-[110px] flex-col items-center gap-1 text-center"
                                        abbrClassName="font-display w-full text-[clamp(0.76rem,0.95vw,0.92rem)] font-semibold text-foreground uppercase tracking-wide text-center"
                                        fullNameWindowPx={88}
                                      />
                                    </div>
                                    <span className="font-display text-xs xl:text-sm font-semibold text-muted uppercase inline-flex items-center justify-center self-center h-full">
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
                                        wrapperClassName="mt-1 flex w-[96px] xl:w-[110px] flex-col items-center gap-1 text-center"
                                        abbrClassName="font-display w-full text-[clamp(0.76rem,0.95vw,0.92rem)] font-semibold text-foreground uppercase tracking-wide text-center"
                                        fullNameWindowPx={88}
                                      />
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <div className="font-semibold text-foreground">
                                  Fixture {fid}
                                </div>
                              )}
                            </div>

                            <div className="my-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.08),rgba(255,255,255,0))]" />
                            <div
                              className={[
                                "flex items-center justify-center gap-2 rounded-xl border px-3 py-2",
                                isGoldenFixture
                                  ? "border-yellow-300/75 bg-yellow-400/10"
                                  : "border-white/8 bg-black/20",
                              ].join(" ")}
                            >
                              {isGoldenFixture ? (
                                <span className="font-display inline-flex items-center rounded-full border border-yellow-300/75 bg-yellow-400/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground">
                                  Golden
                                </span>
                              ) : (
                                <span className="shrink-0 whitespace-nowrap font-display text-xl leading-none font-semibold tabular-nums text-foreground">
                                  {myScore ? myScore.replace("-", " - ") : "—"}
                                </span>
                              )}
                            </div>
                          </div>

                          {!allowIdenticalPicks && (
                            <div className="mt-0">
                              <div
                                className={[
                                  "text-[10px] uppercase tracking-[0.16em] text-muted/70 text-center transition-all duration-200 ease-out",
                                  compactOtherPicks
                                    ? "opacity-0 -translate-y-1 max-h-0 overflow-hidden"
                                    : "mt-2 opacity-100 translate-y-0 max-h-5",
                                ].join(" ")}
                              >
                                Other picks
                              </div>
                              <div
                                className={[
                                  "grid overflow-hidden transition-[grid-template-rows,opacity,transform,margin] duration-300 ease-out",
                                  compactOtherPicks
                                    ? "grid-rows-[0fr] opacity-0 -translate-y-1 mt-0 pointer-events-none"
                                    : "grid-rows-[1fr] opacity-100 translate-y-0 mt-1.5",
                                ].join(" ")}
                              >
                                <div className="min-h-0">
                                  {others.length === 0 ? (
                                    <div className="text-xs text-muted text-center">
                                      None
                                    </div>
                                  ) : (
                                    <div
                                      className={[
                                        "flex flex-wrap items-center justify-center gap-1.5 transition-all duration-300",
                                        compactOtherPicks
                                          ? "opacity-0 translate-y-1"
                                          : "opacity-100 translate-y-0",
                                      ].join(" ")}
                                    >
                                      {others
                                        .slice(0, 10)
                                        .map((score, index) => (
                                          <span
                                            key={`${fid}-${index}-${score}`}
                                            className="font-display rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-foreground tabular-nums whitespace-nowrap"
                                          >
                                            {String(score).replace("-", " - ")}
                                          </span>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                          {!myScore && (
                            <div className="mt-2 text-xs text-danger">
                              You didn’t pick this fixture (can’t apply
                              power-up).
                            </div>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </SectionCard>

            <SectionCard className={PANEL_SHELL}>
              <div className={PANEL_INNER}>
                <div className="grid gap-4">
                  <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.008))] px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className={MINI_LABEL}>Selection control</div>
                        <div className="font-display text-lg font-semibold text-foreground">
                          {selectedFixture
                            ? "Fixture selected"
                            : "Select a fixture"}
                        </div>
                        <div className="text-sm text-muted">
                          {selectedFixture && selectedFixtureScore
                            ? "Lock this fixture to promote the saved score below."
                            : "Pick one of your saved fixtures to continue."}
                        </div>
                      </div>
                    </div>

                    {selectedFixture ? (
                      <div className="mt-3 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.008))] px-3 py-3">
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <div className="flex flex-col items-center text-center min-w-0">
                            <TeamBadge
                              name={selectedFixture.home.name}
                              tla={selectedFixture.home.tla}
                              shortName={selectedFixture.home.shortName}
                              badge={selectedFixture.home.badge}
                            />
                            <div className="mt-1 font-display text-xs font-semibold uppercase tracking-wide text-foreground">
                              {selectedFixture.home.tla ||
                                selectedFixture.home.shortName ||
                                selectedFixture.home.name}
                            </div>
                          </div>
                          <span className="font-display text-[10px] sm:text-[11px] font-semibold text-muted uppercase inline-flex items-center justify-center">
                            vs
                          </span>
                          <div className="flex flex-col items-center text-center min-w-0">
                            <TeamBadge
                              name={selectedFixture.away.name}
                              tla={selectedFixture.away.tla}
                              shortName={selectedFixture.away.shortName}
                              badge={selectedFixture.away.badge}
                            />
                            <div className="mt-1 font-display text-xs font-semibold uppercase tracking-wide text-foreground">
                              {selectedFixture.away.tla ||
                                selectedFixture.away.shortName ||
                                selectedFixture.away.name}
                            </div>
                          </div>
                        </div>
                        {selectedFixtureScore ? (
                          <div
                            className={[
                              "mt-3 flex items-center justify-center rounded-xl border px-3 py-2",
                              selectedPowerupType === "ALL_IN"
                                ? "border-amber-300/35 bg-[linear-gradient(135deg,rgba(251,191,36,0.1),rgba(180,83,9,0.06))]"
                                : "border-sky-300/35 bg-[linear-gradient(135deg,rgba(125,211,252,0.11),rgba(3,105,161,0.06))]",
                            ].join(" ")}
                          >
                            <span className="font-display text-xl font-semibold text-foreground tabular-nums">
                              {selectedFixtureScore.replace("-", " - ")}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <button
                      onClick={lockPowerup}
                      disabled={
                        submitting ||
                        selectedFixtureId == null ||
                        !activeMyPicksByFixture[selectedFixtureId] ||
                        (myGoldenFixtureId != null &&
                          selectedFixtureId === myGoldenFixtureId)
                      }
                      className={[
                        "mt-4",
                        ACTION_BTN_BASE,
                        selectedPowerupType === "ALL_IN"
                          ? "border-amber-300/45 bg-[linear-gradient(135deg,rgba(177,144,86,0.28),rgba(116,92,58,0.16))] hover:border-amber-200/55 hover:bg-[linear-gradient(135deg,rgba(196,160,98,0.34),rgba(128,102,62,0.2))]"
                          : "border-sky-300/45 bg-[linear-gradient(135deg,rgba(96,165,250,0.22),rgba(30,64,175,0.14))] hover:border-sky-200/55 hover:bg-[linear-gradient(135deg,rgba(125,211,252,0.3),rgba(37,99,235,0.2))]",
                      ].join(" ")}
                    >
                      {submitting ? "Locking…" : "Lock-In"}
                    </button>
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}
      </SectionStack>
    </PageShell>
  );
}
