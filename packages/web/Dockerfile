FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json ./packages/web/
RUN npm ci --workspace @sfa/shared --workspace @sfa/web 2>/dev/null || \
    npm install --workspace @sfa/shared --workspace @sfa/web

FROM base AS build
# Copy the whole installed tree, not just /app/node_modules: npm nests packages
# it cannot hoist (@hookform/resolvers and ajv* conflict with the root ajv) under
# packages/web/node_modules, and copying only the root silently drops them —
# surfacing later as a TS2307 "cannot find module" during `tsc --noEmit`.
COPY --from=deps /app ./
COPY package.json ./
COPY packages/shared ./packages/shared
COPY packages/web ./packages/web
RUN npm run build -w @sfa/web

FROM nginx:alpine AS runner
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
