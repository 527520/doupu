import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署使用 standalone 输出（ADR-0005）
  output: "standalone",
  // 运行时以 require 加载的包需保持为服务端外部包，确保被 nft 追踪进 standalone/node_modules：
  // - PGlite（E2E/开发回退数据库）含原生 WASM 定位逻辑；
  // - drizzle-orm 被 db/migrate.cjs 直接 require（部署时在容器内执行迁移），
  //   不外部化则被打进 webpack chunk、不在 node_modules 中，迁移会 MODULE_NOT_FOUND。
  serverExternalPackages: ["@electric-sql/pglite", "drizzle-orm"],
};

export default nextConfig;
