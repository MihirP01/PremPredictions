# TrueNAS PostgreSQL deployment

This deployment deliberately does not include `cloudflared`. Reuse the existing
TrueNAS tunnel and route the new public hostname to `http://<TRUENAS-IP>:3010`.

Before installing `compose.yaml` as a TrueNAS Custom App:

1. Replace `/mnt/tank` with the real pool path and create the PostgreSQL dataset.
2. Replace both copies of `CHANGE_TO_A_LONG_URL_SAFE_PASSWORD` with the same
   URL-safe password.
3. Replace the Firebase Admin, football data, and cron placeholders.
4. Build the app image with the four documented `NEXT_PUBLIC_FIREBASE_*` build arguments.
5. Add the public hostname to Firebase Authentication's authorized domains.

Run `npm run db:backfill` and `npm run db:verify` before deploying this version.
PostgreSQL is then the only application data store for rooms, players, game
data, and leaderboards. Firebase remains enabled for Authentication only.

PostgreSQL is only attached to the internal Compose network. Port 5432 is not
published. Configure TrueNAS snapshots and an off-box backup for the PostgreSQL
dataset before cutover.
