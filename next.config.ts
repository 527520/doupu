import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";
import { collectAllowedDevOrigins } from "./src/lib/config/devOrigins";

const allowedDevOrigins = collectAllowedDevOrigins(process.env.DEV_LAN_ORIGIN, networkInterfaces());

const nextConfig: NextConfig = {
  experimental: {
    authInterrupts: true,
  },
  // Playwright intentionally opens the dev server through the IPv4 loopback
  // address so Chromium, Firefox and WebKit exercise the same origin.
  // 当前机器的局域网 IPv4 会自动加入；DEV_LAN_ORIGIN 保留给域名或隧道来源。
  // 仅影响 next dev，不改变生产环境的来源策略。
  allowedDevOrigins,
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      {
        // 字体文件名固定，内容随发版重建；长缓存避免每次导出 PDF 重新下载（A-04）。
        source: "/fonts/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
  // Docker 部署使用 standalone 输出（ADR-0005）
  output: "standalone",
  // 运行时以 require 加载的包需保持为服务端外部包，确保被 nft 追踪进 standalone/node_modules：
  // - PGlite（E2E/开发回退数据库）含原生 WASM 定位逻辑；
  // - drizzle-orm 被 db/migrate.cjs 直接 require（部署时在容器内执行迁移），
  //   不外部化则被打进 webpack chunk、不在 node_modules 中，迁移会 MODULE_NOT_FOUND。
  serverExternalPackages: ["@electric-sql/pglite", "drizzle-orm"],
};

export default nextConfig;
