import TagsManager from '@/components/admin/TagsManager';

export default function AdminTagsPage() {
  return <main className="admin-page"><header className="admin-page-header"><span>04 / TAXONOMY</span><h1>正式标签</h1><p>创建、改名、排序、停用与合并均保留审计事实。</p></header><TagsManager /></main>;
}
