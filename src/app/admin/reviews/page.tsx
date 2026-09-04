import ReviewConsole from '@/components/admin/ReviewConsole';

export default function ReviewsPage() {
  return <main id="main" className="admin-page"><header className="admin-page-header"><div><span>MODERATION / WORKS</span><h1>作品审核</h1></div><p>左侧队列 · 中部校样 · 右侧处置</p></header><ReviewConsole /></main>;
}
