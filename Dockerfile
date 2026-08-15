# ---------- 构建阶段 ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apk add --no-cache openssl curl \
  && addgroup -S nodejs \
  && adduser -S nextjs -G nodejs

# standalone 服务 + 静态资源 + 公共目录（含 PDF 中文字体）
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 迁移：独立脚本 + 迁移目录（drizzle-orm/pg 为生产依赖，随 standalone 打包）
COPY --from=builder /app/db/migrate.cjs ./db/migrate.cjs
COPY --from=builder /app/db/migrations ./db/migrations

# 补全 drizzle-orm：nft 只追踪了 ESM 变体，而 db/migrate.cjs 以 CJS require
# node-postgres/index.cjs 与 node-postgres/migrator 子路径，需整包覆盖。
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
