import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright intentionally opens the dev server through the IPv4 loopback
  // address so Chromium, Firefox and WebKit exercise the same origin.
  // 局域网验收（手机连同一 WiFi 访问 next dev）时，把本机 LAN 地址放进
  // DEV_LAN_ORIGIN 即可，不要把某台机器的内网 IP 写进版本库。仅影响 next dev。
  allowedDevOrigins: ["127.0.0.1", ...(process.env.DEV_LAN_ORIGIN ? [process.env.DEV_LAN_ORIGIN] : [])],
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
