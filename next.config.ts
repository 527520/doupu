import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署使用 standalone 输出（ADR-0005）
  output: "standalone",
};

export default nextConfig;
