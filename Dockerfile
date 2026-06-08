# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:22-slim AS deps

# OpenSSL is required by Prisma's query engine
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
# prisma generate runs as postinstall — it needs the schema and config up front
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install

# ── Stage 2: Build the Next.js app ────────────────────────────────────────────
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Stage 3: Production runtime ───────────────────────────────────────────────
FROM node:22-slim AS runner

WORKDIR /app

# System libraries required by Playwright's Chromium + ffmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Copy built app and dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY package*.json ./
COPY next.config.ts ./
COPY tsconfig.json ./

# Install Playwright's own version-matched Chromium + ffmpeg into a known path.
# Workspace node_modules symlinks back here so both the app crawler and the
# spawned test runner use the same browser binary.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-browsers
RUN npx playwright install chromium ffmpeg

# Persistent storage for sessions, LLM config, and app settings
RUN mkdir -p /app/.testpilot

EXPOSE 3000
ENV NODE_ENV=production

CMD ["npm", "start"]
