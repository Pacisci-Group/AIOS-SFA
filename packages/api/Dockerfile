FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
RUN npm ci --workspace @sfa/shared --workspace @sfa/api 2>/dev/null || \
    npm install --workspace @sfa/shared --workspace @sfa/api

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api
RUN npm run build -w @sfa/shared && npm run build -w @sfa/api

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/api/dist ./packages/api/dist

EXPOSE 4000
CMD ["node", "packages/api/dist/main.js"]
