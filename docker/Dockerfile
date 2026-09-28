# Official image: docker build -f docker/Dockerfile -t stagegrid .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY examples ./examples
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @stagegrid/admin build && pnpm --filter @stagegrid/core build
RUN mkdir -p /out && cd packages/core && pnpm pack --pack-destination /out

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build /out/*.tgz /tmp/
RUN npm init -y >/dev/null && npm install --omit=dev /tmp/stagegrid-core-*.tgz && rm /tmp/*.tgz
EXPOSE 4000
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "stagegrid", "start"]
