CREATE TABLE "fixture_snapshots" (
	"season_key" varchar(16) NOT NULL,
	"gameweek" integer NOT NULL,
	"fixtures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" varchar(48),
	"generated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixture_snapshots_season_key_gameweek_pk" PRIMARY KEY("season_key","gameweek")
);
