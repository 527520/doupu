import type { Metadata } from "next";
import "./globals.css";
import { zhCN } from "@/messages/zh-CN";

export const metadata: Metadata = {
  title: {
    default: `${zhCN.app.name} - ${zhCN.app.tagline}`,
    template: `%s - ${zhCN.app.name}`,
  },
  description: zhCN.app.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
