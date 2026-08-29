import type { ReactNode } from 'react';
import Brand from '@/components/layout/Brand';

interface Props {
  mark: string;
  eyebrow: string;
  title: string;
  body: string;
  children: ReactNode;
}

/** 可恢复空态与错误态共用的品牌化全页框架。 */
export default function StateShell({ mark, eyebrow, title, body, children }: Props) {
  return (
    <main id="main" className="state-studio-page">
      <header className="state-studio-header">
        <Brand />
        <span>{eyebrow}</span>
      </header>
      <section className="state-studio-card">
        <div className="state-studio-art" aria-hidden="true">
          <span>{mark}</span>
          <i /><i /><i />
        </div>
        <div className="state-studio-copy">
          <p className="studio-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{body}</p>
          <div className="state-studio-actions">{children}</div>
        </div>
      </section>
    </main>
  );
}
