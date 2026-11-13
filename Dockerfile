FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ping --fetch-retries=0 --fetch-timeout=10000 \
    || { echo 'Docker build cannot reach the npm registry. Check DNS and HTTPS access to registry.npmjs.org.' >&2; exit 1; }
RUN npm install --no-audit --fetch-retries=1 --fetch-timeout=30000
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev --offline --no-audit

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY agents ./agents
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
