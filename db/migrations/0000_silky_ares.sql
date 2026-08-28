CREATE TABLE "app_users" (
	"firebase_uid" varchar(128) PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" varchar(64),
	"current_room_code" varchar(24),
	"source_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firestore_documents" (
	"path" text PRIMARY KEY NOT NULL,
	"collection_group" varchar(128) NOT NULL,
	"document_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"source_update_time" timestamp with time zone,
	"migrated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_lobby" (
	"room_code" varchar(24) NOT NULL,
	"season_key" varchar(16) NOT NULL,
	"gameweek" integer NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"ready" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_lobby_room_code_season_key_gameweek_user_id_pk" PRIMARY KEY("room_code","season_key","gameweek","user_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"room_code" varchar(24) NOT NULL,
	"season_key" varchar(16) NOT NULL,
	"gameweek" integer NOT NULL,
	"state" varchar(24) DEFAULT 'LOBBY' NOT NULL,
	"game_mode_style" varchar(24),
	"leader_uid" varchar(128),
	"fixture_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_room_code_season_key_gameweek_pk" PRIMARY KEY("room_code","season_key","gameweek")
);
--> statement-breakpoint
CREATE TABLE "golden_picks" (
	"room_code" varchar(24) NOT NULL,
	"season_key" varchar(16) NOT NULL,
	"gameweek" integer NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"fixture_id" bigint,
	"score" varchar(8),
	"locked" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "golden_picks_room_code_season_key_gameweek_user_id_pk" PRIMARY KEY("room_code","season_key","gameweek","user_id")
);
--> statement-breakpoint
CREATE TABLE "powerups" (
	"room_code" varchar(24) NOT NULL,
	"season_key" varchar(16) NOT NULL,
	"gameweek" integer NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"fixture_id" bigint,
	"powerup_type" varchar(32),
	"locked" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "powerups_room_code_season_key_gameweek_user_id_pk" PRIMARY KEY("room_code","season_key","gameweek","user_id")
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"room_code" varchar(24) NOT NULL,
	"season_key" varchar(16) NOT NULL,
	"gameweek" integer NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"fixture_id" bigint NOT NULL,
	"score" varchar(8),
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "predictions_room_code_season_key_gameweek_user_id_fixture_id_pk" PRIMARY KEY("room_code","season_key","gameweek","user_id","fixture_id")
);
--> statement-breakpoint
CREATE TABLE "room_members" (
	"room_code" varchar(24) NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"role" varchar(16) DEFAULT 'member' NOT NULL,
	"display_name" varchar(64),
	"nickname" varchar(64),
	"source_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_members_room_code_user_id_pk" PRIMARY KEY("room_code","user_id")
);
--> statement-breakpoint
CREATE TABLE "room_security" (
	"room_code" varchar(24) PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"updated_by" varchar(128),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"code" varchar(24) PRIMARY KEY NOT NULL,
	"leader_uid" varchar(128) NOT NULL,
	"game_mode_style" varchar(24) DEFAULT 'sprint' NOT NULL,
	"same_result_lock" boolean DEFAULT false NOT NULL,
	"powerups_enabled" boolean DEFAULT false NOT NULL,
	"league_fair_play_enabled" boolean DEFAULT false NOT NULL,
	"theme_accent" varchar(24) DEFAULT 'teal' NOT NULL,
	"has_password" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"room_code" varchar(24) NOT NULL,
	"season_key" varchar(16) NOT NULL,
	"source_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_room_code_season_key_pk" PRIMARY KEY("room_code","season_key")
);
--> statement-breakpoint
CREATE TABLE "weekly_scores" (
	"room_code" varchar(24) NOT NULL,
	"season_key" varchar(16) NOT NULL,
	"gameweek" integer NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"fair_play_bye" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_scores_room_code_season_key_gameweek_user_id_pk" PRIMARY KEY("room_code","season_key","gameweek","user_id")
);
--> statement-breakpoint
CREATE TABLE "year_table_picks" (
	"room_code" varchar(24) NOT NULL,
	"season_key" varchar(16) NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"club_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "year_table_picks_room_code_season_key_user_id_pk" PRIMARY KEY("room_code","season_key","user_id")
);
--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_code_rooms_code_fk" FOREIGN KEY ("room_code") REFERENCES "public"."rooms"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_user_id_app_users_firebase_uid_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("firebase_uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_security" ADD CONSTRAINT "room_security_room_code_rooms_code_fk" FOREIGN KEY ("room_code") REFERENCES "public"."rooms"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_room_code_rooms_code_fk" FOREIGN KEY ("room_code") REFERENCES "public"."rooms"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "firestore_documents_collection_group_idx" ON "firestore_documents" USING btree ("collection_group");--> statement-breakpoint
CREATE UNIQUE INDEX "firestore_documents_path_uidx" ON "firestore_documents" USING btree ("path");--> statement-breakpoint
CREATE INDEX "games_room_season_idx" ON "games" USING btree ("room_code","season_key");--> statement-breakpoint
CREATE INDEX "predictions_game_idx" ON "predictions" USING btree ("room_code","season_key","gameweek");--> statement-breakpoint
CREATE INDEX "room_members_user_id_idx" ON "room_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "room_members_room_code_idx" ON "room_members" USING btree ("room_code");--> statement-breakpoint
CREATE INDEX "rooms_leader_uid_idx" ON "rooms" USING btree ("leader_uid");--> statement-breakpoint
CREATE INDEX "weekly_scores_leaderboard_idx" ON "weekly_scores" USING btree ("room_code","season_key","user_id");