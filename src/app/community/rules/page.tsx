import type { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import { zhCN } from '@/messages/zh-CN';

export const metadata: Metadata = { title: zhCN.communityAdmin.rulesTitle };
export default function CommunityRulesPage() {
  return <main id="main" className="workspace-page"><SiteHeader title="豆社社区规则" currentPath="/community/rules" subtitle="围绕作品与制作友善交流" /><div className="workspace-content community-narrow prose-policy"><h2>欢迎分享可以安全公开的作品</h2><p>投稿必须是你有权发布的图纸，不得包含明确伤害、骚扰、色情内容或垃圾推广。豆社不使用政治词库，也不会因为词表命中自动封号。</p><h2>审核如何工作</h2><p>作品修订经过人工审核后才公开；新修订审核期间，已有公开版保持可见。高风险评论进入待审，由审核员结合语境处置。</p><h2>你可以控制什么</h2><p>作者可以撤回投稿；管理员下架会记录理由并提供申诉路径。撤回或下架后禁止新增引用，已经创建的私人副本不受影响。</p><h2>处理范围</h2><p>举报类别限于骚扰、色情、明确伤害、垃圾推广、版权与其他明确规则问题。不同意见本身不是处罚理由。</p></div></main>;
}
