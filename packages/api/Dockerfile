FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
RUN npm ci --workspace @sfa/shared --workspace @sfa/api 2>/dev/null || \
    npm install --workspace @sfa/shared --workspace @sfa/api

FROM base AS build
# Copy the whole installed tree, not just /app/node_modules: npm nests packages
# it cannot hoist (inngest pins its own zod, which conflicts with the root zod)
# under packages/api/node_modules, and copying only the root silently drops them —
# surfacing later as a TS2307 "cannot find module 'inngest'" during `nest build`.
COPY --from=deps /app ./
COPY package.json ./
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api
RUN npm run build -w @sfa/shared && npm run build -w @sfa/api

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Same reasoning as the build stage: the nested workspace node_modules carry
# packages the app needs at runtime, so take the installed tree wholesale.
COPY --from=deps /app ./
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/api/dist ./packages/api/dist

EXPOSE 4000
CMD ["node", "packages/api/dist/main.js"]
