import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import '../../public/fonts/ui/fonts.css';
import { zhCN } from '@/messages/zh-CN';
import { APP_NAME } from '@/lib/appInfo';
import ClientReadyMarker from '@/components/system/ClientReadyMarker';
import { ConsentPlacement } from '@/components/analytics/ConsentPlacement';
import PageViewTracker from '@/components/analytics/PageViewTracker';

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
  themeColor: '#FAF8F4',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading request headers opts the entire tree into dynamic rendering. This
  // is required for Next.js to attach the request-scoped CSP nonce to its RSC
  // and framework scripts.
  // 同一个 nonce 还要给 React Aria 用：它的 usePress / usePreventScroll 会在
  // 客户端注入静态 <style>，并去文档里找 meta[name="csp-nonce"] 取 nonce
  // （react-aria/dist/private/utils/getMetaValue.js）。少了这个 meta，生产
  // style-src-elem 的 nonce 策略会拦掉这两条规则（E2E 08 生产冒烟可捕获）。
  const nonce = (await headers()).get('x-nonce');

  return (
    <html lang="zh-CN">
      <head>{nonce ? <meta name="csp-nonce" content={nonce} /> : null}</head>
      <body className="antialiased">
        {/*
          跳到主内容（D-9）：键盘用户此前必须逐个 Tab 过站内导航（工作台里还有
          页签与工具条）才能到图纸。链接平时不可见，获得焦点时出现在左上角。
          各页面的 <main> 都带 id="main"，见 .skip-link 样式。
        */}
        <a href="#main" className="skip-link">
          {zhCN.nav.skipToMain}
        </a>
        <ClientReadyMarker />
        <PageViewTracker />
        <ConsentPlacement>{children}</ConsentPlacement>
      </body>
    </html>
  );
}
