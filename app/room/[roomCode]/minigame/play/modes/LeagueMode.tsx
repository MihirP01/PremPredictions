"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Save } from "lucide-react";
import SectionCard from "@/components/SectionCard";
import ScoringKeyRow, { LEAGUE_SCORING_ITEMS } from "@/components/ScoringKeyRow";
import TeamBadge from "@/components/TeamBadge";
import TeamLabel from "@/components/TeamLabel";

type LeagueFixture = {
  fixtureId: number;
  kickoff: string;
  home: {
    name: string;
    shortName?: string | null;
    tla?: string | null;
    badge?: string | null;
  };
  away: {
    name: string;
    shortName?: string | null;
    tla?: string | null;
    badge?: string | null;
  };
};

type DraftScore = { home: string; away: string };

type Props = {
  fixtures: LeagueFixture[];
  savedPicks: Map<number, string>;
  lockAtMs: number | null;
  fairPlayEnabled: boolean;
  onSave: (
    picks: Array<{ fixtureId: number; score: string }>,
  ) => Promise<number>;
};

function initialDraft(fixtures: LeagueFixture[], saved: Map<number, string>) {
  const next: Record<number, DraftScore> = {};
  for (const fixture of fixtures) {
    const [home = "", away = ""] = String(
      saved.get(fixture.fixtureId) || "",
    ).split("-");
    next[fixture.fixtureId] = { home, away };
  }
  return next;
}

function onlyScoreDigits(value: string) {
  return value === "" || /^\d{1,2}$/.test(value);
}

function formatDeadline(ms: number | null) {
  if (ms == null) return "Gameweek cutoff";
  return new Date(ms).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LeagueMode({
  fixtures,
  savedPicks,
  lockAtMs,
  fairPlayEnabled,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<Record<number, DraftScore>>(() =>
    initialDraft(fixtures, savedPicks),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const isLocked = lockAtMs != null && nowMs >= lockAtMs;
  const filledCount = useMemo(
    () =>
      fixtures.filter((fixture) => {
        const score = draft[fixture.fixtureId];
        return Boolean(score?.home && score?.away);
      }).length,
    [draft, fixtures],
  );

  function updateScore(
    fixtureId: number,
    side: keyof DraftScore,
    value: string,
  ) {
    if (!onlyScoreDigits(value) || isLocked) return;
    setDraft((current) => ({
      ...current,
      [fixtureId]: {
        ...(current[fixtureId] ?? { home: "", away: "" }),
        [side]: value,
      },
    }));
    setError(null);
  }

  async function savePredictions() {
    if (saving || isLocked) return;
    const incomplete = fixtures.some((fixture) => {
      const score = draft[fixture.fixtureId] ?? { home: "", away: "" };
      return !score.home || !score.away;
    });
    if (incomplete) {
      setError("Predict every eligible fixture before submitting.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(
        fixtures.map((fixture) => {
          const score = draft[fixture.fixtureId] ?? { home: "", away: "" };
          return {
            fixtureId: fixture.fixtureId,
            score: `${score.home}-${score.away}`,
          };
        }),
      );
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save predictions.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SectionCard className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.014))] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/48">
              Asynchronous gameweek
            </div>
            <div className="mt-1 font-display text-xl font-semibold text-foreground">
              Complete every prediction, then lock once
            </div>
            <div className="mt-2 max-w-2xl text-sm text-muted">
              Your entry is independent from the rest of the room. Every
              eligible fixture is required. Submitting locks your gameweek, and
              the whole room locks 30 minutes before the first kickoff.
            </div>
            <ScoringKeyRow className="mt-3 max-w-md" items={LEAGUE_SCORING_ITEMS} />
          </div>
          <div className="shrink-0 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-foreground">
            <div className="inline-flex items-center gap-2 font-display font-semibold">
              <Clock3 size={14} />{" "}
              {isLocked ? "Locked" : formatDeadline(lockAtMs)}
            </div>
          </div>
        </div>
        {fairPlayEnabled ? (
          <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] px-4 py-3 text-sm text-emerald-100/90">
            Fair Play is on. A player who misses the entire gameweek receives
            half the room median as a clearly labelled Fair Play bye.
          </div>
        ) : null}
      </SectionCard>

      <div className="grid gap-3 lg:grid-cols-2">
        {fixtures.map((fixture) => {
          const score = draft[fixture.fixtureId] ?? { home: "", away: "" };
          return (
            <SectionCard
              key={fixture.fixtureId}
              className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,16,28,0.98),rgba(7,12,22,0.97))] p-4"
            >
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="flex min-w-0 flex-col items-center text-center">
                  <TeamBadge
                    name={fixture.home.name}
                    tla={fixture.home.tla}
                    shortName={fixture.home.shortName}
                    badge={fixture.home.badge}
                    wrapperClassName="h-10 w-10 rounded-full"
                    imageClassName="h-8 w-8 object-contain"
                  />
                  <TeamLabel
                    name={fixture.home.name}
                    tla={fixture.home.tla}
                    shortName={fixture.home.shortName}
                    showFullName={false}
                    wrapperClassName="mt-1 w-full text-center"
                    abbrClassName="font-ui block text-[0.78rem] font-semibold"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`${fixture.home.name} score`}
                    inputMode="numeric"
                    value={score.home}
                    disabled={isLocked}
                    onChange={(event) =>
                      updateScore(fixture.fixtureId, "home", event.target.value)
                    }
                    className="h-12 w-12 rounded-xl border border-white/10 bg-white/[0.04] text-center font-display text-xl font-semibold text-foreground outline-none focus:border-white/25 disabled:opacity-60"
                  />
                  <span className="font-display text-muted">–</span>
                  <input
                    aria-label={`${fixture.away.name} score`}
                    inputMode="numeric"
                    value={score.away}
                    disabled={isLocked}
                    onChange={(event) =>
                      updateScore(fixture.fixtureId, "away", event.target.value)
                    }
                    className="h-12 w-12 rounded-xl border border-white/10 bg-white/[0.04] text-center font-display text-xl font-semibold text-foreground outline-none focus:border-white/25 disabled:opacity-60"
                  />
                </div>
                <div className="flex min-w-0 flex-col items-center text-center">
                  <TeamBadge
                    name={fixture.away.name}
                    tla={fixture.away.tla}
                    shortName={fixture.away.shortName}
                    badge={fixture.away.badge}
                    wrapperClassName="h-10 w-10 rounded-full"
                    imageClassName="h-8 w-8 object-contain"
                  />
                  <TeamLabel
                    name={fixture.away.name}
                    tla={fixture.away.tla}
                    shortName={fixture.away.shortName}
                    showFullName={false}
                    wrapperClassName="mt-1 w-full text-center"
                    abbrClassName="font-ui block text-[0.78rem] font-semibold"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/6 pt-2 text-xs text-muted">
                <span>
                  {new Date(fixture.kickoff).toLocaleString("en-GB", {
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {score.home && score.away ? (
                  <span className="inline-flex items-center gap-1 text-emerald-200/85">
                    <CheckCircle2 size={12} /> Entered
                  </span>
                ) : (
                  <span>Required</span>
                )}
              </div>
            </SectionCard>
          );
        })}
      </div>

      <SectionCard className="sticky bottom-3 z-20 rounded-[22px] border border-white/10 bg-[rgba(8,14,24,0.96)] p-4 shadow-[0_20px_45px_rgba(3,8,20,0.45)] backdrop-blur-xl">
        {error ? (
          <div className="mb-3 text-sm text-rose-200">{error}</div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted">
            <span className="font-display font-semibold text-foreground">
              {filledCount}/{fixtures.length}
            </span>{" "}
            scorelines entered
          </div>
          <button
            type="button"
            onClick={savePredictions}
            disabled={
              saving ||
              isLocked ||
              !fixtures.length ||
              filledCount !== fixtures.length
            }
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(56,189,248,0.14))] px-5 font-display text-sm font-semibold text-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={15} />
            {saving
              ? "Saving…"
              : isLocked
                ? "Gameweek locked"
                : filledCount === fixtures.length
                  ? "Submit and lock gameweek"
                  : "Complete every prediction"}
          </button>
        </div>
      </SectionCard>
    </>
  );
}
