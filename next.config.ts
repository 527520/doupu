import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署使用 standalone 输出（ADR-0005）
  output: "standalone",
  // PGlite（E2E/开发回退数据库）含原生 WASM 定位逻辑，需保持为服务端外部包
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
