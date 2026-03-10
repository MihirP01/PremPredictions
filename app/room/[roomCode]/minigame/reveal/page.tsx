"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../../../../components/AuthProvider";
import PageBackButton from "../../../../../components/PageBackButton";
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
import { formatKickoffParts, formatUnlockDateParts } from "@/lib/dateDisplay";
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
  if (
    !raw ||
    s === "TIMED" ||
    s === "SCHEDULED" ||
    s === "NOT_STARTED" ||
    s === "TBD"
  ) {
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

  const [gw, setGw] = useState<number | null>(null);
  const [seasonKey, setSeasonKey] = useState<string | null>(null);
  const [game, setGame] = useState<GameDoc | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);

  const [picks, setPicks] = useState<PickDoc[]>([]);
  const [goldensByUid, setGoldensByUid] = useState<Record<string, GoldenDoc>>(
    {},
  );
  const [powerupsByUid, setPowerupsByUid] = useState<
    Record<string, PowerupDoc>
  >({});
  const [displayNamesByUid, setDisplayNamesByUid] = useState<
    Record<string, string>
  >({});

  const routedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(0);
  const [clockReady, setClockReady] = useState(false);
  const previewPlayerIds = useMemo(() => {
    const base = user?.uid ? [user.uid] : ["preview-self"];
    return [...base, "preview-rival-a", "preview-rival-b"];
  }, [user?.uid]);

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
        if (devPreview) return;

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
            next[player.uid] =
              nick || player.displayName || next[player.uid] || "Player";
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
            map[player.uid] =
              nick || player.displayName || map[player.uid] || "Player";
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

  const previewFixtureIds = useMemo(() => {
    if (!fixtures?.length) return [];
    return fixtures
      .slice(0, Math.min(6, fixtures.length))
      .map((f) => f.fixtureId);
  }, [fixtures]);

  const previewGame = useMemo<GameDoc | null>(() => {
    if (!devPreview || !previewFixtureIds.length) return null;
    return {
      state: "REVEAL",
      players: previewPlayerIds,
      order: previewPlayerIds,
      fixtureIds: previewFixtureIds,
      forcedReveal: true,
    };
  }, [devPreview, previewFixtureIds, previewPlayerIds]);

  const previewPicks = useMemo<PickDoc[]>(() => {
    if (!previewGame) return [];
    const sampleScores = ["2-1", "1-1", "3-2", "0-0", "2-2", "1-0"];
    return previewGame.players.flatMap((uid, playerIdx) =>
      previewGame.fixtureIds.map((fixtureId, fixtureIdx) => ({
        uid,
        fixtureId,
        score:
          sampleScores[(playerIdx + fixtureIdx) % sampleScores.length] || "1-1",
      })),
    );
  }, [previewGame]);

  const previewGoldensByUid = useMemo<Record<string, GoldenDoc>>(() => {
    if (!previewGame?.fixtureIds?.length) return {};
    const targetFixtureId =
      previewGame.fixtureIds[1] ?? previewGame.fixtureIds[0];
    return previewGame.players.reduce<Record<string, GoldenDoc>>(
      (acc, uid, idx) => {
        if (idx === 0 && targetFixtureId != null) {
          acc[uid] = {
            uid,
            fixtureId: targetFixtureId,
            score: "2-1",
            locked: true,
          };
        }
        return acc;
      },
      {},
    );
  }, [previewGame]);

  const previewPowerupsByUid = useMemo<Record<string, PowerupDoc>>(() => {
    if (!previewGame?.fixtureIds?.length) return {};
    const fixtureId = previewGame.fixtureIds[2] ?? previewGame.fixtureIds[0];
    return previewGame.players.reduce<Record<string, PowerupDoc>>(
      (acc, uid, idx) => {
        if (fixtureId == null) return acc;
        if (idx === 1) {
          acc[uid] = { uid, fixtureId, powerupType: "ALL_IN", locked: true };
        } else if (idx === 2) {
          acc[uid] = {
            uid,
            fixtureId,
            powerupType: "SAFETY_NET",
            locked: true,
          };
        }
        return acc;
      },
      {},
    );
  }, [previewGame]);

  const previewDisplayNamesByUid = useMemo<Record<string, string>>(() => {
    const selfName =
      String(user?.displayName || "").trim() ||
      String(user?.email || "").split("@")[0] ||
      "You";
    return {
      [previewPlayerIds[0] || "preview-self"]: selfName,
      "preview-rival-a": "Alex",
      "preview-rival-b": "Jordan",
    };
  }, [previewPlayerIds, user?.displayName, user?.email]);

  const previewGameActive =
    devPreview &&
    !!previewGame &&
    (!game || String(game.state ?? "").toUpperCase() !== "REVEAL");
  const activeGame = previewGameActive ? previewGame : game;
  const activePicks = previewGameActive ? previewPicks : picks;
  const activeGoldensByUid = previewGameActive
    ? previewGoldensByUid
    : goldensByUid;
  const activePowerupsByUid = previewGameActive
    ? previewPowerupsByUid
    : powerupsByUid;
  const activeDisplayNamesByUid = useMemo(
    () => ({
      ...displayNamesByUid,
      ...(previewGameActive ? previewDisplayNamesByUid : {}),
    }),
    [displayNamesByUid, previewDisplayNamesByUid, previewGameActive],
  );

  const players = useMemo(() => {
    // Prefer order if present (nice stable ordering)
    const arr =
      (activeGame?.order?.length ? activeGame.order : activeGame?.players) ??
      [];
    return Array.isArray(arr) ? arr : [];
  }, [activeGame]);
  const playersSorted = useMemo(
    () =>
      [...players].sort((a, b) => byDisplayName(a, b, activeDisplayNamesByUid)),
    [activeDisplayNamesByUid, players],
  );

  const fixtureIds = useMemo(() => {
    if (activeGame?.fixtureIds?.length) return activeGame.fixtureIds;
    return (fixtures ?? []).map((f) => f.fixtureId);
  }, [activeGame, fixtures]);

  const fixtureMap = useMemo(() => {
    const m = new Map<number, Fixture>();
    (fixtures ?? []).forEach((f) => m.set(f.fixtureId, f));
    return m;
  }, [fixtures]);
  const picksByUserFixture = useMemo(() => {
    const m = new Map<string, string>(); // key = uid|fixtureId
    for (const p of activePicks)
      m.set(`${p.uid}|${p.fixtureId}`, String(p.score ?? "").trim());
    return m;
  }, [activePicks]);

  const lockedCount = useMemo(() => {
    return Object.values(activeGoldensByUid).filter((g) => g?.locked).length;
  }, [activeGoldensByUid]);

  const allLocked =
    !!activeGame?.forcedReveal ||
    (players.length > 0 && lockedCount >= players.length);
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
  const unlockMsLeft =
    unlockAtMs != null && clockReady ? Math.max(unlockAtMs - nowMs, 0) : 0;
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
      progress: !clockReady
        ? 0
        : unlockDayValue > 0
          ? Math.min((unlockDayValue / 7) * 100, 100)
          : 0,
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
  const standardSectionCardClass =
    "rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5";

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
          <TopActionRow
              title={`GW ${gw ?? "—"} Reveal`}
              subtitle={`${roomCode} • GW ${gw ?? "—"}`}
              actions={
                <PageBackButton
                  label="Exit"
                  className={BTN_3D}
                  onClick={() => router.push(`/room/${roomCode}`)}
                />
              }
            />
          <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.014))] p-1">
            <div className="rounded-[24px] border border-white/6 bg-[radial-gradient(circle_at_top_right,rgba(var(--room-accent-rgb),0.08),transparent_40%),linear-gradient(180deg,rgba(5,10,22,0.92),rgba(7,10,18,0.88))] px-4 py-4 sm:px-5 sm:py-5">
              <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white/42">
                Reveal desk
              </div>
              <div className="mt-2 text-sm text-muted inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                <span>Loading GW reveal data…</span>
              </div>
            </div>
          </SectionCard>
        </SectionStack>
      </PageShell>
    );
  }

  const state = String(activeGame.state ?? "").toUpperCase();
  if (state !== "REVEAL") {
    return (
      <PageShell
        width="wide"
        shellChrome={false}
        outerClassName="min-h-0 px-2 pb-0 pt-0 bg-app sm:px-3 sm:pb-0 sm:pt-0"
        contentClassName="relative z-[1]"
      >
        <SectionStack gap="page">
          <SectionCard className={standardSectionCardClass}>
            <div className="text-xl font-semibold text-foreground">
              Reveal not ready
            </div>
            <div className="text-sm text-muted">
              Current state: {activeGame.state}
            </div>
          </SectionCard>
        </SectionStack>
      </PageShell>
    );
  }

  return (
    <PageShell
      width="wide"
      shellChrome={false}
      outerClassName="min-h-0 px-2 pb-0 pt-0 bg-app sm:px-3 sm:pb-0 sm:pt-0"
      contentClassName="relative z-[1]"
    >
      <SectionStack gap="page">
        <TopActionRow
          title={`GW ${gw} Reveal`}
          subtitle={`${roomCode} • GW ${gw}`}
          actions={
            <PageBackButton
              label="Exit"
              className={BTN_3D}
              onClick={() => router.push(`/room/${roomCode}`)}
            />
          }
        />

        {error && (
          <SectionCard className={standardSectionCardClass}>
            <div className="text-sm text-danger">{error}</div>
          </SectionCard>
        )}

        <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.014))] p-1">
          <div className="rounded-[24px] border border-white/6 bg-[radial-gradient(circle_at_top_right,rgba(var(--room-accent-rgb),0.1),transparent_38%),linear-gradient(180deg,rgba(5,10,22,0.92),rgba(7,10,18,0.88))] px-4 py-4 sm:px-5 sm:py-5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1.5">
                  <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white/42">
                    Reveal desk
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/72">
                      Next gameweek
                    </span>
                    <span className="font-display text-[1.5rem] font-semibold text-foreground sm:text-[1.75rem]">
                      GW {gw + 1}
                    </span>
                  </div>
                </div>
              </div>
              {unlockAtMs != null && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/6 pt-3">
                    <span className="text-[0.72rem] font-medium uppercase tracking-[0.16em] text-white/42">
                      Unlocks
                    </span>
                    <span className="font-display text-sm font-semibold text-foreground">
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
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {unlockCountdownRings.map((unit) => (
                      <div
                        key={unit.label}
                        className="relative overflow-hidden rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-3 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                      >
                        <span
                          className="absolute inset-x-0 top-0 h-px"
                          style={{
                            backgroundImage:
                              "linear-gradient(90deg, transparent, rgba(var(--room-accent-rgb), 0.52), transparent)",
                          }}
                          aria-hidden
                        />
                        <div className="font-display text-[1.45rem] font-semibold leading-none text-foreground sm:text-[1.75rem]">
                          {unit.value}
                        </div>
                        <div className="mt-2 text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-white/42">
                          {unit.label}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </SectionCard>

        {!allLocked && (
          <SectionCard className={standardSectionCardClass}>
            <div className="border border-yellow-300/65 rounded-tl-xl rounded-br-xl rounded-tr-none rounded-bl-none p-4 bg-[linear-gradient(180deg,rgba(250,204,21,0.12)_0%,rgba(250,204,21,0.04)_100%)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-foreground">
                    Reveal is syncing
                  </div>
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
          </SectionCard>
        )}
        <SectionCard className={standardSectionCardClass}>
          <div className="grid items-start gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {fixtureIds.map((fid, idx) => {
              const f = fixtureMap.get(fid);
              const kickoffParts = f ? formatKickoffParts(f.kickoff) : null;
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
                backgroundImage: `
              radial-gradient(circle at 16% 14%, ${hexToRgba(homeColor, 0.16)} 0%, rgba(9,12,22,0) 46%),
              radial-gradient(circle at 84% 14%, ${hexToRgba(awayColor, 0.16)} 0%, rgba(9,12,22,0) 46%),
              linear-gradient(180deg, rgba(9,12,22,0.95) 0%, rgba(8,12,22,0.97) 55%, rgba(5,10,22,0.995) 100%)
            `,
              };

              return (
                <div
                  key={fid}
                  className="fixture-card-enter space-y-2 w-full"
                  style={{
                    animationDelay: `${120 + Math.min(idx, 12) * 110}ms`,
                    animationDuration: "520ms",
                  }}
                >
                  <div className="relative overflow-hidden rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.018))] p-1 shadow-[0_20px_46px_rgba(3,8,20,0.24)]">
                    <div
                      className="fixture-clash-bg rounded-[22px] border border-white/6 bg-black/10 px-[clamp(0.75rem,1.1vw,1.25rem)] py-[clamp(0.72rem,1vw,1.08rem)] backdrop-blur-[10px]"
                      style={clashBgStyle}
                    >
                      <div className="space-y-3">
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
                              <span className="font-display font-semibold tabular-nums">
                                {kickoffParts.time}
                              </span>
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

                        <div className="overflow-hidden rounded-[22px] border border-white/7 bg-[rgb(5,10,22)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_12px_24px_rgba(2,6,20,0.2)]">
                          <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/6 pb-2">
                            <span className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                              Prediction board
                            </span>
                            <span className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/34">
                              {playersSorted.length}{" "}
                              {playersSorted.length === 1
                                ? "player"
                                : "players"}
                            </span>
                          </div>
                          <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(92px,1fr))] gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(104px,1fr))]">
                            {playersSorted.map((uid) => {
                              const sc =
                                picksByUserFixture.get(`${uid}|${fid}`) || "";
                              const g = activeGoldensByUid[uid];
                              const isGolden =
                                g?.locked && g?.fixtureId === fid;
                              const p = activePowerupsByUid[uid];
                              const powerupType =
                                p?.locked && p?.fixtureId === fid
                                  ? p.powerupType
                                  : null;
                              const toneClass =
                                "border-white/10 bg-[rgb(7,12,24)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_10px_20px_rgba(2,6,20,0.16)]";
                              const powerupTypeClass =
                                powerupType === "ALL_IN"
                                  ? "!border-amber-500/70 shadow-[inset_0_0_0_1px_rgba(217,119,6,0.32),0_8px_18px_rgba(120,53,15,0.16)]"
                                  : powerupType === "SAFETY_NET"
                                    ? "!border-sky-600/75 shadow-[inset_0_0_0_1px_rgba(2,132,199,0.34),0_8px_18px_rgba(8,47,73,0.18)]"
                                    : "";
                              const goldenBorderClass = isGolden
                                ? "!border-yellow-300/75"
                                : "";
                              const goldenGlowClass = isGolden
                                ? "shadow-[inset_0_0_0_1px_rgba(250,204,21,0.55),0_0_14px_rgba(250,204,21,0.15)]"
                                : "";
                              return (
                                <div
                                  key={`${fid}-${uid}`}
                                  className="relative min-w-0 overflow-hidden"
                                >
                                  <div
                                    className={[
                                      "relative overflow-hidden rounded-[20px] border px-3 py-2.5 text-left",
                                      toneClass,
                                      goldenBorderClass,
                                      goldenGlowClass,
                                      powerupTypeClass,
                                    ].join(" ")}
                                  >
                                    <div className="relative">
                                      <div className="font-display text-[clamp(0.66rem,0.85vw,0.82rem)] font-semibold truncate text-muted">
                                        {activeDisplayNamesByUid[uid] ??
                                          uid.slice(0, 6)}
                                      </div>
                                      <span className="font-display text-[0.92rem] font-semibold text-foreground truncate">
                                        {fmtScore(sc)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </SectionStack>
    </PageShell>
  );
}
