import Link from 'next/link';
import { zhCN } from '@/messages/zh-CN';
import StateShell from '@/components/system/StateShell';

/** 404 页面：未匹配路由时的友好提示。 */
export default function NotFound() {
  const t = zhCN.errorPages;
  return (
    <StateShell mark="404" eyebrow={t.notFoundEyebrow} title={t.notFoundTitle} body={t.notFoundBody}>
        <Link href="/" className="btn-primary">
          {t.backHome}
        </Link>
        <Link href="/app" className="btn-outline">
          {t.goWorkbench}
        </Link>
    </StateShell>
  );
}
