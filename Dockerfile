# ==============================================================================
# SpinnerMine Cloud — Production Container for Google Cloud Run
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
RUN npm ci

# Copy full application source and compile frontend distribution
COPY . .
RUN npm run build

# Production Runner Stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled frontend assets and server entry point
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json

# Install tsx for running server.ts in Node 22
RUN npm install -g tsx

EXPOSE 8080

CMD ["tsx", "server.ts"]
