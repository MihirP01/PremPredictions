CREATE TABLE IF NOT EXISTS "user_year_table_picks" (
	"season_key" varchar(16) NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"club_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_year_table_picks_season_key_user_id_pk" PRIMARY KEY("season_key","user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_year_table_picks_user_id_idx"
	ON "user_year_table_picks" USING btree ("user_id");
--> statement-breakpoint
INSERT INTO "user_year_table_picks"
	("season_key", "user_id", "club_order", "data", "submitted_at", "updated_at")
SELECT DISTINCT ON ("season_key", "user_id")
	"season_key", "user_id", "club_order", "data", "submitted_at", "updated_at"
FROM "year_table_picks"
WHERE jsonb_typeof("club_order") = 'array'
	AND jsonb_array_length("club_order") = 20
ORDER BY "season_key", "user_id", "submitted_at" ASC NULLS LAST, "updated_at" ASC
ON CONFLICT ("season_key", "user_id") DO NOTHING;
