import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync, cpSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('界面字体交付合同', () => {
  it('仓库交付的字体和许可通过离线预检', () => {
    const result = spawnSync(process.execPath, ['scripts/check-ui-fonts.cjs'], { cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('UI fonts verified');
  });
  it('缺失字体资源会阻止交付，而不是静默回退通过', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'doupu-missing-fonts-'));
    try {
      const result = spawnSync(process.execPath, ['scripts/check-ui-fonts.cjs', directory], { cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[ui-font]');
    } finally { rmSync(directory, { recursive: true }); }
  });
  it('字节损坏不能通过清单校验',()=>{
    const directory=mkdtempSync(resolve(tmpdir(),'doupu-tampered-fonts-'));
    try {
      cpSync(resolve(import.meta.dirname,'../../public/fonts/ui'),directory,{recursive:true});
      appendFileSync(resolve(directory,'text-core.woff2'),'corrupted');
      const result=spawnSync(process.execPath,['scripts/check-ui-fonts.cjs',directory],{cwd:resolve(import.meta.dirname,'../..'),encoding:'utf8'});
      expect(result.status).toBe(1);expect(result.stderr).toContain('checksum mismatch');
    } finally {rmSync(directory,{recursive:true});}
  });
});
