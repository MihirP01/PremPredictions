"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import {
  ConfirmDialog,
  ModalHeader,
  ThemedSheetModal,
} from "./RoomModal";
import SectionCard from "./SectionCard";
import SectionStack from "./SectionStack";
import StatusPill from "./StatusPill";
import TeamBadge from "./TeamBadge";
import type { TableRow } from "@/lib/tableClient";
import {
  YEAR_TABLE_LOCK_AFTER_GW,
  clubsFromTableRows,
  scoreYearTableOrder,
  yearTableTeamKey,
  yearTableTotal,
  type YearTableClub,
} from "@/lib/yearTableScoring";

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

function displayNameFor(player: Player | undefined, uid: string) {
  if (!player) return "Player";
  return player.nickName
    ? `(${player.nickName}) ${player.displayName}`
    : player.displayName;
}

function clubLabel(club: YearTableClub | undefined, key: string) {
  return club?.tla || club?.shortName || club?.name || key;
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
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

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

  const rankedClubs = clubs.length ? clubs : fallbackClubs;
  const hasAnyPicks = picks.length > 0;
  const canEnter = open && !myPick && rankedClubs.length === 20;

  function openEnter() {
    const start = myPick?.order?.length
      ? myPick.order
      : rankedClubs.map((club) => club.key);
    setDraftOrder(start);
    setEnterOpen(true);
  }

  function moveDraft(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= draftOrder.length) return;
    setDraftOrder((current) => {
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(next, 0, item);
      return copy;
    });
  }

  async function submitDraft() {
    if (!uid || submitBusy) return;
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
        if (scoringOpen && b.total !== a.total) return b.total - a.total;
        const nameA = displayNameFor(playerByUid.get(a.pick.uid), a.pick.uid);
        const nameB = displayNameFor(playerByUid.get(b.pick.uid), b.pick.uid);
        return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
      });
  }, [picks, scoringOpen, actualPositionByKey, playerByUid]);

  const statusLabel = myPick
    ? "Locked"
    : open
      ? "Not entered"
      : "Closed";
  const statusTone = myPick ? "you" : open ? "waiting" : "neutral";

  return (
    <>
      <SectionCard>
        <SectionStack gap="tight">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                Season desk
              </div>
              <div className="mt-1 font-display text-xl font-semibold text-foreground">
                Year predictions
              </div>
              <div className="mt-1 text-xs text-muted">
                Rank 1–20 once. Exact 3pts, off by one 1pt, otherwise 0.
                Scored after GW38.
              </div>
            </div>
            <StatusPill label={statusLabel} tone={statusTone} />
          </div>

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

          <div className="text-xs text-muted">
            {myPick
              ? "Your table is locked. Open the room list to compare."
              : open
                ? `Enter before GW${YEAR_TABLE_LOCK_AFTER_GW + 1}. You only get one submission.`
                : "Entries closed after GW5."}
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
          Move every club into your 1–20 finish. Submitting locks this list for
          the season.
        </div>
        <div className="max-h-[58dvh] space-y-2 overflow-y-auto no-scrollbar">
          {draftOrder.map((key, index) => {
            const club = clubByKey.get(key) || fallbackClubs.find((item) => item.key === key);
            return (
              <div
                key={key}
                className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2"
              >
                <div className="w-8 font-display text-sm font-semibold text-white/70">
                  {index + 1}
                </div>
                <TeamBadge
                  name={club?.name || key}
                  tla={club?.tla}
                  shortName={club?.shortName}
                  badge={club?.badge}
                  wrapperClassName="h-8 w-8"
                  imageClassName="h-6 w-6 object-contain"
                />
                <div className="min-w-0 flex-1 font-display text-sm font-semibold text-foreground">
                  {clubLabel(club, key)}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => moveDraft(index, -1)}
                    disabled={index === 0 || submitBusy}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-foreground disabled:opacity-40"
                    aria-label="Move up"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDraft(index, 1)}
                    disabled={index === draftOrder.length - 1 || submitBusy}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-foreground disabled:opacity-40"
                    aria-label="Move down"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setConfirmSubmitOpen(true)}
          disabled={submitBusy || draftOrder.length !== 20}
          className="w-full rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(56,189,248,0.14))] px-4 py-3 text-sm font-display font-semibold text-foreground transition hover:brightness-110 disabled:opacity-50"
        >
          {submitBusy ? "Locking…" : "Submit and lock"}
        </button>
      </ThemedSheetModal>

      <ConfirmDialog
        open={confirmSubmitOpen}
        onClose={() => (submitBusy ? null : setConfirmSubmitOpen(false))}
        onConfirm={() => {
          void submitDraft();
        }}
        title="Lock year predictions"
        body="This ranks the Premier League 1–20 for the season. You cannot edit after submitting."
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
            : "Lists are visible as people submit. Points are awarded after GW38."}
        </div>
        <div className="max-h-[62dvh] space-y-2 overflow-y-auto no-scrollbar">
          {viewRows.length === 0 ? (
            <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 text-sm text-muted">
              Nobody has locked a year table yet.
            </div>
          ) : (
            viewRows.map(({ pick, scored, total }) => {
              const isYou = pick.uid === uid;
              const expanded = expandedUid === pick.uid;
              return (
                <div
                  key={pick.uid}
                  className={[
                    "rounded-[22px] border px-3 py-3",
                    isYou
                      ? "border-white/14 bg-white/[0.045]"
                      : "border-white/8 bg-white/[0.02]",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedUid((current) =>
                        current === pick.uid ? null : pick.uid,
                      )
                    }
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="font-display text-sm font-semibold text-foreground">
                        {displayNameFor(playerByUid.get(pick.uid), pick.uid)}
                        {isYou ? (
                          <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-white/48">
                            You
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {scoringOpen ? `${total} pts` : "Locked in"}
                      </div>
                    </div>
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  {expanded ? (
                    <div className="mt-3 space-y-1.5">
                      {scored.map((row) => {
                        const club = clubByKey.get(row.key);
                        return (
                          <div
                            key={`${pick.uid}-${row.key}`}
                            className="flex items-center gap-2 rounded-xl border border-white/6 bg-black/10 px-2 py-1.5"
                          >
                            <div className="w-6 text-center font-display text-xs font-semibold text-white/70">
                              {row.predictedPos}
                            </div>
                            <TeamBadge
                              name={club?.name || row.key}
                              tla={club?.tla}
                              shortName={club?.shortName}
                              badge={club?.badge}
                              wrapperClassName="h-6 w-6"
                              imageClassName="h-4 w-4 object-contain"
                            />
                            <div className="min-w-0 flex-1 truncate text-xs text-foreground">
                              {clubLabel(club, row.key)}
                            </div>
                            {scoringOpen ? (
                              <div className="shrink-0 text-[11px] font-semibold text-white/70">
                                {row.actualPos != null ? `P${row.actualPos}` : "—"}{" "}
                                <span
                                  className={
                                    row.points === 3
                                      ? "text-emerald-200"
                                      : row.points === 1
                                        ? "text-amber-200"
                                        : "text-white/35"
                                  }
                                >
                                  +{row.points}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </ThemedSheetModal>
    </>
  );
}
