# ---------- 构建阶段 ----------
FROM node:20-alpine AS deps
WORKDIR /app
# argon2 的 musl 预编译与新版 alpine musl ABI 不兼容，node-gyp-build 会回退源码编译，
# 因此需要编译工具链（仅构建阶段，运行镜像不受影响）
RUN apk add --no-cache python3 make g++
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
COPY --from=builder /app/db/admin-role.cjs ./db/admin-role.cjs
COPY --from=builder /app/db/migrations ./db/migrations
# 发布检查是构建阶段由正式 schema 打包出的独立只读程序，不携带第二套协议实现。
COPY --from=builder /app/.artifacts/check-protocol-v3.cjs ./deploy/scripts/check-protocol-v3.cjs

# 补全 drizzle-orm：nft 只追踪了 ESM 变体，而 db/migrate.cjs 以 CJS require
# node-postgres/index.cjs 与 node-postgres/migrator 子路径，需整包覆盖。
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

# 补全 argon2：node-gyp-build 动态解析 build/Release 或 prebuilds 中的原生二进制，
# nft 无法静态追踪该路径；整包覆盖保证密码哈希在容器内可用。
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/argon2 ./node_modules/argon2

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
