# PostgreSQL cutover

Firebase Authentication remains the identity provider. PostgreSQL is the only
runtime application data store; there are no read or write feature flags.

## One-time cutover

Run these commands against the final Firestore data immediately before the new
application version is deployed:

```bash
node scripts/firestore-to-postgres.mjs
node scripts/verify-postgres-migration.mjs
```

The backfill is idempotent. The verifier must pass before deploying the
PostgreSQL-only version. Keep the `firestore_documents` archive table until a
tested PostgreSQL backup has been retained; it is not read by the application.

## Deployment

`DATABASE_URL` and the Firebase Auth service-account variables are required.
`POSTGRES_ROOM_READS` and `POSTGRES_MIRROR_WRITES` have been removed.

After deployment, test room creation/joining, each game mode, League submission,
leaderboard recalculation, fixture refresh, nickname/settings changes, and an
installed PWA launched from its home-screen icon.

## Rollback

This release does not write Firestore. A rollback to an older dual-write build
would lose PostgreSQL-only mutations. Roll back the application and database
together from a pre-deploy snapshot, or forward-fix the new release.
