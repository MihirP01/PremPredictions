import "server-only";

import { and, eq } from "drizzle-orm";
import {
  appUsers,
  gameLobby,
  games,
  goldenPicks,
  powerups,
  predictions,
  roomMembers,
  roomSecurity,
  rooms,
  seasons,
  weeklyScores,
  yearTablePicks,
} from "@/db/schema";
import { canonicalRoomCode } from "@/lib/roomCode";
import {
  getPostgresDb,
  getPostgresPool,
  isPostgresConfigured,
} from "@/lib/server/postgres";

type RoomRole = "leader" | "member";

type RoomSettings = {
  gameModeStyle?: string;
  sameResultLock?: boolean;
  powerupsEnabled?: boolean;
  leagueFairPlayEnabled?: boolean;
  themeAccent?: string;
  hasPassword?: boolean;
  [key: string]: unknown;
};

export function postgresRoomReadsEnabled() {
  return isPostgresConfigured();
}

export async function mirrorRoomAccessToPostgres(input: {
  roomCode: string;
  uid: string;
  displayName: string;
  role: RoomRole;
  leaderUid: string;
  settings?: RoomSettings;
  roomSourceData?: Record<string, unknown>;
  memberSourceData?: Record<string, unknown>;
}) {
  const db = getPostgresDb();
  const now = new Date();
  const settings = input.settings ?? {};

  await db.transaction(async (tx) => {
    await tx
      .insert(appUsers)
      .values({
        firebaseUid: input.leaderUid,
        sourceData: {},
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appUsers.firebaseUid,
        set: { updatedAt: now },
      });

    await tx
      .insert(appUsers)
      .values({
        firebaseUid: input.uid,
        displayName: input.displayName,
        currentRoomCode: input.roomCode,
        sourceData: {},
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appUsers.firebaseUid,
        set: {
          displayName: input.displayName,
          currentRoomCode: input.roomCode,
          updatedAt: now,
        },
      });

    await tx
      .insert(rooms)
      .values({
        code: input.roomCode,
        leaderUid: input.leaderUid,
        gameModeStyle: String(settings.gameModeStyle || "sprint"),
        sameResultLock: settings.sameResultLock === true,
        powerupsEnabled: settings.powerupsEnabled === true,
        leagueFairPlayEnabled: settings.leagueFairPlayEnabled === true,
        themeAccent: String(settings.themeAccent || "teal"),
        hasPassword: settings.hasPassword === true,
        settings,
        sourceData: input.roomSourceData ?? {},
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: rooms.code,
        set: {
          leaderUid: input.leaderUid,
          gameModeStyle: String(settings.gameModeStyle || "sprint"),
          sameResultLock: settings.sameResultLock === true,
          powerupsEnabled: settings.powerupsEnabled === true,
          leagueFairPlayEnabled: settings.leagueFairPlayEnabled === true,
          themeAccent: String(settings.themeAccent || "teal"),
          hasPassword: settings.hasPassword === true,
          settings,
          sourceData: input.roomSourceData ?? {},
          updatedAt: now,
        },
      });

    await tx
      .insert(roomMembers)
      .values({
        roomCode: input.roomCode,
        userId: input.uid,
        role: input.role,
        displayName: input.displayName,
        sourceData: input.memberSourceData ?? {},
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [roomMembers.roomCode, roomMembers.userId],
        set: {
          role: input.role,
          displayName: input.displayName,
          sourceData: input.memberSourceData ?? {},
          updatedAt: now,
        },
      });
  });
}

export async function listPostgresMemberRooms(uid: string) {
  if (!isPostgresConfigured()) return [];
  return getPostgresDb()
    .select({ roomCode: roomMembers.roomCode, role: roomMembers.role })
    .from(roomMembers)
    .where(eq(roomMembers.userId, uid));
}

export async function resolvePostgresRoomAccess(uid: string) {
  const db = getPostgresDb();
  const [profile, memberships] = await Promise.all([
    db
      .select({
        currentRoomCode: appUsers.currentRoomCode,
        displayName: appUsers.displayName,
      })
      .from(appUsers)
      .where(eq(appUsers.firebaseUid, uid))
      .limit(1),
    listPostgresMemberRooms(uid),
  ]);
  return {
    currentRoomCode: canonicalRoomCode(profile[0]?.currentRoomCode || ""),
    displayName: profile[0]?.displayName || "",
    rooms: memberships
      .map((membership) => ({
        roomCode: canonicalRoomCode(membership.roomCode),
        role:
          membership.role === "leader"
            ? ("leader" as const)
            : ("member" as const),
      }))
      .sort((a, b) => a.roomCode.localeCompare(b.roomCode)),
    indexReady: true,
  };
}

export async function removePostgresRoomMember(
  roomCode: string,
  uid: string,
  preferredNextRoomCode?: string,
) {
  const db = getPostgresDb();
  await db.transaction(async (tx) => {
    await tx
      .delete(roomMembers)
      .where(
        and(eq(roomMembers.roomCode, roomCode), eq(roomMembers.userId, uid)),
      );
    const remaining = await tx
      .select({ roomCode: roomMembers.roomCode })
      .from(roomMembers)
      .where(eq(roomMembers.userId, uid))
      .limit(1);
    const nextRoomCode = preferredNextRoomCode || remaining[0]?.roomCode;
    await tx
      .update(appUsers)
      .set({
        currentRoomCode: nextRoomCode ?? null,
        updatedAt: new Date(),
      })
      .where(eq(appUsers.firebaseUid, uid));
  });
}

export async function updatePostgresRoomMemberNickname(
  roomCode: string,
  uid: string,
  nickname: string,
) {
  await getPostgresDb()
    .update(roomMembers)
    .set({ nickname: nickname || null, updatedAt: new Date() })
    .where(
      and(eq(roomMembers.roomCode, roomCode), eq(roomMembers.userId, uid)),
    );
}

export async function deletePostgresRoom(roomCode: string) {
  const db = getPostgresDb();
  await db.transaction(async (tx) => {
    await tx
      .update(appUsers)
      .set({ currentRoomCode: null, updatedAt: new Date() })
      .where(eq(appUsers.currentRoomCode, roomCode));
    await tx.delete(gameLobby).where(eq(gameLobby.roomCode, roomCode));
    await tx.delete(predictions).where(eq(predictions.roomCode, roomCode));
    await tx.delete(goldenPicks).where(eq(goldenPicks.roomCode, roomCode));
    await tx.delete(powerups).where(eq(powerups.roomCode, roomCode));
    await tx.delete(weeklyScores).where(eq(weeklyScores.roomCode, roomCode));
    await tx.delete(yearTablePicks).where(eq(yearTablePicks.roomCode, roomCode));
    await tx.delete(games).where(eq(games.roomCode, roomCode));
    await tx.delete(seasons).where(eq(seasons.roomCode, roomCode));
    await tx.delete(rooms).where(eq(rooms.code, roomCode));
  });
}

export async function mirrorRoomSettingsToPostgres(
  roomCode: string,
  settings: RoomSettings,
) {
  await getPostgresDb()
    .update(rooms)
    .set({
      gameModeStyle: String(settings.gameModeStyle || "sprint"),
      sameResultLock: settings.sameResultLock === true,
      powerupsEnabled: settings.powerupsEnabled === true,
      leagueFairPlayEnabled: settings.leagueFairPlayEnabled === true,
      themeAccent: String(settings.themeAccent || "teal"),
      hasPassword: settings.hasPassword === true,
      settings,
      updatedAt: new Date(),
    })
    .where(eq(rooms.code, roomCode));
}

export async function mirrorRoomSecurityToPostgres(input: {
  roomCode: string;
  passwordHash: string;
  passwordSalt: string;
  updatedBy: string;
}) {
  const now = new Date();
  const db = getPostgresDb();
  await db.transaction(async (tx) => {
    await tx
      .insert(roomSecurity)
      .values({ ...input, updatedAt: now })
      .onConflictDoUpdate({
        target: roomSecurity.roomCode,
        set: {
          passwordHash: input.passwordHash,
          passwordSalt: input.passwordSalt,
          updatedBy: input.updatedBy,
          updatedAt: now,
        },
      });
    await tx
      .update(rooms)
      .set({ hasPassword: true, updatedAt: now })
      .where(eq(rooms.code, input.roomCode));
  });
  await getPostgresPool().query(
    `UPDATE rooms
        SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{hasPassword}', 'true'::jsonb),
            updated_at = now()
      WHERE code = $1`,
    [input.roomCode],
  );
}

export async function mirrorWeeklyScoresToPostgres(input: {
  roomCode: string;
  seasonKey: string;
  gameweek: number;
  scores: Array<{
    uid: string;
    points: number;
    rawPoints: number;
    breakdown: Record<string, unknown>;
    scoreStatus: "scored" | "missed" | "fair_play_bye";
    fairPlayApplied: boolean;
    fairPlayMedian: number | null;
  }>;
}) {
  if (input.scores.length === 0) return;
  const now = new Date();
  await getPostgresDb().transaction(async (tx) => {
    for (const score of input.scores) {
      const data = {
        uid: score.uid,
        gw: input.gameweek,
        points: score.points,
        rawPoints: score.rawPoints,
        breakdown: score.breakdown,
        scoreStatus: score.scoreStatus,
        fairPlayApplied: score.fairPlayApplied,
        fairPlayMedian: score.fairPlayMedian,
        computedAt: now.toISOString(),
      };
      await tx
        .insert(weeklyScores)
        .values({
          roomCode: input.roomCode,
          seasonKey: input.seasonKey,
          gameweek: input.gameweek,
          userId: score.uid,
          points: score.points,
          fairPlayBye: score.fairPlayApplied,
          data,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            weeklyScores.roomCode,
            weeklyScores.seasonKey,
            weeklyScores.gameweek,
            weeklyScores.userId,
          ],
          set: {
            points: score.points,
            fairPlayBye: score.fairPlayApplied,
            data,
            updatedAt: now,
          },
        });
    }
  });
}

export async function mirrorGameStateToPostgres(input: {
  roomCode: string;
  seasonKey: string;
  gameweek: number;
  data: Record<string, unknown>;
}) {
  const now = new Date();
  const data = input.data ?? {};
  await getPostgresDb()
    .insert(games)
    .values({
      roomCode: input.roomCode,
      seasonKey: input.seasonKey,
      gameweek: input.gameweek,
      state: String(data.state || "LOBBY"),
      gameModeStyle: data.gameModeStyle ? String(data.gameModeStyle) : null,
      leaderUid: data.leaderUid ? String(data.leaderUid) : null,
      fixtureIds: Array.isArray(data.fixtureIds)
        ? data.fixtureIds.map(Number).filter(Number.isFinite)
        : [],
      data,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [games.roomCode, games.seasonKey, games.gameweek],
      set: {
        state: String(data.state || "LOBBY"),
        gameModeStyle: data.gameModeStyle ? String(data.gameModeStyle) : null,
        leaderUid: data.leaderUid ? String(data.leaderUid) : null,
        fixtureIds: Array.isArray(data.fixtureIds)
          ? data.fixtureIds.map(Number).filter(Number.isFinite)
          : [],
        data,
        updatedAt: now,
      },
    });
}

export async function mirrorPredictionToPostgres(input: {
  roomCode: string;
  seasonKey: string;
  gameweek: number;
  uid: string;
  fixtureId: number;
  score: string;
}) {
  const now = new Date();
  const data = {
    uid: input.uid,
    fixtureId: input.fixtureId,
    score: input.score,
    updatedAt: now.toISOString(),
  };
  await getPostgresDb()
    .insert(predictions)
    .values({
      roomCode: input.roomCode,
      seasonKey: input.seasonKey,
      gameweek: input.gameweek,
      userId: input.uid,
      fixtureId: input.fixtureId,
      score: input.score,
      data,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        predictions.roomCode,
        predictions.seasonKey,
        predictions.gameweek,
        predictions.userId,
        predictions.fixtureId,
      ],
      set: { score: input.score, data, updatedAt: now },
    });
}

export async function mirrorGoldenPickToPostgres(input: {
  roomCode: string;
  seasonKey: string;
  gameweek: number;
  uid: string;
  fixtureId: number;
  score: string;
  locked: boolean;
}) {
  const now = new Date();
  await getPostgresDb()
    .insert(goldenPicks)
    .values({
      roomCode: input.roomCode,
      seasonKey: input.seasonKey,
      gameweek: input.gameweek,
      userId: input.uid,
      fixtureId: input.fixtureId,
      score: input.score,
      locked: input.locked,
      data: input,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        goldenPicks.roomCode,
        goldenPicks.seasonKey,
        goldenPicks.gameweek,
        goldenPicks.userId,
      ],
      set: {
        fixtureId: input.fixtureId,
        score: input.score,
        locked: input.locked,
        data: input,
        updatedAt: now,
      },
    });
}

export async function mirrorPowerupToPostgres(input: {
  roomCode: string;
  seasonKey: string;
  gameweek: number;
  uid: string;
  fixtureId: number;
  powerupType: "ALL_IN" | "SAFETY_NET";
  locked: boolean;
}) {
  const now = new Date();
  await getPostgresDb()
    .insert(powerups)
    .values({
      roomCode: input.roomCode,
      seasonKey: input.seasonKey,
      gameweek: input.gameweek,
      userId: input.uid,
      fixtureId: input.fixtureId,
      powerupType: input.powerupType,
      locked: input.locked,
      data: input,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        powerups.roomCode,
        powerups.seasonKey,
        powerups.gameweek,
        powerups.userId,
      ],
      set: {
        fixtureId: input.fixtureId,
        powerupType: input.powerupType,
        locked: input.locked,
        data: input,
        updatedAt: now,
      },
    });
}

export async function clearPostgresGameSelections(input: {
  roomCode: string;
  seasonKey: string;
  gameweek: number;
}) {
  const whereGame = <
    T extends typeof predictions | typeof goldenPicks | typeof powerups,
  >(
    table: T,
  ) =>
    and(
      eq(table.roomCode, input.roomCode),
      eq(table.seasonKey, input.seasonKey),
      eq(table.gameweek, input.gameweek),
    );
  await getPostgresDb().transaction(async (tx) => {
    await tx.delete(predictions).where(whereGame(predictions));
    await tx.delete(goldenPicks).where(whereGame(goldenPicks));
    await tx.delete(powerups).where(whereGame(powerups));
  });
}
