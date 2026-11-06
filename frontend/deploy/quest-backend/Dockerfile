# Devnet Quest/Pass test backend image. Contains only the reviewed Quest/Genesis modules, their
# SQL migrations, the server and the operator tools. No fixture, in-memory test double or secret.
FROM oven/bun:1.3.14-alpine
WORKDIR /app
RUN printf '{"name":"solve3-quest-backend","private":true,"type":"module"}\n' > package.json \
 && bun add pg@8.23.0 tweetnacl@1.0.3 bs58@6.0.0 @solana/web3.js@1.99.0 @solana/spl-token@0.4.13
COPY scripts/quest ./scripts/quest
COPY scripts/genesis-migrate.mjs ./scripts/genesis-migrate.mjs
COPY db/migrations ./db/migrations
COPY db/quest ./db/quest
COPY src/lib/genesis ./src/lib/genesis
COPY deploy/quest-backend/quest-test-server.mjs deploy/quest-backend/apply-schema.mjs deploy/quest-backend/provision.mjs deploy/quest-backend/create-pass-authority.mjs deploy/quest-backend/swap-worker.mjs deploy/quest-backend/swap-seed.mjs deploy/quest-backend/swap-grants.mjs deploy/quest-backend/xp-settler.mjs deploy/quest-backend/lp-feed-worker.mjs deploy/quest-backend/provision-weekly-policy.mjs ./server/
RUN rm -f scripts/quest/test-*.mjs scripts/quest/rehearse-* && chown -R bun:bun /app
USER bun
EXPOSE 8080
CMD ["bun", "server/quest-test-server.mjs"]
