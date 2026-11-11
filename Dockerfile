# Production image for Google Cloud Run.
# Build:  docker build -t sales-marketing-tools .
# Run:    docker run -p 8080:8080 --env-file .env sales-marketing-tools
#
# Migrations (run once per release, before the new revision gets traffic):
#   docker build --target migrate -t sales-marketing-tools-migrate .
#   → deploy as a Cloud Run Job with DATABASE_URL (or DATABASE_URL_UNPOOLED) and execute it.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Plain SQL migrations in drizzle/ (drizzle-kit migrate). No seed: production gets no demo data.
FROM node:22-alpine AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src/db/schema.ts ./src/db/schema.ts
CMD ["npx", "drizzle-kit", "migrate"]

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
