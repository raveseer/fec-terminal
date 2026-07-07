# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# --chown so the unprivileged `node` user can read files regardless of
# host file permissions in the build context (COPY preserves mode bits)
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
COPY --from=build --chown=node:node /app/dist ./dist
# writable data dir for the sqlite cache (mounted as a volume in compose)
RUN mkdir -p /app/data && chown node:node /app/data
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
