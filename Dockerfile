# Multi-stage build for the Next.js app + workers.
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production
# FFmpeg is needed by the Phase 2/3 video pipeline.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM base AS runtime
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
EXPOSE 3000
CMD ["npm", "run", "start"]
