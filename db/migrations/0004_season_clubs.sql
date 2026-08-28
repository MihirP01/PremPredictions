CREATE TABLE IF NOT EXISTS "season_clubs" (
	"season_key" varchar(16) NOT NULL,
	"team_id" integer NOT NULL,
	"name" text NOT NULL,
	"tla" varchar(12),
	"short_name" text,
	"badge_url" text,
	"source" varchar(32) DEFAULT 'football-data' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_clubs_season_key_team_id_pk" PRIMARY KEY("season_key","team_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "season_clubs_season_key_idx"
	ON "season_clubs" USING btree ("season_key");
