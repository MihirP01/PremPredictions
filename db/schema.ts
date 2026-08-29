import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const appUsers = pgTable("app_users", {
  firebaseUid: varchar("firebase_uid", { length: 128 }).primaryKey(),
  email: text("email"),
  displayName: varchar("display_name", { length: 64 }),
  currentRoomCode: varchar("current_room_code", { length: 24 }),
  sourceData: jsonb("source_data")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const rooms = pgTable(
  "rooms",
  {
    code: varchar("code", { length: 24 }).primaryKey(),
    leaderUid: varchar("leader_uid", { length: 128 }).notNull(),
    gameModeStyle: varchar("game_mode_style", { length: 24 })
      .notNull()
      .default("sprint"),
    sameResultLock: boolean("same_result_lock").notNull().default(false),
    powerupsEnabled: boolean("powerups_enabled").notNull().default(false),
    leagueFairPlayEnabled: boolean("league_fair_play_enabled")
      .notNull()
      .default(false),
    themeAccent: varchar("theme_accent", { length: 24 })
      .notNull()
      .default("teal"),
    hasPassword: boolean("has_password").notNull().default(false),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sourceData: jsonb("source_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("rooms_leader_uid_idx").on(table.leaderUid)],
);

export const roomMembers = pgTable(
  "room_members",
  {
    roomCode: varchar("room_code", { length: 24 })
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 128 })
      .notNull()
      .references(() => appUsers.firebaseUid, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).notNull().default("member"),
    displayName: varchar("display_name", { length: 64 }),
    nickname: varchar("nickname", { length: 64 }),
    sourceData: jsonb("source_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roomCode, table.userId] }),
    index("room_members_user_id_idx").on(table.userId),
    index("room_members_room_code_idx").on(table.roomCode),
  ],
);

export const roomSecurity = pgTable("room_security", {
  roomCode: varchar("room_code", { length: 24 })
    .primaryKey()
    .references(() => rooms.code, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  updatedBy: varchar("updated_by", { length: 128 }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const seasons = pgTable(
  "seasons",
  {
    roomCode: varchar("room_code", { length: 24 })
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    seasonKey: varchar("season_key", { length: 16 }).notNull(),
    sourceData: jsonb("source_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.roomCode, table.seasonKey] })],
);

export const games = pgTable(
  "games",
  {
    roomCode: varchar("room_code", { length: 24 }).notNull(),
    seasonKey: varchar("season_key", { length: 16 }).notNull(),
    gameweek: integer("gameweek").notNull(),
    state: varchar("state", { length: 24 }).notNull().default("LOBBY"),
    gameModeStyle: varchar("game_mode_style", { length: 24 }),
    leaderUid: varchar("leader_uid", { length: 128 }),
    fixtureIds: jsonb("fixture_ids").$type<number[]>().notNull().default([]),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roomCode, table.seasonKey, table.gameweek] }),
    index("games_room_season_idx").on(table.roomCode, table.seasonKey),
  ],
);

export const gameLobby = pgTable(
  "game_lobby",
  {
    roomCode: varchar("room_code", { length: 24 }).notNull(),
    seasonKey: varchar("season_key", { length: 16 }).notNull(),
    gameweek: integer("gameweek").notNull(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    ready: boolean("ready").notNull().default(false),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.roomCode, table.seasonKey, table.gameweek, table.userId],
    }),
  ],
);

export const predictions = pgTable(
  "predictions",
  {
    roomCode: varchar("room_code", { length: 24 }).notNull(),
    seasonKey: varchar("season_key", { length: 16 }).notNull(),
    gameweek: integer("gameweek").notNull(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    fixtureId: bigint("fixture_id", { mode: "number" }).notNull(),
    score: varchar("score", { length: 8 }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.roomCode,
        table.seasonKey,
        table.gameweek,
        table.userId,
        table.fixtureId,
      ],
    }),
    index("predictions_game_idx").on(
      table.roomCode,
      table.seasonKey,
      table.gameweek,
    ),
  ],
);

export const goldenPicks = pgTable(
  "golden_picks",
  {
    roomCode: varchar("room_code", { length: 24 }).notNull(),
    seasonKey: varchar("season_key", { length: 16 }).notNull(),
    gameweek: integer("gameweek").notNull(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    fixtureId: bigint("fixture_id", { mode: "number" }),
    score: varchar("score", { length: 8 }),
    locked: boolean("locked").notNull().default(false),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.roomCode, table.seasonKey, table.gameweek, table.userId],
    }),
  ],
);

export const powerups = pgTable(
  "powerups",
  {
    roomCode: varchar("room_code", { length: 24 }).notNull(),
    seasonKey: varchar("season_key", { length: 16 }).notNull(),
    gameweek: integer("gameweek").notNull(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    fixtureId: bigint("fixture_id", { mode: "number" }),
    powerupType: varchar("powerup_type", { length: 32 }),
    locked: boolean("locked").notNull().default(false),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.roomCode, table.seasonKey, table.gameweek, table.userId],
    }),
  ],
);

export const weeklyScores = pgTable(
  "weekly_scores",
  {
    roomCode: varchar("room_code", { length: 24 }).notNull(),
    seasonKey: varchar("season_key", { length: 16 }).notNull(),
    gameweek: integer("gameweek").notNull(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    points: doublePrecision("points").notNull().default(0),
    fairPlayBye: boolean("fair_play_bye").notNull().default(false),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.roomCode, table.seasonKey, table.gameweek, table.userId],
    }),
    index("weekly_scores_leaderboard_idx").on(
      table.roomCode,
      table.seasonKey,
      table.userId,
    ),
  ],
);

export const yearTablePicks = pgTable(
  "year_table_picks",
  {
    roomCode: varchar("room_code", { length: 24 }).notNull(),
    seasonKey: varchar("season_key", { length: 16 }).notNull(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    clubOrder: jsonb("club_order").$type<string[]>().notNull().default([]),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roomCode, table.seasonKey, table.userId] }),
  ],
);

export const userYearTablePicks = pgTable(
  "user_year_table_picks",
  {
    seasonKey: varchar("season_key", { length: 16 }).notNull(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    clubOrder: jsonb("club_order").$type<string[]>().notNull().default([]),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.seasonKey, table.userId] }),
    index("user_year_table_picks_user_id_idx").on(table.userId),
  ],
);

export const fixtureSnapshots = pgTable(
  "fixture_snapshots",
  {
    seasonKey: varchar("season_key", { length: 16 }).notNull(),
    gameweek: integer("gameweek").notNull(),
    fixtures: jsonb("fixtures")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    source: varchar("source", { length: 48 }),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.seasonKey, table.gameweek] })],
);

export const providerSnapshots = pgTable(
  "provider_snapshots",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    kind: varchar("kind", { length: 32 }).notNull(),
    seasonKey: varchar("season_key", { length: 16 }).notNull(),
    gameweek: integer("gameweek"),
    fixtureId: bigint("fixture_id", { mode: "number" }),
    source: varchar("source", { length: 48 }),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("provider_snapshots_lookup_idx").on(
      table.kind,
      table.seasonKey,
      table.gameweek,
      table.fixtureId,
      table.capturedAt,
    ),
  ],
);

export const seasonClubs = pgTable(
  "season_clubs",
  {
    seasonKey: varchar("season_key", { length: 16 }).notNull(),
    teamId: integer("team_id").notNull(),
    name: text("name").notNull(),
    tla: varchar("tla", { length: 12 }),
    shortName: text("short_name"),
    badgeUrl: text("badge_url"),
    source: varchar("source", { length: 32 })
      .notNull()
      .default("football-data"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.seasonKey, table.teamId] }),
    index("season_clubs_season_key_idx").on(table.seasonKey),
  ],
);
