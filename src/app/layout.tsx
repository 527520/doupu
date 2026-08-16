import type { Metadata, Viewport } from 'next';
import './globals.css';
import { zhCN } from '@/messages/zh-CN';
import { APP_NAME } from '@/lib/appInfo';

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: `${zhCN.app.name} - ${zhCN.app.tagline}`,
    template: `%s - ${zhCN.app.name}`,
  },
  description: zhCN.app.description,
  applicationName: APP_NAME,
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    siteName: APP_NAME,
    title: `${zhCN.app.name} - ${zhCN.app.tagline}`,
    description: zhCN.app.description,
    url: '/',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: `${APP_NAME} 预览` }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${zhCN.app.name} - ${zhCN.app.tagline}`,
    description: zhCN.app.description,
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
  icons: { icon: '/favicon.ico' },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
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
