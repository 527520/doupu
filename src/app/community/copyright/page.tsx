import type { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import { CONTACT_EMAIL } from '@/lib/appInfo';

export const metadata: Metadata = { title: '豆社版权与申诉' };
export default function CommunityCopyrightPage() {
  return <main id="main" className="workspace-page"><SiteHeader title="版权与申诉" currentPath="/community/copyright" subtitle="有限平台许可说明与人工复核入口" /><div className="workspace-content community-narrow prose-policy"><div className="notice notice-warning">以下有限平台许可与投诉流程是上线前草案，必须完成专业法律审核后才能用于正式服务。</div><h2>有限平台许可</h2><p>作者允许豆谱在站内展示获批作品，并允许登录且已验证邮箱的用户创建仅供其私人使用的独立副本。作者不会因此默认授予站外传播、商业使用或再许可权。</p><h2>侵权投诉</h2><p>权利人可发送作品链接、权属说明、具体侵权理由和可联系信息至 <a className="link-soft" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>。我们会记录案件并由人工复核。</p><h2>处置申诉</h2><p>作者可以通过同一邮箱提交下架或驳回申诉，请附作品编号与事实说明。申诉不会自动恢复内容，复核结论会保留必要审计。</p></div></main>;
}
