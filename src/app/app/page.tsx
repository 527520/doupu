'use client';

/** /app 工作台页（T12）：整页为客户端组件组装。 */
import Workbench from '@/components/workbench/Workbench';

export default function AppPage() {
  return (
    <main className="min-h-screen bg-cream">
      <Workbench />
    </main>
  );
}
