'use client';

/** /app 工作台页（T12）：整页为客户端组件组装。 */
import Workbench from '@/components/workbench/Workbench';
import { zhCN } from '@/messages/zh-CN';

export default function AppPage() {
  return (
    <main className="min-h-screen bg-cream">
      <h1 className="sr-only">{zhCN.workbench.title}</h1>
      <Workbench />
    </main>
  );
}
