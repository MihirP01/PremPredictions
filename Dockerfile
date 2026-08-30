# syntax=docker/dockerfile:1
FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# npm can omit platform-specific optional packages from a lockfile generated on
# macOS. Install the native Tailwind/Lightning CSS bindings explicitly for the
# x86_64 Alpine image used by TrueNAS builds.
RUN npm ci \
  && npm install --no-save --no-package-lock \
    lightningcss-linux-x64-musl@1.30.2 \
    @tailwindcss/oxide-linux-x64-musl@4.1.18

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID

ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Production dependencies include pg for the pre-start schema migrator.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/db/migrations ./db/migrations
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate-postgres.mjs ./scripts/migrate-postgres.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/backfill-fair-play.mjs ./scripts/backfill-fair-play.mjs

USER nextjs
EXPOSE 3000

CMD ["sh", "-c", "node scripts/migrate-postgres.mjs && node server.js"]
