"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  ConfirmDialog,
  ModalHeader,
  ThemedSheetModal,
} from "./RoomModal";
import SectionCard from "./SectionCard";
import SectionStack from "./SectionStack";
import StatusPill from "./StatusPill";
import TeamBadge from "./TeamBadge";
import ScoringKeyRow, { type ScoringKeyItem } from "./ScoringKeyRow";
import type { TableRow } from "@/lib/tableClient";
import {
  YEAR_TABLE_LOCK_AFTER_GW,
  YEAR_TABLE_LOCK_GW,
  clubsFromTableRows,
  scoreYearTableOrder,
  yearTableTeamKey,
  yearTableTotal,
  type YearTableClub,
} from "@/lib/yearTableScoring";
import { getFixturesCached } from "@/lib/fixturesClient";
import { getCountdownParts } from "@/app/room/[roomCode]/minigame/lock-utils";

type Player = {
  uid: string;
  displayName: string;
  nickName?: string;
};

type YearPick = {
  uid: string;
  order: string[];
  submittedAt: string | null;
};

type YearTablePayload = {
  ok?: boolean;
  open?: boolean;
  scoringOpen?: boolean;
  currentGw?: number;
  lockAfterGw?: number;
  teamKeys?: string[];
  clubs?: YearTableClub[];
  myPick?: YearPick | null;
  picks?: YearPick[];
  error?: string;
};

type YearTableSectionProps = {
  roomCode: string;
  seasonKey: string;
  currentGw: number;
  uid: string | null;
  tableRows: TableRow[];
  players: Player[];
};

function shortNameFor(player: Player | undefined) {
  const nick = player?.nickName?.trim();
  if (nick) return nick;
  const name = player?.displayName?.trim() || "Player";
  return name.split(/\s+/)[0] || name;
}

function cellTone(points: number, scoringOpen: boolean) {
  if (!scoringOpen) return "bg-white/[0.02]";
  if (points === 3) return "bg-emerald-400/16 ring-1 ring-inset ring-emerald-300/25";
  if (points === 1) return "bg-amber-400/14 ring-1 ring-inset ring-amber-300/20";
  return "bg-white/[0.02] opacity-40";
}

const SLOT_COUNT = 20;

const YEAR_TABLE_SCORING_ITEMS: ScoringKeyItem[] = [
  { label: "Exact", value: "3", tone: "exact" },
  { label: "Off by 1", value: "1", tone: "result" },
  { label: "Miss", value: "0", tone: "miss" },
];

function formatLockCountdown(msLeft: number) {
  const parts = getCountdownParts(msLeft);
  return `${parts.days}d ${parts.hours}h ${parts.minutes}m ${parts.seconds}s`;
}

function emptyDraft() {
  return Array.from({ length: SLOT_COUNT }, () => "");
}

function rankLabel(rank: number) {
  const n = rank + 1;
  const mod = n % 100;
  const suffix =
    mod >= 11 && mod <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return `${n}${suffix}`;
}

export default function YearTableSection({
  roomCode,
  seasonKey,
  currentGw,
  uid,
  tableRows,
  players,
}: YearTableSectionProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(currentGw <= YEAR_TABLE_LOCK_AFTER_GW);
  const [scoringOpen, setScoringOpen] = useState(false);
  const [clubs, setClubs] = useState<YearTableClub[]>([]);
  const [myPick, setMyPick] = useState<YearPick | null>(null);
  const [picks, setPicks] = useState<YearPick[]>([]);
  const [enterOpen, setEnterOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[]>(() => emptyDraft());
  const [focusedRank, setFocusedRank] = useState(0);
  const slotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [lockAtMs, setLockAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const playerByUid = useMemo(() => {
    const map = new Map<string, Player>();
    for (const player of players) map.set(player.uid, player);
    return map;
  }, [players]);

  const clubByKey = useMemo(() => {
    const map = new Map<string, YearTableClub>();
    for (const club of clubs) map.set(club.key, club);
    return map;
  }, [clubs]);

  const actualPositionByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of tableRows) {
      const key = yearTableTeamKey(row.team);
      if (key) map.set(key, row.position);
    }
    return map;
  }, [tableRows]);

  const fallbackClubs = useMemo(
    () => clubsFromTableRows(tableRows),
    [tableRows],
  );

  async function loadYearTable() {
    if (!uid || !seasonKey) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        roomCode,
        uid,
        seasonKey,
      });
      const res = await fetch(`/api/game/year-table?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as YearTablePayload;
      if (!res.ok) throw new Error(data.error || "Failed to load year predictions.");
      setOpen(data.open !== false);
      setScoringOpen(data.scoringOpen === true);
      setClubs(Array.isArray(data.clubs) && data.clubs.length ? data.clubs : fallbackClubs);
      setMyPick(data.myPick ?? null);
      setPicks(Array.isArray(data.picks) ? data.picks : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load year predictions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadYearTable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, seasonKey, uid]);

  useEffect(() => {
    if (!seasonKey) return;
    let cancelled = false;
    void getFixturesCached(YEAR_TABLE_LOCK_GW, seasonKey)
      .then((data) => {
        const firstKickoff = (data.fixtures || [])
          .map((fixture) => Date.parse(String(fixture.kickoff || "")))
          .filter((ms) => Number.isFinite(ms))
          .sort((a, b) => a - b)[0];
        if (!cancelled) {
          setLockAtMs(Number.isFinite(firstKickoff) ? firstKickoff : null);
        }
      })
      .catch(() => {
        if (!cancelled) setLockAtMs(null);
      });
    return () => {
      cancelled = true;
    };
  }, [seasonKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const rankedClubs = clubs.length ? clubs : fallbackClubs;
  const remainingClubs = useMemo(() => {
    const taken = new Set(draftOrder.filter(Boolean));
    return rankedClubs.filter((club) => !taken.has(club.key));
  }, [draftOrder, rankedClubs]);
  const filledCount = draftOrder.filter(Boolean).length;
  const hasAnyPicks = picks.length > 0;
  const canEnter = open && !myPick && rankedClubs.length === 20;

  function openEnter() {
    setDraftOrder(emptyDraft());
    setFocusedRank(0);
    setEnterOpen(true);
  }

  function pickClub(key: string) {
    if (submitBusy || draftOrder.includes(key)) return;
    const next = [...draftOrder];
    let idx = focusedRank;
    if (next[idx]) {
      next[idx] = key;
    } else {
      idx = next.findIndex((value, i) => i >= focusedRank && !value);
      if (idx < 0) idx = next.findIndex((value) => !value);
      if (idx < 0) return;
      next[idx] = key;
    }
    setDraftOrder(next);
    const nextEmpty = next.findIndex((value, i) => i > idx && !value);
    setFocusedRank(nextEmpty >= 0 ? nextEmpty : idx);
  }

  function removeClubAt(index: number) {
    if (submitBusy) return;
    const next = [...draftOrder];
    next[index] = "";
    setDraftOrder(next);
    setFocusedRank(index);
  }

  useEffect(() => {
    if (!enterOpen) return;
    slotRefs.current[focusedRank]?.scrollIntoView({
      behavior: "smooth",
      inline: "start",
      block: "nearest",
    });
  }, [focusedRank, enterOpen]);

  function clubFor(key: string) {
    return clubByKey.get(key) || fallbackClubs.find((item) => item.key === key);
  }

  async function submitDraft() {
    if (!uid || submitBusy || filledCount !== SLOT_COUNT) return;
    setSubmitBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/game/year-table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          uid,
          seasonKey,
          order: draftOrder,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to lock year predictions.");
      setConfirmSubmitOpen(false);
      setEnterOpen(false);
      await loadYearTable();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to lock year predictions.");
      setConfirmSubmitOpen(false);
    } finally {
      setSubmitBusy(false);
    }
  }

  const viewRows = useMemo(() => {
    return picks
      .map((pick) => {
        const scored = scoringOpen
          ? scoreYearTableOrder(pick.order, actualPositionByKey)
          : pick.order.map((key, index) => ({
              key,
              predictedPos: index + 1,
              actualPos: null as number | null,
              points: 0,
            }));
        return {
          pick,
          scored,
          total: scoringOpen ? yearTableTotal(scored) : 0,
        };
      })
      .sort((a, b) => {
        if (uid && a.pick.uid === uid) return -1;
        if (uid && b.pick.uid === uid) return 1;
        const nameA = shortNameFor(playerByUid.get(a.pick.uid));
        const nameB = shortNameFor(playerByUid.get(b.pick.uid));
        return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
      });
  }, [picks, scoringOpen, actualPositionByKey, playerByUid, uid]);

  const statusLabel = myPick
    ? "Locked"
    : open
      ? "Not entered"
      : "Closed";
  const statusTone = myPick ? "you" : open ? "waiting" : "neutral";
  const lockMsLeft = lockAtMs != null ? lockAtMs - nowMs : null;
  const showLockCountdown = lockMsLeft != null && lockMsLeft > 0 && open;

  return (
    <>
      <SectionCard className="rounded-[24px] border border-amber-200/16 bg-[linear-gradient(180deg,rgba(255,196,120,0.04),rgba(255,255,255,0.012))] p-1">
        <div className="rounded-[24px] border border-amber-200/12 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_42%),linear-gradient(180deg,rgba(22,14,8,0.94),rgba(10,8,6,0.9))] px-4 py-4 sm:px-5 sm:py-5 shadow-[inset_0_1px_0_rgba(251,191,36,0.12)]">
          <SectionStack gap="tight">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-amber-100/55">
                  Season side game
                </div>
                <div className="mt-1 font-display text-xl font-semibold leading-tight text-foreground">
                  Year predictions
                </div>
              </div>
              <StatusPill label={statusLabel} tone={statusTone} />
            </div>

            <ScoringKeyRow items={YEAR_TABLE_SCORING_ITEMS} />

            {loading ? (
              <div className="inline-flex items-center gap-2 text-sm text-muted">
                <Loader2 size={14} className="animate-spin" />
                <span>Loading year predictions…</span>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-rose-300">
                {error}
              </div>
            ) : null}

            <div className="space-y-1.5 text-xs text-muted">
              <div>
                {myPick
                  ? "Your table is locked to this account. Open the room list to compare."
                  : open
                    ? `Locks at the first GW${YEAR_TABLE_LOCK_GW} kickoff.`
                    : `Entries closed when GW${YEAR_TABLE_LOCK_GW} started.`}
              </div>
              <div>
                One table for your account. Submit once and it follows you into
                every room.
              </div>
              {showLockCountdown ? (
                <div className="font-display text-sm font-semibold tracking-[0.04em] text-amber-100/80">
                  Locks in {formatLockCountdown(lockMsLeft)}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={openEnter}
                disabled={!canEnter || loading}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-display font-semibold text-foreground transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {myPick ? "Submitted" : "Enter year predictions"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewOpen(true);
                  void loadYearTable();
                }}
                disabled={!hasAnyPicks || loading}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-display font-semibold text-foreground transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
              >
                View all predictions
              </button>
            </div>
          </SectionStack>
        </div>
      </SectionCard>

      <ThemedSheetModal
        open={enterOpen}
        onClose={() => (submitBusy ? null : setEnterOpen(false))}
        maxWidthClassName="max-w-2xl"
      >
        <ModalHeader
          title="Enter year predictions"
          onClose={() => setEnterOpen(false)}
          showCloseButton
          closeButtonClassName="hidden sm:inline-flex"
        />
        <div className="text-sm text-muted">
          Swipe ranks, tap a club to fill the focused slot. Remove to put a
          club back.
        </div>
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto no-scrollbar">
          {draftOrder.map((key, index) => {
            const club = key ? clubFor(key) : undefined;
            const focused = focusedRank === index;
            return (
              <button
                key={`slot-${index}`}
                ref={(node) => {
                  slotRefs.current[index] = node;
                }}
                type="button"
                onClick={() => setFocusedRank(index)}
                className={[
                  "w-[82%] shrink-0 snap-start rounded-[22px] border px-4 py-4 text-left transition",
                  focused
                    ? "border-amber-200/28 bg-amber-400/[0.08]"
                    : "border-white/8 bg-white/[0.02]",
                ].join(" ")}
              >
                <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-white/48">
                  {rankLabel(index)}
                </div>
                {club ? (
                  <div className="mt-3 flex flex-col items-center gap-3">
                    <TeamBadge
                      name={club.name || key}
                      tla={club.tla}
                      shortName={club.shortName}
                      badge={club.badge}
                      wrapperClassName="h-16 w-16"
                      imageClassName="h-14 w-14 object-contain"
                    />
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeClubAt(index);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          removeClubAt(index);
                        }
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-2 text-[0.68rem] font-display font-semibold uppercase tracking-[0.08em] text-white/70"
                    >
                      <X size={12} />
                      Remove
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-muted">Tap a club below.</div>
                )}
              </button>
            );
          })}
        </div>
        {remainingClubs.length ? (
          <div className="grid max-h-[28dvh] grid-cols-5 gap-2 overflow-y-auto no-scrollbar">
            {remainingClubs.map((club) => (
              <button
                key={club.key}
                type="button"
                onClick={() => pickClub(club.key)}
                disabled={submitBusy}
                aria-label={club.name || club.tla || club.key}
                className="flex items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] p-2 transition hover:border-white/14 hover:bg-white/[0.055] disabled:opacity-50"
              >
                <TeamBadge
                  name={club.name}
                  tla={club.tla}
                  shortName={club.shortName}
                  badge={club.badge}
                  wrapperClassName="h-11 w-11"
                  imageClassName="h-9 w-9 object-contain"
                />
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-muted">
            All 20 clubs are placed. Swipe a slot and tap Remove to rewrite, or
            submit to lock.
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="shrink-0 font-display text-sm font-semibold text-white/70">
            {filledCount}/20
          </div>
          <button
            type="button"
            onClick={() => setConfirmSubmitOpen(true)}
            disabled={submitBusy || filledCount !== SLOT_COUNT}
            className="w-full rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(56,189,248,0.14))] px-4 py-3 text-sm font-display font-semibold text-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            {submitBusy ? "Locking…" : "Submit and lock"}
          </button>
        </div>
      </ThemedSheetModal>

      <ConfirmDialog
        open={confirmSubmitOpen}
        onClose={() => (submitBusy ? null : setConfirmSubmitOpen(false))}
        onConfirm={() => {
          void submitDraft();
        }}
        title="Lock year predictions"
        body="This ranks the Premier League 1–20 for the season. It locks to your account and shows in every room. You cannot edit after submitting."
        confirmLabel={submitBusy ? "Locking…" : "Confirm lock"}
        confirming={submitBusy}
      />

      <ThemedSheetModal
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        maxWidthClassName="max-w-2xl"
      >
        <ModalHeader
          title="Year predictions"
          onClose={() => setViewOpen(false)}
          showCloseButton
          closeButtonClassName="hidden sm:inline-flex"
        />
        <div className="text-sm text-muted">
          {scoringOpen
            ? "Final 3 / 1 / 0 scoring against the finished table."
            : "Compare every locked table. Points are awarded after GW38."}
        </div>
        {viewRows.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 text-sm text-muted">
            Nobody has locked a year table yet.
          </div>
        ) : (
          <div className="max-h-[62dvh] overflow-auto no-scrollbar">
            <table className="border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 w-[72px] min-w-[72px] bg-[#0a1220] px-1 pb-2 text-left text-[0.58rem] font-display font-semibold uppercase tracking-[0.12em] text-white/40">
                    Player
                  </th>
                  {Array.from({ length: SLOT_COUNT }, (_, index) => (
                    <th
                      key={`rank-${index}`}
                      className="sticky top-0 z-10 min-w-[40px] bg-[#0a1220] px-0.5 pb-2 text-center font-display text-[0.58rem] font-semibold uppercase tracking-[0.04em] text-white/48"
                    >
                      {rankLabel(index)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {viewRows.map(({ pick, scored, total }) => {
                  const isYou = pick.uid === uid;
                  const scoredByPos = new Map(
                    scored.map((row) => [row.predictedPos, row]),
                  );
                  return (
                    <tr key={pick.uid}>
                      <th
                        className={[
                          "sticky left-0 z-10 w-[72px] min-w-[72px] bg-[#0a1220] py-1.5 pr-2 text-left align-middle",
                          isYou ? "text-foreground" : "text-white/80",
                        ].join(" ")}
                      >
                        <div className="truncate font-display text-[0.72rem] font-semibold leading-tight">
                          {shortNameFor(playerByUid.get(pick.uid))}
                        </div>
                        {isYou ? (
                          <div className="text-[0.52rem] font-display font-semibold uppercase tracking-[0.12em] text-white/45">
                            You
                          </div>
                        ) : null}
                        {scoringOpen ? (
                          <div className="text-[0.58rem] text-white/50">
                            {total} pts
                          </div>
                        ) : null}
                      </th>
                      {Array.from({ length: SLOT_COUNT }, (_, index) => {
                        const row = scoredByPos.get(index + 1);
                        const club = row
                          ? clubByKey.get(row.key) || clubFor(row.key)
                          : undefined;
                        return (
                          <td
                            key={`${pick.uid}-${index}`}
                            className="px-0.5 py-1.5 align-middle"
                          >
                            <div
                              className={[
                                "flex h-10 w-10 items-center justify-center rounded-[12px]",
                                row
                                  ? cellTone(row.points, scoringOpen)
                                  : "bg-white/[0.015]",
                              ].join(" ")}
                            >
                              {club ? (
                                <TeamBadge
                                  name={club.name || row?.key || ""}
                                  tla={club.tla}
                                  shortName={club.shortName}
                                  badge={club.badge}
                                  wrapperClassName="h-10 w-10 border-0 bg-transparent"
                                  imageClassName="h-8 w-8 object-contain"
                                />
                              ) : null}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ThemedSheetModal>
    </>
  );
}
