"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpLeft,
  ChevronDown,
  CircleDot,
  Crown,
  Footprints,
  Info,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "../../../../components/AuthProvider";
import AnimatedModal from "../../../../components/AnimatedModal";
import ModalExitButton from "../../../../components/ModalExitButton";
import PageBackButton from "../../../../components/PageBackButton";
import GameweekNavigator from "../../../../components/GameweekNavigator";
import PageShell from "../../../../components/PageShell";
import SectionCard from "../../../../components/SectionCard";
import SectionStack from "../../../../components/SectionStack";
import SliderSwitch from "../../../../components/SliderSwitch";
import SpecialBreak from "../../../../components/SpecialBreak";
import TeamBadge from "../../../../components/TeamBadge";
import TeamLabel from "../../../../components/TeamLabel";
import TopActionRow from "../../../../components/TopActionRow";
import { db } from "../../../../firebase";
import { getCurrentGameweekCached } from "@/lib/currentGameweekClient";
import { getRoomBootstrapCached } from "@/lib/roomBootstrapClient";
import { getFixturesCached, refreshFixturesCached } from "@/lib/fixturesClient";
import { getTableCached, type TableRow } from "@/lib/tableClient";
import {
  getMatchInfoCached,
  type MatchInfoData,
  type MatchInfoPlayer,
} from "@/lib/matchInfoClient";
import { getGameDataCached } from "@/lib/gameDataClient";
import {
  classifyPredictionTier,
  getBasePointsFromScores,
  getPowerupVisualState,
} from "@/lib/powerupScoring";
import { getRoomPlayersCached } from "@/lib/roomPlayersClient";
import { subscribeRoomMeta } from "@/lib/liveGameBus";
import {
  formatDateTimeLabel,
  formatDateWithOrdinal,
  formatKickoffParts,
} from "@/lib/dateDisplay";
import { teamAbbr } from "@/lib/teamDisplay";
import { collection, onSnapshot, query } from "firebase/firestore";

type Fixture = {
  fixtureId: number;
  gameweek: number;
  kickoff: string; // ISO
  status: string;
  home: {
    id?: number;
    name: string;
    tla?: string | null;
    shortName?: string;
    badge?: string | null;
  };
  away: {
    id?: number;
    name: string;
    tla?: string | null;
    shortName?: string;
    badge?: string | null;
  };
  result?: string | null; // "2-1" if finished
  redCards?: { home: number; away: number } | null;
};

type LiveOverlayFixture = Omit<Fixture, "fixtureId"> & {
  fixtureId?: number | null;
};

type Player = { uid: string; displayName: string };

// picksByFixture[fixtureId][uid] = "2-1"
type PicksByFixture = Record<number, Record<string, string>>;

// goldenByUid[uid] = { fixtureId, score }
type GoldenByUid = Record<string, { fixtureId: number; score: string }>;
type PowerupByUid = Record<
  string,
  { fixtureId: number; powerupType: "ALL_IN" | "SAFETY_NET"; locked: boolean }
>;
type RoomPlayerDoc = { displayName?: string; nickName?: string };
type TableMode = "HOME" | "TOTAL" | "AWAY";
type TableView = "SHORT" | "FULL";
type MatchInfoTab = "lineups" | "stats" | "h2h" | "form";

type FixturesSelectFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
};

type FixturesSummaryTileProps = {
  label: string;
  value: React.ReactNode;
  note: React.ReactNode;
  icon?: React.ReactNode;
};

function FixturesSelectField({
  id,
  label,
  value,
  onChange,
  children,
}: FixturesSelectFieldProps) {
  return (
    <label className="space-y-2">
      <span className="block font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
        {label}
      </span>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full appearance-none rounded-2xl border border-white/8 bg-white/[0.035] px-4 pr-10 font-display text-sm font-semibold text-foreground outline-none backdrop-blur-sm"
        >
          {children}
        </select>
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[0.72rem] text-white/45">
          ▼
        </span>
      </div>
    </label>
  );
}

function FixturesSummaryTile({
  label,
  value,
  note,
  icon,
}: FixturesSummaryTileProps) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-white/[0.025] p-4 shadow-[0_14px_32px_rgba(3,8,20,0.14)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
            {label}
          </div>
          <div className="font-display text-[clamp(1.1rem,1.8vw,1.7rem)] font-semibold leading-none text-foreground">
            {value}
          </div>
        </div>
        {icon ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.035] text-white/75">
            {icon}
          </div>
        ) : null}
      </div>
      <div className="mt-3 text-xs text-muted">{note}</div>
    </div>
  );
}

const TABLE_MODE_OPTIONS: Array<{ key: TableMode; label: string }> = [
  { key: "HOME", label: "Home" },
  { key: "TOTAL", label: "Combined" },
  { key: "AWAY", label: "Away" },
];

const BTN_3D = "btn-3d-accent";

function seasonLabel(seasonKey: string) {
  if (!/^\d{4}$/.test(seasonKey)) return seasonKey;
  return `${seasonKey.slice(0, 2)}/${seasonKey.slice(2)}`;
}

const MIN_GW = 1;
const MAX_GW = 38;
const SHOW_MATCH_INFO = true;
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
  return String(s).replace("-", "–");
}

const HIDDEN_PICK = "***";
const VOIDED_FIXTURE_STATUSES = new Set([
  "POSTPONED",
  "SUSPENDED",
  "CANCELLED",
  "AWARDED",
]);
const LEAGUE_LOCK_WINDOW_MS = 30 * 60 * 1000;

function firstScheduledKickoffMs(list: Fixture[]) {
  const times = list
    .filter((fixture) => {
      const status = String(fixture.status || "")
        .trim()
        .toUpperCase();
      if (VOIDED_FIXTURE_STATUSES.has(status)) return false;
      return Number.isFinite(Date.parse(String(fixture.kickoff || "")));
    })
    .map((fixture) => Date.parse(String(fixture.kickoff || "")))
    .sort((a, b) => a - b);
  return times[0] ?? null;
}

function normalizeTeamNameForCompare(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\butd\b/g, "united")
    .replace(/\bman\b/g, "manchester")
    .replace(/\b(fc|afc|cf|sc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function isFinalFixtureStatus(status?: string | null) {
  const s = String(status || "")
    .trim()
    .toUpperCase();
  return (
    s === "FINISHED" ||
    s === "FT" ||
    s === "AWARDED" ||
    s === "POSTPONED" ||
    s === "CANCELLED"
  );
}

function isFixtureLiveWindow(fixture: Fixture, nowMs: number) {
  const kickoffMs = Date.parse(String(fixture.kickoff || ""));
  if (!Number.isFinite(kickoffMs)) return false;
  if (kickoffMs > nowMs) return false;
  return !isFinalFixtureStatus(fixture.status);
}

function isExplicitLiveFixtureStatus(status?: string | null) {
  const raw = String(status || "").trim();
  const s = raw.toUpperCase();
  if (!raw) return false;
  if (s === "TIMED" || s === "SCHEDULED" || s === "NOT_STARTED" || s === "TBD")
    return false;
  if (s === "FINISHED" || s === "FT" || s === "AWARDED") return false;
  if (s === "CANCELLED" || s === "POSTPONED") return false;
  return true;
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
  if (raw.toUpperCase() === "LIVE") return "Live";
  return `Live - ${raw}`;
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

function fixtureTimeBucket(value: string) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? Math.round(ms / 60000) : null;
}

function overlayKeyForFixture(fixture: {
  kickoff: string;
  home?: { name?: string; shortName?: string; tla?: string | null };
  away?: { name?: string; shortName?: string; tla?: string | null };
}) {
  const kick = fixtureTimeBucket(fixture.kickoff);
  const home = normalizeTeamNameForCompare(
    fixture.home?.name || fixture.home?.shortName || fixture.home?.tla || "",
  );
  const away = normalizeTeamNameForCompare(
    fixture.away?.name || fixture.away?.shortName || fixture.away?.tla || "",
  );
  return `${kick ?? "na"}|${home}|${away}`;
}

function mergeFixtureResults(prev: Fixture[] | null, next: Fixture[]) {
  if (!prev?.length) return next;
  const prevById = new Map(prev.map((fixture) => [fixture.fixtureId, fixture]));
  return next.map((fixture) => {
    if (fixture.result != null) return fixture;
    const previous = prevById.get(fixture.fixtureId);
    if (!previous?.result) return fixture;
    return {
      ...fixture,
      result: previous.result,
    };
  });
}

function mergeFixtureLiveOverlay(
  prev: Fixture[] | null,
  overlay: LiveOverlayFixture[],
) {
  if (!prev?.length || !overlay.length) return prev;
  const overlayByKey = new Map(
    overlay.map((fixture) => [overlayKeyForFixture(fixture), fixture]),
  );

  return prev.map((fixture) => {
    const live = overlayByKey.get(overlayKeyForFixture(fixture));
    if (!live) return fixture;

    return {
      ...fixture,
      status: live.status || fixture.status,
      result: live.result ?? fixture.result,
      redCards: live.redCards ?? fixture.redCards ?? null,
    };
  });
}

function toInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function competitionAbbr(name?: string | null, code?: string | null) {
  const c = String(code || "").toUpperCase();
  if (c) return c;
  const words = String(name || "")
    .replace(/[^A-Za-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => !["the", "and", "of"].includes(word.toLowerCase()));
  if (words.length === 0) return "—";
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words
    .slice(0, 4)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("");
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

function isFixtureStartedForLineups(status?: string | null) {
  const s = String(status || "")
    .trim()
    .toUpperCase();
  if (!s) return false;
  if (
    s === "TIMED" ||
    s === "SCHEDULED" ||
    s === "NOT_STARTED" ||
    s === "TBD" ||
    s === "POSTPONED" ||
    s === "CANCELLED"
  ) {
    return false;
  }
  return true;
}

function playerMetaValue(player: MatchInfoPlayer, showRating: boolean) {
  if (showRating && player.rating != null) return player.rating.toFixed(1);
  return player.positionLabel || "—";
}

function substitutionSummary(player: MatchInfoPlayer) {
  const items = Array.isArray(player.substitutionEvents)
    ? player.substitutionEvents
    : [];
  if (!items.length) return null;
  return items
    .map((event) => {
      const type = String(event?.type || "").toLowerCase();
      const label =
        type === "subin"
          ? "ON"
          : type === "subout"
            ? "OFF"
            : type.toUpperCase();
      const time = Number.isFinite(Number(event?.time))
        ? `${Number(event?.time)}'`
        : "";
      return [label, time].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" • ");
}

function latestSubstitution(player: MatchInfoPlayer) {
  const items = Array.isArray(player.substitutionEvents)
    ? player.substitutionEvents
    : [];
  if (!items.length) return null;
  const event = items[items.length - 1];
  const type = String(event?.type || "").toLowerCase();
  return {
    type,
    time: Number.isFinite(Number(event?.time)) ? Number(event?.time) : null,
  };
}

function pitchDisplayName(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "Player";
  const last = parts[parts.length - 1];
  if (last.length <= 12) return last;
  if (parts.length >= 2) {
    const firstInitial = parts[0][0]?.toUpperCase() || "";
    return `${firstInitial}. ${last}`;
  }
  return last;
}

function parseFormationRows(formation?: string | null) {
  const nums = String(formation || "")
    .match(/\d+/g)
    ?.map((part) => Number(part))
    .filter((n) => Number.isFinite(n) && n > 0);
  return nums && nums.length ? nums : null;
}

function comparePitchSlot(a: MatchInfoPlayer, b: MatchInfoPlayer) {
  const aPos = Number(a.positionId);
  const bPos = Number(b.positionId);
  const aHasPos = Number.isFinite(aPos);
  const bHasPos = Number.isFinite(bPos);
  if (aHasPos && bHasPos && aPos !== bPos) return aPos - bPos;
  if (aHasPos !== bHasPos) return aHasPos ? -1 : 1;

  const aY = Number.isFinite(Number(a.layout?.y)) ? Number(a.layout?.y) : 0.5;
  const bY = Number.isFinite(Number(b.layout?.y)) ? Number(b.layout?.y) : 0.5;
  if (aY !== bY) return aY - bY;

  const aX = Number.isFinite(Number(a.layout?.x)) ? Number(a.layout?.x) : 0.5;
  const bX = Number.isFinite(Number(b.layout?.x)) ? Number(b.layout?.x) : 0.5;
  return aX - bX;
}

function buildFormationRows(
  players: MatchInfoPlayer[],
  formation?: string | null,
) {
  const formationRows = parseFormationRows(formation);
  const sorted = [...players].sort(comparePitchSlot);

  const keeperIndex = sorted.findIndex(
    (player) => player.positionLabel === "GK",
  );
  const keeper =
    keeperIndex >= 0 ? sorted[keeperIndex] : sorted.length ? sorted[0] : null;
  const outfield = sorted.filter((player) => player !== keeper);

  if (formationRows?.length) {
    const expectedOutfield = Math.max(0, players.length - (keeper ? 1 : 0));
    const formationTotal = formationRows.reduce((sum, value) => sum + value, 0);

    if (formationTotal === expectedOutfield) {
      const outRows: MatchInfoPlayer[][] = [];
      let cursor = 0;

      formationRows.forEach((count) => {
        const row = outfield.slice(cursor, cursor + count).sort((a, b) => {
          const aX = Number.isFinite(Number(a.layout?.x))
            ? Number(a.layout?.x)
            : 0.5;
          const bX = Number.isFinite(Number(b.layout?.x))
            ? Number(b.layout?.x)
            : 0.5;
          if (aX !== bX) return aX - bX;
          return comparePitchSlot(a, b);
        });
        cursor += count;
        outRows.push(row);
      });

      const rows = keeper ? [[keeper], ...outRows] : outRows;
      return rows.filter((row) => row.length > 0);
    }
  }

  const fallbackRows: MatchInfoPlayer[][] = [];
  if (keeper) fallbackRows.push([keeper]);
  const chunkSize = Math.max(2, Math.ceil(outfield.length / 3));
  for (let i = 0; i < outfield.length; i += chunkSize) {
    fallbackRows.push(outfield.slice(i, i + chunkSize));
  }
  return fallbackRows.filter((row) => row.length > 0);
}

function formationGridClasses(rowCount: number) {
  if (rowCount <= 1) return "grid-rows-1";
  if (rowCount === 2) return "grid-rows-2";
  if (rowCount === 3) return "grid-rows-3";
  if (rowCount === 4) return "grid-rows-4";
  if (rowCount === 5) return "grid-rows-5";
  return "grid-rows-6";
}

function formationRowRole(row: MatchInfoPlayer[]) {
  const counts = row.reduce<Record<string, number>>((acc, player) => {
    const role = String(player.positionLabel || "").toUpperCase();
    if (!role) return acc;
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});

  return (["DEF", "MID", "FWD", "GK"] as const).reduce<string | null>(
    (best, role) => {
      if ((counts[role] || 0) === 0) return best;
      if (!best) return role;
      return (counts[role] || 0) > (counts[best] || 0) ? role : best;
    },
    null,
  );
}

function formationFanOffsetPx(
  row: MatchInfoPlayer[],
  idx: number,
  side: "home" | "away",
  axis: "x" | "y",
) {
  if (row.length !== 5) return 0;
  if (idx !== 0 && idx !== row.length - 1) return 0;
  const role = formationRowRole(row);
  if (role !== "DEF" && role !== "MID") return 0;
  const magnitude = axis === "y" ? 14 : 12;
  return side === "home" ? magnitude : -magnitude;
}

function PitchMarker({
  player,
  showLiveRatings,
  isManOfTheMatch = false,
  crowded = false,
  size = "mobile",
}: {
  player: MatchInfoPlayer;
  showLiveRatings: boolean;
  isManOfTheMatch?: boolean;
  crowded?: boolean;
  size?: "mobile" | "desktop";
}) {
  const subEvent = latestSubstitution(player);
  const isCrowdedMobile = size === "mobile" && crowded;
  const markerSize = isCrowdedMobile
    ? "h-9 w-9"
    : size === "mobile"
      ? "h-10 w-10"
      : "h-11 w-11";
  const valueMinWidth = isCrowdedMobile
    ? "min-w-[34px]"
    : size === "mobile"
      ? "min-w-[40px]"
      : "min-w-[42px]";
  const shellWidthClass = isCrowdedMobile ? "w-[54px]" : "w-[66px] sm:w-[72px]";
  const nameTextClass = isCrowdedMobile ? "text-[8px]" : "text-[9px]";
  const tagTextClass = isCrowdedMobile ? "text-[7px]" : "text-[8px]";
  const ratingPillPosClass = isCrowdedMobile
    ? "-right-1.5 -top-[10px]"
    : "-right-2 -top-[10px]";
  const disciplinePosClass = isCrowdedMobile
    ? "-right-1 top-[42%]"
    : "-right-1.5 top-[42%]";
  const assistPosClass = isCrowdedMobile
    ? "-left-2.5 -bottom-1.5"
    : "-left-3 -bottom-1.5";
  const goalPosClass = isCrowdedMobile
    ? "-right-2.5 -bottom-1.5"
    : "-right-3 -bottom-1.5";
  const yellowCards = Math.max(0, Number(player.yellowCardCount || 0));
  const redCards = Math.max(0, Number(player.redCardCount || 0));
  const hasSecondYellowDismissal = redCards > 0 && yellowCards > 0;
  const goals = Math.max(0, Number(player.goalCount || 0));
  const ownGoals = Math.max(0, Number(player.ownGoalCount || 0));
  const hasGoalChip = goals > 0 || ownGoals > 0;
  const fallbackShirtNumber = String(player.shirtNumber || "—");

  return (
    <div className={`${shellWidthClass} text-center`}>
      <div
        className={[
          "relative mx-auto flex items-center justify-center rounded-full border border-subtle bg-surface shadow-[0_8px_18px_rgba(0,0,0,0.18)]",
          markerSize,
        ].join(" ")}
      >
        {player.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.photo}
            alt={player.name}
            className="h-full w-full rounded-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="font-display text-[10px] font-semibold text-foreground">
            {fallbackShirtNumber}
          </span>
        )}
        <span
          className={[
            `absolute ${ratingPillPosClass} inline-flex items-center justify-center rounded-full border px-1.5 py-0.5 font-display text-[9px] font-semibold tabular-nums`,
            isManOfTheMatch && showLiveRatings
              ? "border-sky-400/80 bg-surface-2 text-foreground shadow-[0_0_10px_rgba(56,189,248,0.35)]"
              : "border-subtle bg-surface-2 text-foreground",
            valueMinWidth,
          ].join(" ")}
        >
          <span className="relative inline-flex items-center justify-center overflow-visible">
            {playerMetaValue(player, showLiveRatings)}
            {isManOfTheMatch && showLiveRatings ? (
              <span className="absolute -right-2 top-1/2 -translate-y-1/2 text-sky-200">
                <Crown size={8} strokeWidth={2.2} />
              </span>
            ) : null}
          </span>
        </span>
        {redCards > 0 || yellowCards > 0 ? (
          <span
            className={`absolute ${disciplinePosClass} inline-flex -translate-y-1/2 items-center`}
          >
            {hasSecondYellowDismissal ? (
              <span className="relative inline-flex h-3 w-4 items-center">
                <span
                  className="absolute left-0 top-1/2 inline-flex h-3 w-2 -translate-y-1/2 items-center justify-center rounded-[2px] border border-yellow-200/80 bg-yellow-300/90 shadow-[0_2px_6px_rgba(0,0,0,0.2)]"
                  aria-label="Yellow card"
                  title="Yellow card"
                />
                <span
                  className="absolute left-1.5 top-1/2 z-[1] inline-flex h-3 w-2 -translate-y-1/2 items-center justify-center rounded-[2px] border border-red-300/75 bg-red-500/90 shadow-[0_2px_6px_rgba(0,0,0,0.2)]"
                  aria-label="Red card"
                  title="Red card"
                />
              </span>
            ) : redCards > 0 ? (
              <span
                className="inline-flex h-3 w-2 items-center justify-center rounded-[2px] border border-red-300/75 bg-red-500/90 shadow-[0_2px_6px_rgba(0,0,0,0.2)]"
                aria-label="Red card"
                title="Red card"
              />
            ) : (
              <span
                className="inline-flex h-3 w-2 items-center justify-center rounded-[2px] border border-yellow-200/80 bg-yellow-300/90 shadow-[0_2px_6px_rgba(0,0,0,0.2)]"
                aria-label="Yellow card"
                title="Yellow card"
              />
            )}
            {!hasSecondYellowDismissal && redCards > 1 ? (
              <span className="ml-0.5 font-display text-[8px] text-red-200 tabular-nums">
                {redCards}
              </span>
            ) : null}
            {!hasSecondYellowDismissal && redCards === 0 && yellowCards > 1 ? (
              <span className="ml-0.5 font-display text-[8px] text-yellow-100 tabular-nums">
                {yellowCards}
              </span>
            ) : null}
          </span>
        ) : null}
        {subEvent ? (
          <span className="absolute -left-2 -top-2 inline-flex flex-col items-center gap-0.5">
            {subEvent.time != null ? (
              <span className="font-display text-[8px] text-foreground tabular-nums">
                {subEvent.time}'
              </span>
            ) : null}
            <span
              className={[
                "inline-flex h-4 w-4 items-center justify-center rounded-full border",
                subEvent.type === "subin"
                  ? "border-emerald-400/80 bg-emerald-500/15 text-emerald-300"
                  : "border-red-400/80 bg-red-500/15 text-red-300",
              ].join(" ")}
            >
              {subEvent.type === "subin" ? (
                <ArrowDownLeft size={9} strokeWidth={2.5} />
              ) : (
                <ArrowUpLeft size={9} strokeWidth={2.5} />
              )}
            </span>
          </span>
        ) : null}
        {Number(player.assistCount || 0) > 0 ? (
          <span
            className={`absolute ${assistPosClass} inline-flex items-center gap-0.5 rounded-full border border-subtle bg-surface-2 px-1 py-0.5 font-display text-[8px] font-semibold text-sky-300 shadow-[0_3px_8px_rgba(0,0,0,0.22)]`}
          >
            <span className="tabular-nums">{player.assistCount}</span>
            <Footprints size={7} strokeWidth={2.1} />
          </span>
        ) : null}
        {hasGoalChip ? (
          <span
            className={`absolute ${goalPosClass} inline-flex items-center gap-1 rounded-full border border-subtle bg-surface-2 px-1 py-0.5 font-display text-[8px] font-semibold shadow-[0_3px_8px_rgba(0,0,0,0.22)]`}
          >
            {goals > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-emerald-300">
                <CircleDot size={7} strokeWidth={2.1} />
                <span className="tabular-nums">{goals}</span>
              </span>
            ) : null}
            {ownGoals > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-red-300">
                <CircleDot size={7} strokeWidth={2.1} />
                <span className="tabular-nums">{ownGoals}</span>
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="mt-1">
        <div className="relative min-h-[1.1em]">
          <div
            className={`font-display ${nameTextClass} absolute left-1/2 top-0 w-max max-w-none -translate-x-1/2 leading-tight text-center text-foreground whitespace-nowrap overflow-visible`}
          >
            {pitchDisplayName(player.name)}
          </div>
        </div>
        {player.statusTags?.slice(0, 1).map((tag) => (
          <div
            key={`tag-${player.id ?? player.name}-${tag}`}
            className={`mt-0.5 font-display ${tagTextClass} text-muted`}
          >
            {tag}
          </div>
        ))}
      </div>
    </div>
  );
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
  const [seasonCurrentGw, setSeasonCurrentGw] = useState<number | null>(null);
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
  const [predictionKeyOpen, setPredictionKeyOpen] = useState(false);
  const [displayModeOpen, setDisplayModeOpen] = useState(true);
  const [expandedFixtures, setExpandedFixtures] = useState<
    Record<number, boolean>
  >({});
  const [gameDataEnabled, setGameDataEnabled] = useState(true);
  const [gameModeStyle, setGameModeStyle] = useState<
    "round_robin" | "sprint" | "captain" | "league"
  >("sprint");
  const [bootstrapped, setBootstrapped] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableMode, setTableMode] = useState<TableMode>("TOTAL");
  const [tableView, setTableView] = useState<TableView>("FULL");
  const [tableRowsByMode, setTableRowsByMode] = useState<
    Record<TableMode, TableRow[]>
  >({
    HOME: [],
    TOTAL: [],
    AWAY: [],
  });
  const [tableError, setTableError] = useState<string | null>(null);
  const [tableAnimatingOut, setTableAnimatingOut] = useState(false);
  const tableSwapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [matchInfoOpen, setMatchInfoOpen] = useState(false);
  const [matchInfoFixtureId, setMatchInfoFixtureId] = useState<number | null>(
    null,
  );
  const [matchInfoTab, setMatchInfoTab] = useState<MatchInfoTab>("h2h");
  const [matchInfoLoading, setMatchInfoLoading] = useState(false);
  const [matchInfoError, setMatchInfoError] = useState<string | null>(null);
  const [matchInfoByFixture, setMatchInfoByFixture] = useState<
    Record<number, MatchInfoData>
  >({});
  const initialFixturesLoadDoneRef = useRef(false);
  const fixturesLoadSeqRef = useRef(0);
  const fixturesLoadTimerRef = useRef<number | null>(null);

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
    () =>
      matchInfoFixtureId != null
        ? (matchInfoByFixture[matchInfoFixtureId] ?? null)
        : null,
    [matchInfoByFixture, matchInfoFixtureId],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 640px)").matches) {
      setPredictionKeyOpen(true);
      setDisplayModeOpen(true);
    }
  }, []);

  const openMatchInfo = useCallback(
    async (fixture: Fixture) => {
      const fixtureId = fixture.fixtureId;
      const shouldForceRefresh =
        isExplicitLiveFixtureStatus(fixture.status) ||
        isFinalFixtureStatus(fixture.status);
      setMatchInfoFixtureId(fixtureId);
      setMatchInfoTab("lineups");
      setMatchInfoOpen(true);
      setMatchInfoError(null);

      if (matchInfoByFixture[fixtureId] && !shouldForceRefresh) return;
      if (!seasonKey) return;

      setMatchInfoLoading(true);
      try {
        const data = await getMatchInfoCached({
          fixtureId,
          seasonKey,
          kickoff: fixture.kickoff,
          homeTeam: {
            id: fixture.home?.id,
            name: fixture.home.name,
            tla: fixture.home?.tla || null,
            shortName: fixture.home?.shortName || null,
          },
          awayTeam: {
            id: fixture.away?.id,
            name: fixture.away.name,
            tla: fixture.away?.tla || null,
            shortName: fixture.away?.shortName || null,
          },
          force: shouldForceRefresh,
        });
        setMatchInfoByFixture((prev) => ({ ...prev, [fixtureId]: data }));
      } catch (e: unknown) {
        setMatchInfoError(
          e instanceof Error ? e.message : "Failed to load match info.",
        );
      } finally {
        setMatchInfoLoading(false);
      }
    },
    [matchInfoByFixture, seasonKey],
  );

  const selectedMatchFixture = useMemo(
    () =>
      matchInfoFixtureId != null
        ? ((fixtures ?? []).find((f) => f.fixtureId === matchInfoFixtureId) ??
          null)
        : null,
    [fixtures, matchInfoFixtureId],
  );
  const refreshMatchInfoFixture = useCallback(
    async (
      fixture: Fixture,
      options?: { showSpinner?: boolean; silent?: boolean },
    ) => {
      if (!seasonKey) return;
      const showSpinner = options?.showSpinner === true;
      const silent = options?.silent === true;
      if (showSpinner) setMatchInfoLoading(true);
      try {
        const data = await getMatchInfoCached({
          fixtureId: fixture.fixtureId,
          seasonKey,
          kickoff: fixture.kickoff,
          homeTeam: {
            id: fixture.home?.id,
            name: fixture.home.name,
            tla: fixture.home?.tla || null,
            shortName: fixture.home?.shortName || null,
          },
          awayTeam: {
            id: fixture.away?.id,
            name: fixture.away.name,
            tla: fixture.away?.tla || null,
            shortName: fixture.away?.shortName || null,
          },
          force: true,
        });
        setMatchInfoByFixture((prev) => ({
          ...prev,
          [fixture.fixtureId]: data,
        }));
        setMatchInfoError(null);
      } catch (e: unknown) {
        if (!silent) {
          setMatchInfoError(
            e instanceof Error ? e.message : "Failed to refresh match info.",
          );
        }
      } finally {
        if (showSpinner) setMatchInfoLoading(false);
      }
    },
    [seasonKey],
  );

  useEffect(() => {
    if (!matchInfoOpen || !selectedMatchFixture || !currentMatchInfo) return;
    if (!isExplicitLiveFixtureStatus(selectedMatchFixture.status)) return;

    let cancelled = false;

    const refresh = async () => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      )
        return;
      await refreshMatchInfoFixture(selectedMatchFixture, { silent: true });
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);

    const onVisible = () => {
      void refresh();
    };

    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [
    currentMatchInfo,
    matchInfoOpen,
    matchInfoTab,
    refreshMatchInfoFixture,
    selectedMatchFixture,
  ]);

  const fixtureList = fixtures ?? [];
  const displayFixtures = useMemo(() => {
    if (!fixtureList.length) return fixtureList;
    if (seasonCurrentGw == null || gw !== seasonCurrentGw) return fixtureList;

    const ranked = [...fixtureList];
    ranked.sort((a, b) => {
      const rank = (fixture: Fixture) => {
        if (isFixtureLiveWindow(fixture, nowMs)) return 0;
        if (!isFinalFixtureStatus(fixture.status)) return 1;
        return 2;
      };

      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;

      const aKickoff = Date.parse(String(a.kickoff || ""));
      const bKickoff = Date.parse(String(b.kickoff || ""));
      const aSafe = Number.isFinite(aKickoff)
        ? aKickoff
        : Number.MAX_SAFE_INTEGER;
      const bSafe = Number.isFinite(bKickoff)
        ? bKickoff
        : Number.MAX_SAFE_INTEGER;
      if (aSafe !== bSafe) return aSafe - bSafe;

      return a.fixtureId - b.fixtureId;
    });

    return ranked;
  }, [fixtureList, gw, nowMs, seasonCurrentGw]);
  const fixtureSections = useMemo(() => {
    const buckets = {
      live: [] as Fixture[],
      upcoming: [] as Fixture[],
      completed: [] as Fixture[],
    };

    for (const fixture of displayFixtures) {
      if (isFixtureLiveWindow(fixture, nowMs)) buckets.live.push(fixture);
      else if (isFinalFixtureStatus(fixture.status))
        buckets.completed.push(fixture);
      else buckets.upcoming.push(fixture);
    }

    return [
      { key: "live", label: "Live Now", items: buckets.live },
      {
        key: "upcoming",
        label:
          seasonCurrentGw != null && gw > seasonCurrentGw
            ? "Scheduled"
            : "Still to Play",
        items: buckets.upcoming,
        suffix: buckets.upcoming.length
          ? (() => {
              const nextKickoffMs = buckets.upcoming
                .map((fixture) => Date.parse(String(fixture.kickoff || "")))
                .filter((kickoffMs) => Number.isFinite(kickoffMs))
                .sort((a, b) => a - b)[0];
              if (!Number.isFinite(nextKickoffMs)) return null;
              const daysUntil = Math.max(
                0,
                Math.ceil((nextKickoffMs - nowMs) / 86_400_000),
              );
              return `${daysUntil} ${daysUntil === 1 ? "Day" : "Days"} Left`;
            })()
          : null,
      },
      { key: "completed", label: "Final Scores", items: buckets.completed },
    ].filter((section) => section.items.length > 0);
  }, [displayFixtures, gw, nowMs, seasonCurrentGw]);
  const liveFixtureCount = useMemo(
    () =>
      fixtureList.filter((fixture) => isFixtureLiveWindow(fixture, nowMs))
        .length,
    [fixtureList, nowMs],
  );
  const finishedFixtureCount = useMemo(
    () =>
      fixtureList.filter((fixture) => isFinalFixtureStatus(fixture.status))
        .length,
    [fixtureList],
  );
  const currentSlateLabel =
    liveFixtureCount > 0
      ? `${liveFixtureCount} live ${liveFixtureCount === 1 ? "match" : "matches"}`
      : finishedFixtureCount === fixtureList.length && fixtureList.length > 0
        ? "Round complete"
        : gw === seasonCurrentGw
          ? "Awaiting kickoff"
          : seasonCurrentGw != null && gw < seasonCurrentGw
            ? "Archived slate"
            : "Future slate";

  const h2hSummary = useMemo(() => {
    const rows = currentMatchInfo?.headToHead ?? [];
    const homeName = normalizeTeamNameForCompare(
      selectedMatchFixture?.home?.name,
    );
    const awayName = normalizeTeamNameForCompare(
      selectedMatchFixture?.away?.name,
    );
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

      const winnerName = normalizeTeamNameForCompare(
        h > a ? m.homeTeam?.name : m.awayTeam?.name,
      );
      if (homeName && winnerName === homeName) homeWins += 1;
      else if (awayName && winnerName === awayName) awayWins += 1;
    }

    return { homeWins, draws, awayWins };
  }, [
    currentMatchInfo?.headToHead,
    selectedMatchFixture?.away?.name,
    selectedMatchFixture?.home?.name,
  ]);

  const h2hTeamLabel = useCallback(
    (team: { name: string; tla?: string | null }) => {
      const teamName = normalizeTeamNameForCompare(team.name);
      const selectedHomeName = normalizeTeamNameForCompare(
        selectedMatchFixture?.home?.name,
      );
      const selectedAwayName = normalizeTeamNameForCompare(
        selectedMatchFixture?.away?.name,
      );

      if (teamName && teamName === selectedHomeName) {
        return teamAbbr({
          name: selectedMatchFixture?.home?.name || team.name,
          tla: selectedMatchFixture?.home?.tla || null,
          shortName: selectedMatchFixture?.home?.shortName || null,
        });
      }

      if (teamName && teamName === selectedAwayName) {
        return teamAbbr({
          name: selectedMatchFixture?.away?.name || team.name,
          tla: selectedMatchFixture?.away?.tla || null,
          shortName: selectedMatchFixture?.away?.shortName || null,
        });
      }

      return teamAbbr({
        name: team.name,
        tla: team.tla,
        shortName: null,
      });
    },
    [
      selectedMatchFixture?.away?.name,
      selectedMatchFixture?.away?.shortName,
      selectedMatchFixture?.away?.tla,
      selectedMatchFixture?.home?.name,
      selectedMatchFixture?.home?.shortName,
      selectedMatchFixture?.home?.tla,
    ],
  );

  const formTeamLabel = useCallback(
    (team: {
      name: string;
      tla?: string | null;
      shortName?: string | null;
    }) => {
      const teamName = normalizeTeamNameForCompare(team.name);
      const selectedHomeName = normalizeTeamNameForCompare(
        selectedMatchFixture?.home?.name,
      );
      const selectedAwayName = normalizeTeamNameForCompare(
        selectedMatchFixture?.away?.name,
      );

      if (teamName && teamName === selectedHomeName) {
        return teamAbbr({
          name: selectedMatchFixture?.home?.name || team.name,
          tla: selectedMatchFixture?.home?.tla || null,
          shortName: selectedMatchFixture?.home?.shortName || null,
        });
      }

      if (teamName && teamName === selectedAwayName) {
        return teamAbbr({
          name: selectedMatchFixture?.away?.name || team.name,
          tla: selectedMatchFixture?.away?.tla || null,
          shortName: selectedMatchFixture?.away?.shortName || null,
        });
      }

      return teamAbbr({
        name: team.name,
        tla: team.tla,
        shortName: team.shortName,
      });
    },
    [
      selectedMatchFixture?.away?.name,
      selectedMatchFixture?.away?.shortName,
      selectedMatchFixture?.away?.tla,
      selectedMatchFixture?.home?.name,
      selectedMatchFixture?.home?.shortName,
      selectedMatchFixture?.home?.tla,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await getRoomBootstrapCached(roomCode);
        const current = Number(data.currentGameweek ?? 1);
        const options = Array.isArray(data.seasonOptions)
          ? data.seasonOptions
          : [];
        const season = String(data.seasonKey || "");
        if (!cancelled) {
          setGw(Number.isFinite(current) ? current : 1);
          setSeasonCurrentGw(Number.isFinite(current) ? current : 1);
          setSeasonKey(season);
          setSeasonOptions(options.length ? options : season ? [season] : []);
          if (data.gameModeStyle) setGameModeStyle(data.gameModeStyle);
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

  useEffect(() => {
    return subscribeRoomMeta(
      roomCode,
      (roomMeta) => {
        if (roomMeta?.settings.gameModeStyle) {
          setGameModeStyle(roomMeta.settings.gameModeStyle);
        }
      },
      () => {},
    );
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
    setGameDataEnabled(true);
    setPicksByFixture({});
    setGoldenByUid({});
    setPowerupByUid({});
  }, [roomCode, gw, seasonKey]);

  useEffect(() => {
    if (refreshLockedUntil <= nowMs) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [refreshLockedUntil, nowMs]);

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
          displayName:
            String(p.nickName || "").trim() || p.displayName || "Player",
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
            a.displayName.localeCompare(b.displayName, undefined, {
              sensitivity: "base",
            }),
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
      const loadSeq = ++fixturesLoadSeqRef.current;

      if (showSpinner) setFixtures(null);
      setFixturesLoading(true);
      setError(null);

      if (!seasonKey) {
        if (loadSeq === fixturesLoadSeqRef.current) {
          setFixtures([]);
          setFixturesGeneratedAt(null);
          setFixturesRefreshedAt(new Date());
          setFixturesLoading(false);
        }
        return;
      }
      try {
        const data = force
          ? await refreshFixturesCached(gw, seasonKey)
          : await getFixturesCached(gw, seasonKey);
        if (loadSeq !== fixturesLoadSeqRef.current) return;
        const fx: Fixture[] = Array.isArray(data.fixtures) ? data.fixtures : [];
        setFixtures((prev) => mergeFixtureResults(prev, fx));
        setFixturesGeneratedAt(asDate(data.generatedAt));
        setFixturesRefreshedAt(new Date());
      } finally {
        if (loadSeq === fixturesLoadSeqRef.current) {
          setFixturesLoading(false);
        }
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
    if (fixturesLoadTimerRef.current) {
      window.clearTimeout(fixturesLoadTimerRef.current);
      fixturesLoadTimerRef.current = null;
    }
    const delayMs = initialFixturesLoadDoneRef.current ? 10 : 0;
    fixturesLoadTimerRef.current = window.setTimeout(() => {
      if (cancelled) return;
      initialFixturesLoadDoneRef.current = true;
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
      fixturesLoadTimerRef.current = null;
    }, delayMs);

    return () => {
      cancelled = true;
      if (fixturesLoadTimerRef.current) {
        window.clearTimeout(fixturesLoadTimerRef.current);
        fixturesLoadTimerRef.current = null;
      }
    };
  }, [bootstrapped, gw, loadFixtures]);

  // Load minigame picks + golden for selected GW
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!gameDataEnabled || !seasonKey) return;
      setError(null);
      setPicksByFixture({});
      setGoldenByUid({});
      setPowerupByUid({});
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
        const t = String(data.powerupType || "").toUpperCase();
        if (t !== "ALL_IN" && t !== "SAFETY_NET") continue;
        pByUid[data.uid] = {
          fixtureId: Number(data.fixtureId),
          powerupType: t as "ALL_IN" | "SAFETY_NET",
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
  }, [gameDataEnabled, roomCode, gw, seasonKey]);

  const isLoading = fixtures === null || fixturesLoading;
  const navLoading = !bootstrapped;
  const leaguePicksRevealed = useMemo(() => {
    if (gameModeStyle !== "league") return true;
    const firstKickoffMs = firstScheduledKickoffMs(fixtures ?? []);
    if (firstKickoffMs == null) return false;
    return nowMs >= firstKickoffMs - LEAGUE_LOCK_WINDOW_MS;
  }, [fixtures, gameModeStyle, nowMs]);
  const leagueWeekScores = useMemo(() => {
    if (gameModeStyle !== "league") return [];
    return players
      .map((player) => {
        let points = 0;
        let exacts = 0;
        let results = 0;
        let graded = 0;
        for (const fixture of fixtures ?? []) {
          const actual = String(fixture.result || "").trim();
          if (!actual) continue;
          const pred = picksByFixture[fixture.fixtureId]?.[player.uid] ?? "";
          const pts = getBasePointsFromScores(pred, actual);
          const tier = classifyPredictionTier(pred, actual);
          graded += 1;
          points += pts;
          if (tier === "exact") exacts += 1;
          else if (tier === "result") results += 1;
        }
        return {
          uid: player.uid,
          displayName: player.displayName,
          points,
          exacts,
          results,
          graded,
        };
      })
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return a.displayName.localeCompare(b.displayName, undefined, {
          sensitivity: "base",
        });
      });
  }, [fixtures, gameModeStyle, picksByFixture, players]);
  const leagueHasGradedResults = leagueWeekScores.some(
    (entry) => entry.graded > 0,
  );
  const refreshLockSeconds = Math.max(
    0,
    Math.ceil((refreshLockedUntil - nowMs) / 1000),
  );

  async function refreshFixtures() {
    if (refreshingFixtures || refreshLockSeconds > 0) return;
    if (fixturesLoadTimerRef.current) {
      window.clearTimeout(fixturesLoadTimerRef.current);
      fixturesLoadTimerRef.current = null;
    }
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
    const currentExpanded = expandedFixtures[fixtureId] ?? !compactMode;
    const nextExpanded = !currentExpanded;

    if (nextExpanded) {
      setGameDataEnabled(true);
    }

    setExpandedFixtures((prev) => ({
      ...prev,
      [fixtureId]: nextExpanded,
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
      setSeasonCurrentGw(Number.isFinite(current) ? current : 1);
      setGw(Number.isFinite(current) ? current : 1);
    } catch {
      setSeasonCurrentGw(1);
      setGw(1);
    }
  }

  useEffect(() => {
    if (!bootstrapped || !seasonKey) return;

    let cancelled = false;
    let liveRefreshInterval: number | null = null;
    let nextKickoffTimer: number | null = null;

    const syncCurrentGw = async () => {
      try {
        const prevCurrent = seasonCurrentGw;
        const data = await getCurrentGameweekCached(seasonKey);
        if (cancelled) return;
        const nextCurrent = Number(data.currentGameweek ?? 1);
        if (!Number.isFinite(nextCurrent)) return;
        setSeasonCurrentGw(nextCurrent);
        if (
          prevCurrent != null &&
          gw === prevCurrent &&
          nextCurrent !== prevCurrent
        ) {
          setGw(nextCurrent);
        }
      } catch {
        // Leave the current GW pinned if the refresh fails.
      }
    };

    const softRefreshLive = async () => {
      if (cancelled || refreshingFixtures || matchInfoOpen || tableOpen) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      )
        return;
      if (seasonCurrentGw != null && gw !== seasonCurrentGw) return;

      try {
        const params = new URLSearchParams({
          seasonKey,
          gameweek: String(gw),
        });
        const response = await fetch(`/api/live-preview?${params.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json().catch(() => ({}))) as {
          fixtures?: LiveOverlayFixture[];
        };
        const liveFixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
        if (!liveFixtures.length) return;
        setFixtures((prev) => mergeFixtureLiveOverlay(prev, liveFixtures));
        setFixturesRefreshedAt(new Date());
      } catch {
        // Keep the current snapshot on live overlay refresh failures.
      }
    };

    const resetLiveSchedule = () => {
      if (liveRefreshInterval) {
        window.clearInterval(liveRefreshInterval);
        liveRefreshInterval = null;
      }
      if (nextKickoffTimer) {
        window.clearTimeout(nextKickoffTimer);
        nextKickoffTimer = null;
      }
    };

    const scheduleLivePolling = () => {
      resetLiveSchedule();
      if (
        cancelled ||
        refreshingFixtures ||
        matchInfoOpen ||
        tableOpen ||
        (typeof document !== "undefined" &&
          document.visibilityState !== "visible") ||
        seasonCurrentGw == null ||
        gw !== seasonCurrentGw ||
        !fixtures?.length
      ) {
        return;
      }

      const now = Date.now();
      const hasLiveFixture = fixtures.some((fixture) =>
        isFixtureLiveWindow(fixture, now),
      );
      if (hasLiveFixture) {
        liveRefreshInterval = window.setInterval(() => {
          void softRefreshLive();
        }, 1000);
        return;
      }

      const nextKickoffMs = fixtures
        .map((fixture) => Date.parse(String(fixture.kickoff || "")))
        .filter((kickoffMs) => Number.isFinite(kickoffMs) && kickoffMs > now)
        .sort((a, b) => a - b)[0];

      if (!Number.isFinite(nextKickoffMs)) return;
      const waitMs = Math.max(
        250,
        Math.min(nextKickoffMs - now + 500, 2_147_000_000),
      );
      nextKickoffTimer = window.setTimeout(() => {
        void softRefreshLive();
      }, waitMs);
    };

    const onVisible = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      )
        return;
      void syncCurrentGw();
      void softRefreshLive();
      scheduleLivePolling();
    };
    const currentGwInterval = window.setInterval(() => {
      void syncCurrentGw();
    }, 60000);
    scheduleLivePolling();

    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      resetLiveSchedule();
      window.clearInterval(currentGwInterval);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [
    bootstrapped,
    seasonKey,
    seasonCurrentGw,
    gw,
    refreshingFixtures,
    matchInfoOpen,
    tableOpen,
    fixtures,
  ]);

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

  const standardSectionCardClass =
    "rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5";

  return (
    <PageShell
      width="wide"
      shellChrome={false}
      outerClassName="min-h-0 px-2 pb-0 pt-0 bg-app sm:px-3 sm:pb-0 sm:pt-0"
      contentClassName="relative z-[1]"
    >
      <SectionStack gap="page">
        <TopActionRow
            title="Fixtures"
            subtitle={`${roomCode} • ${seasonLabel(seasonKey || "----")}`}
            className="flex items-start justify-between gap-3 sm:items-end"
            actions={
              <div className="ml-auto flex gap-1">
                <button
                  onClick={refreshFixtures}
                  disabled={refreshingFixtures || refreshLockSeconds > 0}
                  className="page-action-btn inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-foreground shadow-[0_10px_24px_rgba(3,8,20,0.16)] transition hover:bg-white/[0.06] disabled:opacity-60"
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
                />
              </div>
            }
          />

        <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.014))] p-1">
          <div className="rounded-[24px] border border-white/6 bg-[radial-gradient(circle_at_top_right,rgba(var(--room-accent-rgb),0.1),transparent_38%),linear-gradient(180deg,rgba(5,10,22,0.92),rgba(7,10,18,0.88))] px-4 py-4 sm:px-5 sm:py-5">
            <SectionStack gap="tight">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1.5">
                  <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white/42">
                    Matchday desk
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/72">
                      Viewing slate
                    </span>
                    <span className="font-display text-[1.5rem] font-semibold text-foreground sm:text-[1.75rem]">
                      GW {gw}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/6 pt-3">
                <span className="text-[0.72rem] font-medium uppercase tracking-[0.16em] text-white/42">
                  Fixture ledger
                </span>
                <span className="font-display text-sm font-semibold text-foreground">
                  {gw === seasonCurrentGw
                    ? "Current matchweek"
                    : seasonCurrentGw != null && gw < seasonCurrentGw
                      ? "Previous matchweek"
                      : "Upcoming matchweek"}
                </span>
              </div>
              <div className="grid gap-1 sm:grid-cols-1">
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="text-[0.62rem] uppercase tracking-[0.16em] text-white/38">
                    Completed
                  </div>
                  <div className="mt-1 font-display text-xl font-semibold text-foreground">
                    {finishedFixtureCount} / {fixtureList.length || 0}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    Finalised scorelines on this slate.
                  </div>
                </div>
              </div>

              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                    Prediction key
                  </div>
                  <div className="mt-1 text-sm text-muted">
                    Quick legend for result tones and chip outlines.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPredictionKeyOpen((open) => !open)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-1.5 font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/72 transition hover:border-white/18 hover:text-foreground"
                  aria-expanded={predictionKeyOpen}
                  aria-label={
                    predictionKeyOpen
                      ? "Collapse prediction key"
                      : "Expand prediction key"
                  }
                >
                  <span>{predictionKeyOpen ? "Close" : "Open"}</span>
                  <ChevronDown
                    size={14}
                    className={[
                      "transition-transform duration-200 ease-out",
                      predictionKeyOpen ? "rotate-180" : "",
                    ].join(" ")}
                  />
                </button>
              </div>
              <div
                className={[
                  "grid overflow-hidden transition-[grid-template-rows,opacity,transform,margin] duration-300 ease-out",
                  predictionKeyOpen
                    ? "mt-2 grid-rows-[1fr] opacity-100 translate-y-0"
                    : "mt-0 grid-rows-[0fr] opacity-0 -translate-y-1 pointer-events-none",
                ].join(" ")}
              >
                <div
                  className={[
                    "min-h-0 overflow-hidden transition-all duration-300 ease-out",
                    predictionKeyOpen
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 translate-y-1",
                  ].join(" ")}
                >
                  <div className="grid grid-cols-1 gap-2.5 pt-1 lg:grid-cols-2 2xl:grid-cols-3">
                    <div className="rounded-[20px] border border-emerald-300/18 bg-[linear-gradient(135deg,rgba(16,185,129,0.1),rgba(6,12,28,0.9))] p-[1px] shadow-[0_14px_32px_rgba(2,6,20,0.2)]">
                      <div className="relative overflow-hidden rounded-[19px] bg-[linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.014))] px-3.5 py-3">
                        <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-gradient-to-b from-emerald-200 via-emerald-300 to-emerald-500/20" />
                        <div className="pl-3">
                          <div className="font-display text-[0.88rem] font-semibold text-foreground">
                            Correct Result
                          </div>
                          <div className="mt-1 text-[0.72rem] leading-5 text-white/48">
                            Winner or draw called correctly
                            {gameModeStyle === "league" ? " · 1 point" : "."}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-purple-300/18 bg-[linear-gradient(135deg,rgba(168,85,247,0.1),rgba(6,12,28,0.9))] p-[1px] shadow-[0_14px_32px_rgba(2,6,20,0.2)]">
                      <div className="relative overflow-hidden rounded-[19px] bg-[linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.014))] px-3.5 py-3">
                        <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-gradient-to-b from-purple-200 via-purple-300 to-purple-500/20" />
                        <div className="pl-3">
                          <div className="font-display text-[0.88rem] font-semibold text-foreground">
                            Exact Score
                          </div>
                          <div className="mt-1 text-[0.72rem] leading-5 text-white/48">
                            Full scoreline landed exactly
                            {gameModeStyle === "league" ? " · 2 points" : "."}
                          </div>
                        </div>
                      </div>
                    </div>
                    {gameModeStyle === "league" ? null : (
                      <div className="rounded-[20px] border border-cyan-300/18 bg-[linear-gradient(135deg,rgba(34,211,238,0.095),rgba(6,12,28,0.9))] p-[1px] shadow-[0_14px_32px_rgba(2,6,20,0.2)]">
                        <div className="relative overflow-hidden rounded-[19px] bg-[linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.014))] px-3.5 py-3">
                          <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-gradient-to-b from-cyan-200 via-cyan-300 to-cyan-500/20" />
                          <div className="pl-3">
                            <div className="font-display text-[0.88rem] font-semibold text-foreground">
                              Powerup Hit
                            </div>
                            <div className="mt-1 text-[0.72rem] leading-5 text-white/48">
                              Chip override landed.
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="rounded-[20px] border border-red-300/16 bg-[linear-gradient(135deg,rgba(248,113,113,0.085),rgba(6,12,28,0.9))] p-[1px] shadow-[0_14px_32px_rgba(2,6,20,0.2)]">
                      <div className="relative overflow-hidden rounded-[19px] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.012))] px-3.5 py-3">
                        <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-gradient-to-b from-red-200/75 via-red-300/55 to-red-500/10" />
                        <div className="pl-3">
                          <div className="font-display text-[0.88rem] font-semibold text-foreground">
                            Miss
                          </div>
                          <div className="mt-1 text-[0.72rem] leading-5 text-white/48">
                            {gameModeStyle === "league"
                              ? "Wrong result · 0 points"
                              : "No points landed on the fixture."}
                          </div>
                        </div>
                      </div>
                    </div>
                    {gameModeStyle === "league" ? null : (
                      <div className="rounded-[20px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(6,12,28,0.9))] p-[1px] shadow-[0_14px_32px_rgba(2,6,20,0.2)] lg:col-span-2 2xl:col-span-1">
                        <div className="rounded-[19px] bg-[linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.014))] px-3.5 py-3">
                          <div className="font-display text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-white/45">
                            Chips
                          </div>
                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <span className="inline-flex items-center justify-center rounded-[12px] border border-yellow-300/65 bg-yellow-300/[0.06] px-2.5 py-1.5 font-display text-[0.82rem] text-foreground shadow-[0_0_0_1px_rgba(250,204,21,0.16)_inset]">
                              Golden Pick
                            </span>
                            <span className="inline-flex items-center justify-center rounded-[12px] border border-amber-500/45 bg-amber-500/[0.035] px-2.5 py-1.5 font-display text-[0.82rem] text-foreground shadow-[0_0_0_1px_rgba(217,119,6,0.1)_inset]">
                              All-In
                            </span>
                            <span className="inline-flex items-center justify-center rounded-[12px] border border-sky-600/45 bg-sky-950/30 px-2.5 py-1.5 font-display text-[0.82rem] text-foreground shadow-[0_0_0_1px_rgba(2,132,199,0.12)_inset]">
                              Safety Net
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </SectionStack>
          </div>
        </SectionCard>

        {gameModeStyle === "league" ? (
          <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                  League scoring
                </div>
                <div className="mt-1 font-display text-xl font-semibold text-foreground">
                  GW {gw} points
                </div>
                <div className="mt-1 text-sm text-muted">
                  Exact score 2 points · correct result 1 point · miss 0.
                </div>
              </div>
            </div>
            {!leaguePicksRevealed ? (
              <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-muted">
                Scores stay hidden until 30 minutes before the first kickoff.
              </div>
            ) : !leagueHasGradedResults ? (
              <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-muted">
                Waiting on finished fixtures to grade this gameweek.
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {leagueWeekScores.map((entry, index) => (
                  <div
                    key={entry.uid}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-display font-semibold text-foreground">
                        {index + 1}. {entry.displayName}
                        {entry.uid === user?.uid ? (
                          <span className="ml-2 text-[0.62rem] uppercase tracking-[0.14em] text-white/45">
                            You
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {entry.exacts} exact · {entry.results} result
                      </div>
                    </div>
                    <div className="shrink-0 font-display text-lg font-semibold text-foreground">
                      {entry.points}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        ) : null}

        {error && (
          <SectionCard className={standardSectionCardClass}>
            <div className="text-sm text-rose-300">{error}</div>
          </SectionCard>
        )}

        {/* Fixtures */}

        <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-1">
          <div className="rounded-[24px] border border-white/6 bg-[linear-gradient(180deg,rgba(6,10,20,0.9),rgba(7,11,18,0.86))] px-4 py-4 sm:px-5 sm:py-5">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,220px)_minmax(0,1fr)_minmax(0,220px)] xl:items-start">
              <div className="w-full rounded-[20px] border border-white/7 bg-white/[0.02] px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                {!!seasonOptions.length ? (
                  <FixturesSelectField
                    id="fixtures-season-select"
                    label="Season"
                    value={seasonKey}
                    onChange={onSeasonChange}
                  >
                    {seasonOptions.map((s) => (
                      <option key={s} value={s}>
                        {seasonLabel(s)}
                      </option>
                    ))}
                  </FixturesSelectField>
                ) : (
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.02] px-4 py-3.5">
                    <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                      Season
                    </div>
                    <div className="mt-2 font-display text-sm font-semibold text-foreground">
                      {seasonLabel(seasonKey || "----")}
                    </div>
                  </div>
                )}
              </div>
              <div className="min-w-0 rounded-[20px] border border-white/7 bg-white/[0.02] px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                <div className="space-y-2">
                  <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                    Matchweek selector
                  </div>
                  <GameweekNavigator
                    value={gw}
                    min={MIN_GW}
                    max={MAX_GW}
                    disabled={navLoading}
                    onChange={setGw}
                    buttonClassName="flex h-[clamp(2.75rem,3vw,3rem)] w-[clamp(2.75rem,3vw,3rem)] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] p-0 text-foreground shadow-[0_10px_24px_rgba(3,8,20,0.14)] transition hover:bg-white/[0.06] disabled:opacity-40"
                    selectClassName="h-[clamp(2.75rem,3vw,3rem)] w-full appearance-none rounded-2xl border border-white/10 bg-white/[0.035] px-8 font-display text-[clamp(0.9rem,1vw,1rem)] font-semibold text-foreground outline-none [text-align-last:center]"
                  />
                </div>
              </div>
              <div className="w-full rounded-[20px] border border-white/7 bg-white/[0.02] px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                <div className="space-y-2">
                  <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                    Predictions
                  </div>
                  <button
                    type="button"
                    onClick={() => setCompactModeValue(!compactMode)}
                    className="inline-flex w-full items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:border-white/18 hover:text-foreground"
                  >
                    {compactMode ? "View All" : "Hide All"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
        <SectionStack gap="fixture">
          {isLoading && (
            <SectionCard className={standardSectionCardClass}>
              <div className="inline-flex w-full items-center justify-center gap-2 text-sm text-muted">
                <Loader2 size={14} className="animate-spin" />
                <span>Loading fixtures…</span>
              </div>
            </SectionCard>
          )}

          {!isLoading && fixtures.length === 0 && (
            <SectionCard className={standardSectionCardClass}>
              <div className="text-center text-sm text-muted">
                No fixtures available for this gameweek.
              </div>
            </SectionCard>
          )}

          {!isLoading &&
            displayFixtures.length > 0 &&
            (() => {
              const renderFixtureCard = (f: Fixture, idx: number) => {
                const actual = f.result ?? null;
                const fixtureStatusHeading = statusHeading(f.status);
                const kickoffParts = formatKickoffParts(f.kickoff);
                const isExpanded =
                  expandedFixtures[f.fixtureId] ?? !compactMode;
                const homeColor = colorForTeam(
                  f.home.tla,
                  f.home.shortName,
                  f.home.name,
                );
                const awayColor = colorForTeam(
                  f.away.tla,
                  f.away.shortName,
                  f.away.name,
                );
                const clashBgStyle: React.CSSProperties = {
                  backgroundImage: `linear-gradient(125deg, ${hexToRgba(homeColor, 0.14)} 0%, rgba(8,12,24,0.92) 32%, rgba(8,12,24,0.94) 68%, ${hexToRgba(awayColor, 0.14)} 100%)`,
                };

                return (
                  <div
                    key={f.fixtureId}
                    className="fixture-card-enter space-y-[6px] sm:space-y-[8px] w-full"
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
                          <div>
                            <div className="mb-2 text-[clamp(0.72rem,0.95vw,0.9rem)] text-muted">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-display font-semibold">
                                  {kickoffParts.dayNum}
                                  <sup className="ml-[1px] text-[9px]">
                                    {kickoffParts.suffix}
                                  </sup>{" "}
                                  {kickoffParts.monthYear}
                                </span>
                                <span className="font-display font-semibold">
                                  {kickoffParts.time}
                                </span>
                              </div>
                            </div>

                            <div className="sm:hidden">
                              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                                <div className="flex min-w-0 flex-col items-center text-center">
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
                                <span className="inline-flex items-center justify-center font-display text-[10px] font-semibold uppercase text-muted">
                                  vs
                                </span>
                                <div className="flex min-w-0 flex-col items-center text-center">
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

                            <div className="hidden grid-cols-[1fr_auto_1fr] items-center gap-3 sm:grid">
                              <div className="flex min-w-0 flex-col items-center text-center">
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
                              <span className="inline-flex h-full items-center justify-center self-center font-display text-xs font-semibold uppercase text-muted">
                                vs
                              </span>
                              <div className="flex min-w-0 flex-col items-center text-center">
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

                          <div className="rounded-[22px] border border-white/6 bg-black/18 px-3 py-3 backdrop-blur-[10px]">
                            <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/6 pb-2">
                              <span className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                                Fixture board
                              </span>
                              <span className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/34">
                                {fixtureStatusHeading}
                              </span>
                            </div>
                            <div className="space-y-3">
                              <div className="relative mx-auto flex min-h-[28px] w-full max-w-[180px] items-center justify-center font-display text-[clamp(1rem,1.5vw,1.3rem)] font-semibold text-foreground tabular-nums">
                                {Number(f.redCards?.home || 0) > 0 ? (
                                  <span className="absolute left-0 inline-flex items-center gap-1 rounded-full border border-red-300/70 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-200">
                                    <span className="inline-block h-3 w-2 rounded-[2px] border border-red-300/70 bg-red-500/90" />
                                    <span>{f.redCards?.home}</span>
                                  </span>
                                ) : null}
                                <span className="inline-block text-center">
                                  {displayResult(f.status, actual)}
                                </span>
                                {Number(f.redCards?.away || 0) > 0 ? (
                                  <span className="absolute right-0 inline-flex items-center gap-1 rounded-full border border-red-300/70 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-200">
                                    <span>{f.redCards?.away}</span>
                                    <span className="inline-block h-3 w-2 rounded-[2px] border border-red-300/70 bg-red-500/90" />
                                  </span>
                                ) : null}
                              </div>

                              {SHOW_MATCH_INFO ? (
                                <div className="flex items-center justify-center text-xs text-muted">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openMatchInfo(f);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-xl border border-white/8 bg-white/[0.04] px-3 py-1.5 text-foreground shadow-[0_10px_24px_rgba(3,8,20,0.16)] transition hover:bg-white/[0.06]"
                                  >
                                    <Info size={12} />
                                    Match Info
                                  </button>
                                </div>
                              ) : null}

                              <div
                                className="flex cursor-pointer items-center justify-between gap-2 rounded-2xl border border-white/6 bg-black/16 px-3 py-2 text-[11px] text-muted transition-colors duration-200 hover:bg-white/[0.03]"
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                  toggleFixtureExpanded(f.fixtureId)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggleFixtureExpanded(f.fixtureId);
                                  }
                                }}
                              >
                                <span className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/46">
                                  {isExpanded ? "Hide" : "Show"} Predictions
                                </span>
                                <ChevronDown
                                  size={14}
                                  className={`shrink-0 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
                                />
                              </div>
                            </div>
                          </div>

                          <div
                            className={[
                              "grid overflow-hidden transition-[grid-template-rows,opacity,transform,margin-top] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                              isExpanded
                                ? "mt-3 grid-rows-[1fr] opacity-100 translate-y-0"
                                : "mt-0 grid-rows-[0fr] opacity-0 -translate-y-1 pointer-events-none",
                            ].join(" ")}
                          >
                            <div
                              className={[
                                "min-h-0 overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                                isExpanded
                                  ? "opacity-100 translate-y-0"
                                  : "opacity-0 translate-y-1",
                              ].join(" ")}
                            >
                              <div className="rounded-[22px] border border-white/6 bg-black/18 px-3 py-3 backdrop-blur-[10px]">
                                <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/6 pb-2">
                                  <span className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                                    Prediction board
                                  </span>
                                  <span className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/34">
                                    {players.length}{" "}
                                    {players.length === 1
                                      ? "player"
                                      : "players"}
                                  </span>
                                </div>
                                {players.length === 0 ? (
                                  <div className="text-sm text-muted">
                                    No players found.
                                  </div>
                                ) : (
                                  <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(92px,1fr))] gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(104px,1fr))]">
                                    {players.map((p) => {
                                      const pred =
                                        picksByFixture?.[f.fixtureId]?.[
                                          p.uid
                                        ] ?? "";
                                      const hideOtherPick =
                                        gameModeStyle === "league" &&
                                        !leaguePicksRevealed &&
                                        p.uid !== user?.uid;
                                      const golden = hideOtherPick
                                        ? undefined
                                        : goldenByUid[p.uid];
                                      const isGolden =
                                        !!golden &&
                                        golden.fixtureId === f.fixtureId &&
                                        golden.score === pred;
                                      const powerup = hideOtherPick
                                        ? undefined
                                        : powerupByUid[p.uid];
                                      const powerupType =
                                        powerup &&
                                        powerup.locked &&
                                        powerup.fixtureId === f.fixtureId
                                          ? powerup.powerupType
                                          : null;
                                      const powerupTypeClass =
                                        powerupType === "ALL_IN"
                                          ? "!border-amber-500/70 shadow-[inset_0_0_0_1px_rgba(217,119,6,0.32),0_8px_18px_rgba(120,53,15,0.16)]"
                                          : powerupType === "SAFETY_NET"
                                            ? "!border-sky-600/75 shadow-[inset_0_0_0_1px_rgba(2,132,199,0.34),0_8px_18px_rgba(8,47,73,0.18)]"
                                            : "";
                                      const predNorm = String(
                                        pred || "",
                                      ).trim();
                                      const actualNorm = String(
                                        actual || "",
                                      ).trim();
                                      const hasScoredResult =
                                        !hideOtherPick && actualNorm.length > 0;
                                      const fixturePoints =
                                        hideOtherPick || !hasScoredResult
                                          ? null
                                          : getBasePointsFromScores(
                                              predNorm,
                                              actualNorm,
                                            );
                                      const predictionTier = hasScoredResult
                                        ? classifyPredictionTier(
                                            predNorm,
                                            actualNorm,
                                          )
                                        : null;
                                      const isExact =
                                        predictionTier === "exact";
                                      const isOutcomeOnly =
                                        predictionTier === "result";
                                      const powerupVisualState = hasScoredResult
                                        ? getPowerupVisualState({
                                            powerupType,
                                            predictionTier,
                                          })
                                        : null;
                                      const powerupHitToneClass =
                                        "key-chip border-cyan-300/75 bg-[linear-gradient(145deg,rgba(34,211,238,0.24),rgba(9,12,26,0.9)_58%,rgba(9,12,26,0.88))] shadow-[0_0_0_1px_rgba(34,211,238,0.22)_inset,0_12px_22px_rgba(34,211,238,0.12)]";
                                      const powerupMissToneClass =
                                        "key-chip border-red-300/45 bg-[linear-gradient(145deg,rgba(248,113,113,0.16),rgba(9,12,26,0.92)_58%,rgba(9,12,26,0.9))] shadow-[0_0_0_1px_rgba(248,113,113,0.14)_inset,0_12px_22px_rgba(127,29,29,0.16)]";
                                      const neutralToneClass =
                                        "border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.04),rgba(7,12,24,0.92)_58%,rgba(7,12,24,0.88))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_28px_rgba(2,6,20,0.18)]";
                                      const toneClass = !hasScoredResult
                                        ? neutralToneClass
                                        : powerupType === "ALL_IN"
                                          ? powerupVisualState === "powerup_hit"
                                            ? powerupHitToneClass
                                            : powerupMissToneClass
                                          : powerupVisualState === "powerup_hit"
                                            ? powerupHitToneClass
                                            : isExact
                                              ? "key-chip key-chip-exact border-purple-300/75 bg-[linear-gradient(145deg,rgba(168,85,247,0.24),rgba(9,12,26,0.9)_58%,rgba(9,12,26,0.88))] shadow-[0_0_0_1px_rgba(216,180,254,0.2)_inset,0_12px_24px_rgba(168,85,247,0.15)]"
                                              : isOutcomeOnly
                                                ? "key-chip key-chip-result border-emerald-300/75 bg-[linear-gradient(145deg,rgba(16,185,129,0.24),rgba(9,12,26,0.9)_58%,rgba(9,12,26,0.88))] shadow-[0_0_0_1px_rgba(110,231,183,0.2)_inset,0_12px_24px_rgba(16,185,129,0.15)]"
                                                : powerupMissToneClass;
                                      const accentBarClass =
                                        powerupVisualState === "powerup_hit"
                                          ? "from-cyan-200 via-cyan-300 to-cyan-500/20"
                                          : powerupVisualState ===
                                              "powerup_miss"
                                            ? "from-red-200/80 via-red-300/60 to-red-500/12"
                                            : isExact
                                              ? "from-purple-200 via-purple-300 to-purple-500/20"
                                              : isOutcomeOnly
                                                ? "from-emerald-200 via-emerald-300 to-emerald-500/20"
                                                : hasScoredResult &&
                                                    predictionTier === "miss"
                                                  ? "from-red-200/80 via-red-300/60 to-red-500/12"
                                                  : powerupType === "ALL_IN"
                                                    ? "from-amber-200/75 via-amber-400/45 to-amber-700/16"
                                                    : powerupType ===
                                                        "SAFETY_NET"
                                                      ? "from-sky-300/70 via-sky-600/35 to-sky-900/18"
                                                      : isGolden
                                                        ? "from-yellow-200 via-yellow-300 to-yellow-500/18"
                                                        : "from-white/24 via-white/10 to-transparent";
                                      const scoreBadgeClass = !hasScoredResult
                                        ? "text-foreground"
                                        : powerupVisualState === "powerup_hit"
                                          ? "text-cyan-100"
                                          : powerupVisualState ===
                                              "powerup_miss"
                                            ? "text-red-100"
                                            : isExact
                                              ? "text-purple-100"
                                              : isOutcomeOnly
                                                ? "text-emerald-100"
                                                : "text-foreground";
                                      const isGoldenScored =
                                        isGolden && (isExact || isOutcomeOnly);
                                      const goldenBorderClass = isGolden
                                        ? "!border-yellow-300/75"
                                        : "";
                                      const goldenGlowClass = isGolden
                                        ? "shadow-[inset_0_0_0_1px_rgba(250,204,21,0.55),0_0_14px_rgba(250,204,21,0.15)]"
                                        : "";
                                      const goldenIndicatorClass =
                                        isGoldenScored
                                          ? "ring-1 ring-yellow-300/65 shadow-[0_0_16px_rgba(250,204,21,0.2),inset_0_0_0_1px_rgba(250,204,21,0.32)]"
                                          : "";

                                      return (
                                        <div
                                          key={p.uid}
                                          className="relative min-w-0 !overflow-visible"
                                        >
                                          <div
                                            className={[
                                              "relative overflow-hidden rounded-[20px] border border-white/8 bg-white/[0.02] px-3 py-2.5 text-left",
                                              toneClass,
                                              goldenBorderClass,
                                              goldenGlowClass,
                                              goldenIndicatorClass,
                                              powerupTypeClass,
                                            ].join(" ")}
                                          >
                                            <div
                                              className={[
                                                "absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-gradient-to-b",
                                                accentBarClass,
                                              ].join(" ")}
                                            />
                                            <div className="relative pl-3">
                                              <div className="font-display text-[clamp(0.66rem,0.85vw,0.82rem)] font-semibold truncate text-muted">
                                                {p.displayName.length > 6
                                                  ? p.displayName.slice(0, 6)
                                                  : p.displayName}
                                              </div>
                                              <span
                                                className={[
                                                  "font-display text-[0.92rem] font-semibold text-foreground truncate",
                                                  scoreBadgeClass,
                                                ].join(" ")}
                                              >
                                                {hideOtherPick && pred
                                                  ? HIDDEN_PICK
                                                  : fmtScore(pred)}
                                                {fixturePoints != null ? (
                                                  <span className="ml-1 text-[0.68rem] font-semibold text-white/55">
                                                    +{fixturePoints}
                                                  </span>
                                                ) : null}
                                              </span>
                                            </div>
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
                      </div>
                    </div>
                  </div>
                );
              };

              return fixtureSections.map((section, sectionIdx) => (
                <SectionStack key={section.key} gap="tight">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-3 py-2 shadow-[0_12px_28px_rgba(3,8,20,0.16)]">
                      <div className="text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-white/38">
                        Matchboard
                      </div>
                      <div className="flex flex-wrap items-baseline gap-2">
                        <div className="font-display text-sm font-semibold text-foreground sm:text-base">
                          {section.label}
                        </div>
                        {"suffix" in section && section.suffix ? (
                          <div className="font-display text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-white/40">
                            {section.suffix}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <span className="h-px flex-1 bg-[linear-gradient(90deg,rgba(255,255,255,0.02)_0%,rgba(var(--room-accent-rgb),0.22)_55%,rgba(255,255,255,0.02)_100%)]" />
                    <span className="font-display text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-white/34">
                      {section.items.length}
                    </span>
                  </div>
                  <div className="grid items-start gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {section.items.map((fixture, idx) =>
                      renderFixtureCard(fixture, sectionIdx * 20 + idx),
                    )}
                  </div>
                </SectionStack>
              ));
            })()}
        </SectionStack>

        {(fixturesGeneratedAt || fixturesRefreshedAt) && (
          <SectionCard
            className={`${standardSectionCardClass} px-4 py-3 sm:py-4`}
          >
            <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
              Fixture ledger
            </div>
            <div className="mt-2 space-y-1 text-xs text-muted">
              {fixturesGeneratedAt && (
                <div>
                  Fixture snapshot time:{" "}
                  {formatDateTimeLabel(fixturesGeneratedAt)}
                </div>
              )}
              {fixturesRefreshedAt && (
                <div>
                  Fixtures page last refreshed:{" "}
                  {formatDateTimeLabel(fixturesRefreshedAt)}
                </div>
              )}
            </div>
          </SectionCard>
        )}
      </SectionStack>

      <AnimatedModal
        open={matchInfoOpen}
        onClose={() => setMatchInfoOpen(false)}
        portal
        lockBackground
        zIndexClassName="z-[90]"
        overlayClassName="bg-[radial-gradient(circle_at_top,rgba(12,20,42,0.2),rgba(3,8,20,0.88)_48%,rgba(3,8,20,0.96)_100%)] backdrop-blur-sm"
        panelClassName="w-[min(96vw,1180px)] h-[min(92vh,880px)] overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,14,24,0.985),rgba(10,16,28,0.97))] shadow-[0_28px_72px_rgba(3,8,20,0.44)]"
      >
        <div className="h-full p-3 sm:p-4 flex flex-col gap-3">
          <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0.006))] px-4 py-4 shadow-[0_18px_42px_rgba(3,8,20,0.24)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/46">
                  Matchdesk
                </div>
                <div className="mt-1 font-display text-xl font-semibold text-foreground">
                  Match Info
                </div>
                <div className="mt-1 text-xs text-muted">
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
                className={`border-white/10 ${BTN_3D}`}
              />
            </div>
          </div>

          <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.014),rgba(255,255,255,0.004))] p-2 shadow-[0_14px_30px_rgba(3,8,20,0.18)]">
            <SliderSwitch
              options={[
                { value: "lineups", label: "Lineups" },
                { value: "stats", label: "Stats" },
                { value: "h2h", label: "H2H" },
                { value: "form", label: "Form" },
              ]}
              value={matchInfoTab}
              onChange={(v) => setMatchInfoTab(v as MatchInfoTab)}
              className="relative grid overflow-hidden rounded-[22px] border border-white/10 bg-black/20 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              buttonClassName="font-display relative z-10 rounded-[16px] px-3 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/55 transition-colors"
            />
          </div>

          <SpecialBreak />

          <div className="min-h-0 flex-1 overflow-auto no-scrollbar space-y-4 pr-1 pb-1">
            {matchInfoLoading && (
              <div className="rounded-[22px] border border-white/8 bg-black/24 px-4 py-4 text-sm text-muted inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                <span>Loading match info…</span>
              </div>
            )}
            {!matchInfoLoading && matchInfoError && (
              <div className="rounded-[22px] border border-rose-400/30 bg-rose-500/10 px-4 py-4 text-sm text-rose-200">
                {matchInfoError}
              </div>
            )}
            {!matchInfoLoading &&
              !matchInfoError &&
              currentMatchInfo &&
              matchInfoTab === "lineups" && (
                <div className="space-y-3">
                  {(() => {
                    const lineupPhase =
                      currentMatchInfo.lineups.phase === "predicted"
                        ? "predicted"
                        : "confirmed";
                    const showLiveRatings =
                      lineupPhase === "confirmed" &&
                      isFixtureStartedForLineups(selectedMatchFixture?.status);
                    const lineupHeading =
                      lineupPhase === "predicted"
                        ? "Predicted Lineup"
                        : "Confirmed Lineup";
                    const startingXiHeading =
                      lineupPhase === "predicted"
                        ? "Predicted XI"
                        : "Starting XI";
                    const emptyLineupLabel =
                      lineupPhase === "predicted"
                        ? "No predicted lineup available yet."
                        : "Lineup not confirmed yet.";
                    const lineupBlocks = [
                      {
                        side: "home" as const,
                        lineup: currentMatchInfo.lineups.home,
                        badge: selectedMatchFixture?.home?.badge || null,
                        tla: selectedMatchFixture?.home?.tla || null,
                      },
                      {
                        side: "away" as const,
                        lineup: currentMatchInfo.lineups.away,
                        badge: selectedMatchFixture?.away?.badge || null,
                        tla: selectedMatchFixture?.away?.tla || null,
                      },
                    ];
                    const lineupBlocksWithRows = lineupBlocks.map((block) => ({
                      ...block,
                      starterRows: buildFormationRows(
                        block.lineup.starters,
                        block.lineup.formation,
                      ),
                    }));
                    const motmRating = showLiveRatings
                      ? lineupBlocks
                          .flatMap((block) => [
                            ...block.lineup.starters,
                            ...block.lineup.subs,
                          ])
                          .reduce<number | null>((best, player) => {
                            const rating = Number(player.rating);
                            if (!Number.isFinite(rating)) return best;
                            return best == null || rating > best
                              ? rating
                              : best;
                          }, null)
                      : null;
                    return (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="inline-flex items-center rounded-full border border-[color:rgba(var(--room-accent-rgb),0.55)] bg-[color:rgba(var(--room-accent-rgb),0.08)] px-2.5 py-1 font-display text-[10px] font-semibold uppercase tracking-wide text-foreground">
                            {lineupHeading}
                          </div>
                          <div className="font-display text-[11px] uppercase tracking-wide text-muted">
                            {startingXiHeading}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          {lineupBlocksWithRows.map((block) => (
                            <div
                              key={`lineup-head-${block.side}`}
                              className="rounded-[22px] border border-white/8 bg-black/24 px-3 py-3 shadow-[0_12px_28px_rgba(3,8,20,0.16)]"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                                    {teamAbbr({
                                      name: block.lineup.name,
                                      tla: block.tla,
                                      shortName: block.lineup.name,
                                    })}{" "}
                                    - {block.side === "home" ? "Home" : "Away"}
                                  </div>
                                  <div className="font-display text-sm font-semibold text-foreground">
                                    {block.lineup.formation || "TBD"}
                                  </div>
                                  <div className="text-[11px] text-muted truncate">
                                    {block.lineup.coach || "Manager TBD"}
                                  </div>
                                </div>
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-black/16">
                                  {block.badge ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={block.badge}
                                      alt={block.lineup.name}
                                      className="h-9 w-9 object-contain"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <span className="font-display text-xs font-bold text-foreground">
                                      {teamAbbr({
                                        name: block.lineup.name,
                                        tla: block.tla,
                                        shortName: block.lineup.name,
                                      })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {lineupBlocksWithRows.every(
                          (block) => block.lineup.starters.length === 0,
                        ) ? (
                          <div className="rounded-[18px] border border-white/8 bg-black/24 px-3 py-3 text-xs text-muted">
                            {emptyLineupLabel}
                          </div>
                        ) : (
                          <>
                            <div className="sm:hidden rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.024)_0%,rgba(8,12,22,0.96)_100%)] p-1 shadow-[0_14px_32px_rgba(3,8,20,0.2)]">
                              <div className="relative h-[960px] overflow-hidden rounded-xl border border-white/8 bg-[radial-gradient(circle_at_center,rgba(var(--room-accent-rgb),0.08)_0%,rgba(8,12,22,0.96)_62%)]">
                                <div className="absolute inset-x-1.5 top-1.5 h-[calc(50%-8px)] rounded-t-xl border border-white/8 border-b-0" />
                                <div className="absolute inset-x-1.5 bottom-1.5 h-[calc(50%-8px)] rounded-b-xl border border-white/8 border-t-0" />
                                <div className="absolute left-1.5 right-1.5 top-1/2 h-px -translate-y-1/2 bg-white/8" />
                                <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/8" />
                                <div className="absolute left-1/2 top-1.5 h-10 w-[36%] -translate-x-1/2 rounded-b-xl border border-white/8 border-t-0" />
                                <div className="absolute left-1/2 bottom-1.5 h-10 w-[36%] -translate-x-1/2 rounded-t-xl border border-white/8 border-b-0" />
                                <div className="absolute inset-x-2.5 top-4 bottom-[calc(50%+28px)] flex flex-col justify-evenly">
                                  {lineupBlocksWithRows
                                    .filter((block) => block.side === "home")
                                    .map((block) => (
                                      <div
                                        key={`mobile-home-rows-${block.side}`}
                                        className={[
                                          "grid h-full gap-1",
                                          formationGridClasses(
                                            block.starterRows.length,
                                          ),
                                        ].join(" ")}
                                      >
                                        {block.starterRows.map(
                                          (row, rowIdx) => (
                                            <div
                                              key={`mobile-home-row-${rowIdx}`}
                                              className="flex items-center justify-evenly gap-1"
                                            >
                                              {row.map((player) => (
                                                <div
                                                  key={`mobile-home-player-${player.id ?? player.name}`}
                                                  className="transition-transform duration-200 ease-out"
                                                  style={{
                                                    transform: `translateY(${formationFanOffsetPx(row, row.indexOf(player), block.side, "y")}px)`,
                                                  }}
                                                >
                                                  <PitchMarker
                                                    player={player}
                                                    showLiveRatings={
                                                      showLiveRatings
                                                    }
                                                    isManOfTheMatch={
                                                      motmRating != null &&
                                                      Number.isFinite(
                                                        Number(player.rating),
                                                      ) &&
                                                      Number(player.rating) ===
                                                        motmRating
                                                    }
                                                    crowded={row.length >= 5}
                                                    size="mobile"
                                                  />
                                                </div>
                                              ))}
                                            </div>
                                          ),
                                        )}
                                      </div>
                                    ))}
                                </div>
                                <div className="absolute inset-x-2.5 top-[calc(50%+28px)] bottom-4 flex flex-col justify-evenly">
                                  {lineupBlocksWithRows
                                    .filter((block) => block.side === "away")
                                    .map((block) => (
                                      <div
                                        key={`mobile-away-rows-${block.side}`}
                                        className={[
                                          "grid h-full gap-1",
                                          formationGridClasses(
                                            block.starterRows.length,
                                          ),
                                        ].join(" ")}
                                      >
                                        {[...block.starterRows]
                                          .reverse()
                                          .map((row, rowIdx) => (
                                            <div
                                              key={`mobile-away-row-${rowIdx}`}
                                              className="flex items-center justify-evenly gap-1"
                                            >
                                              {[...row]
                                                .reverse()
                                                .map((player, playerIdx) => (
                                                  <div
                                                    key={`mobile-away-player-${player.id ?? player.name}`}
                                                    className="transition-transform duration-200 ease-out"
                                                    style={{
                                                      transform: `translateY(${formationFanOffsetPx(row, row.length - 1 - playerIdx, block.side, "y")}px)`,
                                                    }}
                                                  >
                                                    <PitchMarker
                                                      player={player}
                                                      showLiveRatings={
                                                        showLiveRatings
                                                      }
                                                      isManOfTheMatch={
                                                        motmRating != null &&
                                                        Number.isFinite(
                                                          Number(player.rating),
                                                        ) &&
                                                        Number(
                                                          player.rating,
                                                        ) === motmRating
                                                      }
                                                      crowded={row.length >= 5}
                                                      size="mobile"
                                                    />
                                                  </div>
                                                ))}
                                            </div>
                                          ))}
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </div>

                            <div className="hidden sm:block rounded-[24px] border border-white/8 bg-[linear-gradient(90deg,rgba(255,255,255,0.022)_0%,rgba(12,18,30,0.96)_24%,rgba(12,18,30,0.96)_76%,rgba(255,255,255,0.022)_100%)] p-1 shadow-[0_14px_32px_rgba(3,8,20,0.2)]">
                              <div className="relative h-[620px] overflow-hidden rounded-xl border border-white/8 bg-[radial-gradient(circle_at_center,rgba(var(--room-accent-rgb),0.08)_0%,rgba(8,12,22,0.96)_62%)]">
                                <div className="absolute inset-y-1.5 left-1.5 w-[calc(50%-8px)] rounded-l-xl border border-white/8 border-r-0" />
                                <div className="absolute inset-y-1.5 right-1.5 w-[calc(50%-8px)] rounded-r-xl border border-white/8 border-l-0" />
                                <div className="absolute top-1.5 bottom-1.5 left-1/2 w-px -translate-x-1/2 bg-white/8" />
                                <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/8" />
                                <div className="absolute left-1.5 top-1/2 h-[36%] w-10 -translate-y-1/2 rounded-r-xl border border-white/8 border-l-0" />
                                <div className="absolute right-1.5 top-1/2 h-[36%] w-10 -translate-y-1/2 rounded-l-xl border border-white/8 border-r-0" />
                                <div className="absolute inset-y-3 left-3 right-[calc(50%+14px)]">
                                  {lineupBlocksWithRows
                                    .filter((block) => block.side === "home")
                                    .map((block) => (
                                      <div
                                        key={`desktop-home-rows-${block.side}`}
                                        className="grid h-full gap-2"
                                        style={{
                                          gridTemplateColumns: `repeat(${Math.max(1, block.starterRows.length)}, minmax(0, 1fr))`,
                                        }}
                                      >
                                        {block.starterRows.map(
                                          (row, rowIdx) => (
                                            <div
                                              key={`desktop-home-row-${rowIdx}`}
                                              className="flex h-full flex-col items-center justify-evenly gap-2"
                                            >
                                              {row.map((player) => (
                                                <div
                                                  key={`desktop-home-player-${player.id ?? player.name}`}
                                                  className="transition-transform duration-200 ease-out"
                                                  style={{
                                                    transform: `translateX(${formationFanOffsetPx(row, row.indexOf(player), block.side, "x")}px)`,
                                                  }}
                                                >
                                                  <PitchMarker
                                                    player={player}
                                                    showLiveRatings={
                                                      showLiveRatings
                                                    }
                                                    isManOfTheMatch={
                                                      motmRating != null &&
                                                      Number.isFinite(
                                                        Number(player.rating),
                                                      ) &&
                                                      Number(player.rating) ===
                                                        motmRating
                                                    }
                                                    size="desktop"
                                                  />
                                                </div>
                                              ))}
                                            </div>
                                          ),
                                        )}
                                      </div>
                                    ))}
                                </div>
                                <div className="absolute inset-y-3 left-[calc(50%+14px)] right-3">
                                  {lineupBlocksWithRows
                                    .filter((block) => block.side === "away")
                                    .map((block) => (
                                      <div
                                        key={`desktop-away-rows-${block.side}`}
                                        className="grid h-full gap-2"
                                        style={{
                                          gridTemplateColumns: `repeat(${Math.max(1, block.starterRows.length)}, minmax(0, 1fr))`,
                                        }}
                                      >
                                        {[...block.starterRows]
                                          .reverse()
                                          .map((row, rowIdx) => (
                                            <div
                                              key={`desktop-away-row-${rowIdx}`}
                                              className="flex h-full flex-col items-center justify-evenly gap-2"
                                            >
                                              {[...row]
                                                .reverse()
                                                .map((player, playerIdx) => (
                                                  <div
                                                    key={`desktop-away-player-${player.id ?? player.name}`}
                                                    className="transition-transform duration-200 ease-out"
                                                    style={{
                                                      transform: `translateX(${formationFanOffsetPx(row, row.length - 1 - playerIdx, block.side, "x")}px)`,
                                                    }}
                                                  >
                                                    <PitchMarker
                                                      player={player}
                                                      showLiveRatings={
                                                        showLiveRatings
                                                      }
                                                      isManOfTheMatch={
                                                        motmRating != null &&
                                                        Number.isFinite(
                                                          Number(player.rating),
                                                        ) &&
                                                        Number(
                                                          player.rating,
                                                        ) === motmRating
                                                      }
                                                      size="desktop"
                                                    />
                                                  </div>
                                                ))}
                                            </div>
                                          ))}
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </div>
                          </>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {lineupBlocksWithRows.map((block) => (
                            <div
                              key={`bench-${block.side}`}
                              className="rounded-[22px] border border-white/8 bg-black/24 p-3 space-y-3 shadow-[0_12px_28px_rgba(3,8,20,0.16)]"
                            >
                              <div className="font-display text-[11px] uppercase tracking-wide text-muted">
                                {block.side === "home"
                                  ? "Home Bench"
                                  : "Away Bench"}
                              </div>
                              <div className="space-y-2">
                                {block.lineup.subs.length ? (
                                  block.lineup.subs.map((player) => (
                                    <div
                                      key={`${block.side}-sub-${player.id ?? player.name}`}
                                      className="rounded-[18px] border border-white/8 bg-black/16 px-2.5 py-2"
                                    >
                                      <div className="flex items-start gap-2">
                                        <div className="h-9 w-9 rounded-lg border border-white/8 bg-white/[0.03] flex items-center justify-center overflow-hidden shrink-0">
                                          {player.photo ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                              src={player.photo}
                                              alt={player.name}
                                              className="h-full w-full object-cover"
                                              loading="lazy"
                                            />
                                          ) : (
                                            <span className="font-display text-[10px] font-semibold text-foreground tabular-nums">
                                              {player.shirtNumber || "—"}
                                            </span>
                                          )}
                                        </div>
                                        <div className="min-w-0 flex-1 space-y-1">
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                              <div className="font-display text-xs text-foreground truncate">
                                                {player.name}
                                              </div>
                                              <div className="font-display text-[10px] text-muted">
                                                {showLiveRatings
                                                  ? substitutionSummary(
                                                      player,
                                                    ) || "Unused sub"
                                                  : player.positionLabel ||
                                                    "Bench"}
                                              </div>
                                            </div>
                                            <span
                                              className={[
                                                "inline-flex min-w-[48px] items-center justify-center rounded-full border px-2 py-0.5 font-display text-[10px] font-semibold tabular-nums",
                                                motmRating != null &&
                                                Number.isFinite(
                                                  Number(player.rating),
                                                ) &&
                                                Number(player.rating) ===
                                                  motmRating &&
                                                showLiveRatings
                                                  ? "border-sky-400/80 bg-surface-2 text-foreground shadow-[0_0_10px_rgba(56,189,248,0.35)]"
                                                  : "border-subtle bg-surface-2 text-foreground",
                                              ].join(" ")}
                                            >
                                              <span className="relative inline-flex items-center justify-center overflow-visible">
                                                {playerMetaValue(
                                                  player,
                                                  showLiveRatings,
                                                )}
                                                {motmRating != null &&
                                                Number.isFinite(
                                                  Number(player.rating),
                                                ) &&
                                                Number(player.rating) ===
                                                  motmRating &&
                                                showLiveRatings ? (
                                                  <span className="absolute -right-2 top-1/2 -translate-y-1/2 text-sky-200">
                                                    <Crown
                                                      size={9}
                                                      strokeWidth={2.2}
                                                    />
                                                  </span>
                                                ) : null}
                                              </span>
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1">
                                            {Number(player.assistCount || 0) >
                                            0 ? (
                                              <span className="inline-flex items-center gap-0.5 rounded-full border border-subtle px-1.5 py-0.5 font-display text-[9px] text-sky-300">
                                                <Footprints
                                                  size={9}
                                                  strokeWidth={2.1}
                                                />
                                                <span>
                                                  {player.assistCount}
                                                </span>
                                              </span>
                                            ) : null}
                                            {Number(player.goalCount || 0) >
                                              0 ||
                                            Number(player.ownGoalCount || 0) >
                                              0 ? (
                                              <span className="inline-flex items-center gap-1 rounded-full border border-subtle px-1.5 py-0.5 font-display text-[9px]">
                                                {Number(player.goalCount || 0) >
                                                0 ? (
                                                  <span className="inline-flex items-center gap-0.5 text-emerald-300">
                                                    <CircleDot
                                                      size={9}
                                                      strokeWidth={2.1}
                                                    />
                                                    <span>
                                                      {player.goalCount}
                                                    </span>
                                                  </span>
                                                ) : null}
                                                {Number(
                                                  player.ownGoalCount || 0,
                                                ) > 0 ? (
                                                  <span className="inline-flex items-center gap-0.5 text-red-300">
                                                    <CircleDot
                                                      size={9}
                                                      strokeWidth={2.1}
                                                    />
                                                    <span>
                                                      {player.ownGoalCount}
                                                    </span>
                                                  </span>
                                                ) : null}
                                              </span>
                                            ) : null}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <span className="text-xs text-muted">
                                    No bench data.
                                  </span>
                                )}
                              </div>
                              {block.lineup.unavailable.length ? (
                                <div className="space-y-2">
                                  <div className="font-display text-[11px] uppercase tracking-wide text-muted">
                                    Unavailable
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {block.lineup.unavailable.map((player) => (
                                      <span
                                        key={`${block.side}-out-${player.id ?? player.name}`}
                                        className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-black/16 px-2 py-1"
                                      >
                                        <span className="font-display text-[10px] text-foreground">
                                          {player.name}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            {!matchInfoLoading &&
              !matchInfoError &&
              currentMatchInfo &&
              matchInfoTab === "stats" && (
                <div className="space-y-2">
                  {currentMatchInfo.stats.length ? (
                    currentMatchInfo.stats.map((row) => (
                      <div
                        key={`stat-${row.label}`}
                        className="grid grid-cols-[56px_minmax(0,1fr)_56px] items-center gap-2 rounded-[18px] border border-white/8 bg-black/24 px-3 py-3 shadow-[0_10px_22px_rgba(3,8,20,0.14)]"
                      >
                        <span
                          className={[
                            "font-display text-sm text-left tabular-nums",
                            row.highlighted === "home"
                              ? "text-foreground"
                              : "text-muted",
                          ].join(" ")}
                        >
                          {row.home}
                        </span>
                        <span className="text-[11px] text-muted text-center leading-tight">
                          {row.label}
                        </span>
                        <span
                          className={[
                            "font-display text-sm text-right tabular-nums",
                            row.highlighted === "away"
                              ? "text-foreground"
                              : "text-muted",
                          ].join(" ")}
                        >
                          {row.away}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[20px] border border-white/8 bg-black/24 p-4 text-sm text-muted">
                      No live match stats found.
                    </div>
                  )}
                </div>
              )}
            {!matchInfoLoading &&
              !matchInfoError &&
              currentMatchInfo &&
              matchInfoTab === "h2h" && (
                <div className="space-y-2">
                  {currentMatchInfo.headToHead.length ? (
                    currentMatchInfo.headToHead.map((m) => (
                      <div
                        key={`h2h-${m.id ?? m.utcDate}`}
                        className="rounded-[20px] border border-white/8 bg-black/24 p-3 shadow-[0_10px_22px_rgba(3,8,20,0.14)]"
                      >
                        <div className="grid grid-cols-[84px_minmax(0,1fr)_40px] items-center gap-2 text-xs">
                          <span className="font-display text-muted whitespace-nowrap">
                            {(() => {
                              const d = formatDateWithOrdinal(m.utcDate);
                              return (
                                <>
                                  {d.dayNum}
                                  <sup className="text-[9px] ml-[1px]">
                                    {d.suffix}
                                  </sup>{" "}
                                  {d.monthYear}
                                </>
                              );
                            })()}
                          </span>
                          <span className="font-display text-sm text-foreground inline-flex min-w-0 items-center justify-center gap-1.5">
                            <span className="inline-flex w-[3.4ch] justify-end">
                              {h2hTeamLabel({
                                name: m.homeTeam.name,
                                tla: m.homeTeam.tla,
                              })}
                            </span>
                            <span className="inline-flex min-w-[3.2ch] justify-center tabular-nums text-foreground">
                              {fmtScore(m.result)}
                            </span>
                            <span className="inline-flex w-[3.4ch] justify-start">
                              {h2hTeamLabel({
                                name: m.awayTeam.name,
                                tla: m.awayTeam.tla,
                              })}
                            </span>
                          </span>
                          <span className="inline-flex h-5 min-w-[30px] rounded-full border border-white/8 bg-black/16 items-center justify-center px-1 justify-self-end">
                            <span className="font-display text-[9px] text-muted leading-none">
                              {competitionAbbr(
                                m.competition?.name,
                                m.competition?.code,
                              )}
                            </span>
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[20px] border border-white/8 bg-black/24 p-4 text-sm text-muted">
                      No head-to-head data found.
                    </div>
                  )}
                  <div className="rounded-[20px] border border-white/8 bg-black/24 p-4 shadow-[0_10px_22px_rgba(3,8,20,0.14)]">
                    <div className="font-display text-[11px] text-muted text-center mb-2">
                      Last 5 H2H
                    </div>
                    <div className="grid grid-cols-3 items-center gap-2 text-center">
                      <div className="font-display text-xs text-muted">
                        {teamAbbr({
                          name: selectedMatchFixture?.home?.name || "Team 1",
                          tla: selectedMatchFixture?.home?.tla || null,
                          shortName:
                            selectedMatchFixture?.home?.shortName || null,
                        })}
                      </div>
                      <div className="font-display text-xs text-muted">
                        Draws
                      </div>
                      <div className="font-display text-xs text-muted">
                        {teamAbbr({
                          name: selectedMatchFixture?.away?.name || "Team 2",
                          tla: selectedMatchFixture?.away?.tla || null,
                          shortName:
                            selectedMatchFixture?.away?.shortName || null,
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

            {!matchInfoLoading &&
              !matchInfoError &&
              currentMatchInfo &&
              matchInfoTab === "form" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
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
                  ].map((block) => (
                    <div
                      key={block.side}
                      className="rounded-[20px] border border-white/8 bg-black/24 p-3 space-y-3 shadow-[0_10px_22px_rgba(3,8,20,0.14)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-display text-sm font-semibold text-foreground">
                          {block.label}
                        </div>
                        <div className="h-7 w-7 rounded-xl border border-white/8 bg-black/14 flex items-center justify-center overflow-hidden shrink-0">
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
                              {teamAbbr({
                                name: block.label,
                                tla: block.tla,
                                shortName: block.label,
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                      {block.list.length ? (
                        block.list.map((m) => (
                          <div
                            key={`${block.side}-${m.id ?? m.utcDate}`}
                            className="grid grid-cols-[minmax(0,1fr)_56px] sm:grid-cols-[84px_minmax(0,1fr)_56px] items-center gap-x-2 gap-y-1.5 text-xs"
                          >
                            <span className="col-span-full sm:col-span-1 font-display text-muted whitespace-nowrap text-left">
                              {(() => {
                                const d = formatDateWithOrdinal(m.utcDate);
                                return (
                                  <>
                                    {d.dayNum}
                                    <sup className="text-[9px] ml-[1px]">
                                      {d.suffix}
                                    </sup>{" "}
                                    {d.monthYear}
                                  </>
                                );
                              })()}
                            </span>
                            <span className="min-w-0 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-foreground">
                              <span className="min-w-0 flex items-center justify-end gap-1.5 text-right">
                                <div className="min-w-0">
                                  <div className="font-display text-[10px] font-semibold text-foreground truncate">
                                    {formTeamLabel({
                                      name: m.homeTeam.name,
                                      tla: m.homeTeam.tla,
                                      shortName: m.homeTeam.shortName,
                                    })}
                                  </div>
                                  <div className="text-[9px] text-muted truncate">
                                    {m.homeTeam.name}
                                  </div>
                                </div>
                                <span className="h-5 w-5 rounded-lg flex items-center justify-center overflow-hidden shrink-0 border border-white/8 bg-black/14">
                                  {m.homeTeam.badge ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={m.homeTeam.badge}
                                      alt={m.homeTeam.name}
                                      className="h-4 w-4 object-contain"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <span className="font-display text-[8px] font-bold text-foreground">
                                      {formTeamLabel({
                                        name: m.homeTeam.name,
                                        tla: m.homeTeam.tla,
                                        shortName: m.homeTeam.shortName,
                                      })}
                                    </span>
                                  )}
                                </span>
                              </span>
                              <span className="inline-flex min-w-[3.2ch] justify-center font-display tabular-nums text-foreground">
                                {fmtScore(m.result)}
                              </span>
                              <span className="min-w-0 flex items-center justify-start gap-1.5 text-left">
                                <span className="h-5 w-5 rounded-lg flex items-center justify-center overflow-hidden shrink-0 border border-white/8 bg-black/14">
                                  {m.awayTeam.badge ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={m.awayTeam.badge}
                                      alt={m.awayTeam.name}
                                      className="h-4 w-4 object-contain"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <span className="font-display text-[8px] font-bold text-foreground">
                                      {formTeamLabel({
                                        name: m.awayTeam.name,
                                        tla: m.awayTeam.tla,
                                        shortName: m.awayTeam.shortName,
                                      })}
                                    </span>
                                  )}
                                </span>
                                <div className="min-w-0">
                                  <div className="font-display text-[10px] font-semibold text-foreground truncate">
                                    {formTeamLabel({
                                      name: m.awayTeam.name,
                                      tla: m.awayTeam.tla,
                                      shortName: m.awayTeam.shortName,
                                    })}
                                  </div>
                                  <div className="text-[9px] text-muted truncate">
                                    {m.awayTeam.name}
                                  </div>
                                </div>
                              </span>
                            </span>
                            <span className="inline-flex items-center justify-end gap-1.5 justify-self-end">
                              <span className="h-5 min-w-[30px] rounded-full border border-white/8 bg-black/16 inline-flex items-center justify-center px-1 shrink-0">
                                <span className="font-display text-[9px] text-muted leading-none">
                                  {competitionAbbr(
                                    m.competition?.name,
                                    m.competition?.code,
                                  )}
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
                        ))
                      ) : (
                        <div className="text-xs text-muted">
                          No recent form data.
                        </div>
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
        panelClassName="w-full max-w-2xl max-h-[95vh] overflow-hidden rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,14,24,0.98),rgba(10,18,32,0.96))] shadow-[0_24px_56px_rgba(3,8,20,0.4)]"
      >
        <div className="flex items-center justify-between p-4">
          <div className="font-display text-lg font-semibold text-foreground">
            PL Table • {seasonLabel(seasonKey || "----")}
          </div>
          <ModalExitButton
            onClick={() => setTableOpen(false)}
            ariaLabel="Exit table"
            className={`border-white/10 ${BTN_3D}`}
          />
        </div>
        <div className="max-h-[calc(95vh-176px)] flex flex-col">
          {tableLoading ? (
            <div className="p-4 text-sm text-muted inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Loading table…</span>
            </div>
          ) : tableError ? (
            <div className="p-4 text-sm text-danger">{tableError}</div>
          ) : (tableRowsByMode[tableMode] ?? []).length === 0 ? (
            <div className="p-4 text-sm text-muted">
              No table data available.
            </div>
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
                    className="relative grid overflow-hidden rounded-[22px] border border-white/10 bg-black/20 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    buttonClassName="font-display relative z-10 rounded-[16px] px-3 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/55 transition-colors"
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
                    className="relative grid overflow-hidden rounded-[22px] border border-white/10 bg-black/20 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    buttonClassName="font-display relative z-10 rounded-[16px] px-3 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/55 transition-colors"
                  />
                </div>
              </div>
              <div className="px-4 py-2">
                <SpecialBreak />
              </div>
              <div
                className={[
                  "overflow-auto no-scrollbar min-h-0 px-2 transition-all duration-150 ease-out",
                  tableAnimatingOut
                    ? "opacity-0 translate-y-1"
                    : "opacity-100 translate-y-0",
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
                          <th className="py-2 px-0.5 sm:px-1 text-center">
                            GF
                          </th>
                          <th className="py-2 px-0.5 sm:px-1 text-center">
                            GA
                          </th>
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
                        <td className="py-2 px-1 text-foreground">
                          {r.position}
                        </td>
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
                                  {(r.team.shortName || r.team.name || "FC")
                                    .slice(0, 3)
                                    .toUpperCase()}
                                </span>
                              )}
                            </div>
                            <span
                              className={[
                                "font-display text-foreground font-medium truncate",
                                tableView === "FULL"
                                  ? "inline text-[10px] sm:text-sm"
                                  : "inline",
                              ].join(" ")}
                            >
                              {tableView === "FULL"
                                ? teamAbbr(r.team)
                                : r.team.shortName || r.team.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 px-0.5 sm:px-1 text-center text-foreground">
                          {toInt(r.playedGames)}
                        </td>
                        {tableView === "FULL" && (
                          <>
                            <td className="py-2 px-0.5 sm:px-1 text-center text-foreground">
                              {toInt(r.won)}
                            </td>
                            <td className="py-2 px-0.5 sm:px-1 text-center text-foreground">
                              {toInt(r.draw)}
                            </td>
                            <td className="py-2 px-0.5 sm:px-1 text-center text-foreground">
                              {toInt(r.lost)}
                            </td>
                            <td className="py-2 px-0.5 sm:px-1 text-center text-foreground">
                              {toInt(r.goalsScored)}
                            </td>
                            <td className="py-2 px-0.5 sm:px-1 text-center text-foreground">
                              {toInt(r.goalsAgainst)}
                            </td>
                          </>
                        )}
                        <td className="py-2 px-1 text-center text-foreground">
                          {toInt(r.goalDifference)}
                        </td>
                        <td className="py-2 px-1 text-center font-semibold text-foreground">
                          {toInt(r.points)}
                        </td>
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
    </PageShell>
  );
}
