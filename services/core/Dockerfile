FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates tini && rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages --no-cache-dir 'yt-dlp[default]==2026.8.19'
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=peer --ignore-scripts --no-audit --no-fund

FROM dependencies AS validation
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY tsconfig.json ./
COPY src src
COPY tests tests
COPY benchmarks benchmarks
COPY quiz-playlists.json ./
RUN npm run check && npm test && touch /app/validation.ok

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --omit=peer --ignore-scripts --no-audit --no-fund

FROM base AS final
COPY --from=production-dependencies /app/node_modules node_modules
COPY --from=validation /app/src src
COPY --from=validation /app/validation.ok /app/validation.ok
COPY --from=validation /app/quiz-playlists.json ./
COPY package.json ./
COPY licenses licenses
RUN mkdir -p /data && chown node:node /data
USER node
RUN node src/guess-pack.ts --list
ENV DATA_DIR=/data CORE_PORT=3990
ENTRYPOINT ["tini","--"]
CMD ["node","src/main.ts"]
