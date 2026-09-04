import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('community search indexing boundary', () => {
  it('renders the database-backed sitemap at request time and excludes private routes', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/sitemap.ts'), 'utf8');
    expect(source).toContain("export const dynamic = 'force-dynamic'");
    expect(source).not.toMatch(/routes\s*=\s*\[[^\]]*['"]\/admin/u);
    expect(source).not.toMatch(/routes\s*=\s*\[[^\]]*['"]\/community\/mine/u);
    expect(source).not.toMatch(/routes\s*=\s*\[[^\]]*['"]\/community\/submit/u);
  });
});
