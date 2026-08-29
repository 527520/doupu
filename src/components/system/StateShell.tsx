import type { ReactNode } from 'react';
import Brand from '@/components/layout/Brand';

interface Props {
  mark: string;
  eyebrow: string;
  title: string;
  body: string;
  children: ReactNode;
}

/** Branded full-page frame for recoverable empty and error states. */
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
