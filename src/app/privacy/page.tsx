import type { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import { AnalyticsConsentSettings } from '@/components/analytics/AnalyticsConsent';
import { zhCN } from '@/messages/zh-CN';

export const metadata: Metadata = { title: zhCN.communityAdmin.privacyTitle };

export default function PrivacyPage() {
  return (
    <main id="main" className="workspace-page">
      <SiteHeader title="隐私与匿名分析" currentPath="/privacy" subtitle="先同意，再采集；拒绝不影响使用" />
      <div className="workspace-content info-page-content">
        <section className="info-hero">
          <div>
            <span className="studio-eyebrow">第一方 · 匿名 · 可撤回</span>
            <h2>你的作品内容不进入分析系统</h2>
            <p>豆谱仅在你明确同意后记录功能使用趋势。访客标识是随机令牌，服务器只保存哈希，不使用设备指纹。</p>
          </div>
        </section>
        <div className="info-card-grid">
          <section className="info-card"><h2>会记录什么</h2><p>事件类别、标准化页面路径、设备/浏览器/系统类别、UTM source/medium/campaign/content，以及稳定错误码。</p></section>
          <section className="info-card"><h2>绝不记录什么</h2><p>原图、文件名、图纸正文、评论正文、搜索原文、分享令牌、完整 IP、完整 User-Agent 或邮箱。</p></section>
          <section className="info-card"><h2>保存多久</h2><p>原始匿名事件最多保存 90 天；去标识的每日总量与单维趋势最多保存两年。</p></section>
          <section className="info-card"><h2>撤回后</h2><p>立即停止采集，并清除该访客尚存的原始事件和身份关联；已经生成且无法回溯到个人的日聚合保留。</p></section>
        </div>
        <AnalyticsConsentSettings />
      </div>
    </main>
  );
}
