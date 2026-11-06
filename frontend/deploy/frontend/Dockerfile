# syntax=docker/dockerfile:1
FROM oven/bun:1.3.14-alpine AS builder
WORKDIR /app
ENV CI=true LEFTHOOK=0
COPY package.json bun.lock ./
COPY packages/solve3/package.json ./packages/solve3/package.json
COPY packages/common/package.json ./packages/common/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --ignore-scripts
COPY . .
ARG NEXT_PUBLIC_MAINNET_RPC_URL=https://api.mainnet-beta.solana.com
ARG NEXT_PUBLIC_CLUSTER=mainnet-beta
ARG NEXT_PUBLIC_DEVNET_RPC_URL=https://api.devnet.solana.com
ARG NEXT_PUBLIC_LAUNCH_PHASE=full
ARG NEXT_PUBLIC_QUEST_TEST_CAMPAIGN=
ARG NEXT_PUBLIC_QUEST_PASS_MINT_ENABLED=false
ENV NEXT_PUBLIC_MAINNET_RPC_URL=${NEXT_PUBLIC_MAINNET_RPC_URL}
ENV NEXT_PUBLIC_CLUSTER=${NEXT_PUBLIC_CLUSTER}
ENV NEXT_PUBLIC_DEVNET_RPC_URL=${NEXT_PUBLIC_DEVNET_RPC_URL}
ENV NEXT_PUBLIC_LAUNCH_PHASE=${NEXT_PUBLIC_LAUNCH_PHASE}
ENV NEXT_PUBLIC_QUEST_TEST_CAMPAIGN=${NEXT_PUBLIC_QUEST_TEST_CAMPAIGN}
ENV NEXT_PUBLIC_QUEST_PASS_MINT_ENABLED=${NEXT_PUBLIC_QUEST_PASS_MINT_ENABLED}
RUN bun run --cwd packages/common build && bun run --cwd packages/sdk build && bun run --cwd packages/solve3 build
RUN --mount=type=cache,target=/app/.next/cache bun run build
FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
EXPOSE 3000
CMD ["bun", "run", "start"]
