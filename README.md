# PL Predictions

Multiplayer Premier League prediction app with:

- room-based play,
- minigame draft + golden pick flow,
- saved score docs for leaderboard,
- mobile-first UI + PWA support.

## Tech Stack

- Next.js 16 (App Router)
- React 19 + TypeScript
- Tailwind CSS v4
- Firebase Auth + Firestore
- Firebase Admin SDK (server API routes)
- Vercel-ready deployment

## Core Features

- **Room system**: create/join/switch/leave rooms, leader role controls.
- **Live modes**: Captain, Round-Robin, and Sprint use the shared lobby flow.
- **League mode**: room-wide asynchronous, one-shot gameweek submissions. Every
  eligible fixture is required and locks on submit; optional Fair Play awards a
  completely missed week the submitted-player median as a labelled bye.
- **Scoring**:
  - exact score = 2 points
  - correct result (W/D/L) = 1 point
  - wrong result = 0 points
  - golden pick doubles points
- **Leaderboard**:
  - reads only saved `scores` docs
  - leader tool recalculates latest 3 GWs
  - mobile-friendly GW view + desktop matrix
- **PWA**: installable app with generated icons and iOS-safe layout handling.

## Project Structure

- `app/room-gate/page.tsx` - room entry/join/create flow
- `app/room/[roomCode]/page.tsx` - room home + settings
- `app/room/[roomCode]/fixtures/page.tsx` - fixtures + room picks display
- `app/room/[roomCode]/leaderboard/page.tsx` - leaderboard + leader tools
- `app/room/[roomCode]/minigame/*` - lobby, draft play, golden, reveal
- `app/api/*` - server routes for fixtures/game actions/score calc/room delete
- `firebase.ts` - client Firebase init
- `firebase-admin.ts` - admin Firebase init for secure server writes
- `firestore.rules` - Firestore security rules

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Environment Variables

Create `.env.local`:

```bash
# Client Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Server Firebase Admin
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Football data provider
FOOTBALLDATA_KEY=
```

Notes:

- `FIREBASE_PRIVATE_KEY` supports multiline PEM and `\n` format.
- Server routes use Admin SDK, so Firestore write rules can stay locked down for client writes.

## Firestore Rules

Rules are in `firestore.rules`.

If using Firebase CLI, deploy with:

```bash
firebase deploy --only firestore:rules
```

## API Endpoints

- `GET /api/current-gameweek`
- `GET /api/fixtures?gameweek=<n>`
- `POST /api/game/start`
- `POST /api/game/pick`
- `POST /api/game/league-picks`
- `POST /api/game/golden`
- `POST /api/game/score`
- `POST /api/room/delete`

## Deployment (Vercel)

1. Push repo to GitHub.
2. Import in Vercel.
3. Add all env vars (same names as above).
4. Deploy.

If iOS Home Screen / browser spacing looks different, clear old installed PWA cache after major UI changes and reinstall.
