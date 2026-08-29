CREATE TABLE IF NOT EXISTS "provider_snapshots" (
	"id" bigserial PRIMARY KEY,
	"kind" varchar(32) NOT NULL,
	"season_key" varchar(16) NOT NULL,
	"gameweek" integer,
	"fixture_id" bigint,
	"source" varchar(48),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_snapshots_lookup_idx"
	ON "provider_snapshots" USING btree (
		"kind",
		"season_key",
		"gameweek",
		"fixture_id",
		"captured_at" DESC
	);
--> statement-breakpoint
INSERT INTO "provider_snapshots" (
	"kind",
	"season_key",
	"gameweek",
	"fixture_id",
	"source",
	"payload",
	"payload_hash",
	"captured_at"
)
SELECT
	'fixtures',
	"season_key",
	"gameweek",
	NULL,
	"source",
	jsonb_build_object(
		'seasonKey', "season_key",
		'fixtures', "fixtures",
		'source', "source",
		'generatedAt', "generated_at"
	),
	encode(sha256(convert_to("fixtures"::text, 'UTF8')), 'hex'),
	COALESCE("generated_at", "updated_at", now())
FROM "fixture_snapshots"
WHERE jsonb_typeof("fixtures") = 'array'
  AND jsonb_array_length("fixtures") > 0;
