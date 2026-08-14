import { describe, expect, it } from 'vitest';
import {
  applyRemote,
  compareUpdatedAt,
  markLocalDeleted,
  reconcile,
  upsertLocal,
  type SyncRecord,
} from './engine';

const rec = (id: string, updatedAt: string, over: Partial<SyncRecord> = {}): SyncRecord => ({
  id,
  updatedAt,
  deleted: false,
  project: null,
  ...over,
});

describe('compareUpdatedAt', () => {
  it('ISO UTC 字符串字典序即时间序', () => {
    expect(compareUpdatedAt('2026-08-14T10:00:00.000Z', '2026-08-14T10:00:00.000Z')).toBe(0);
    expect(compareUpdatedAt('2026-08-14T10:00:00.000Z', '2026-08-14T11:00:00.000Z')).toBe(-1);
    expect(compareUpdatedAt('2026-08-14T11:00:00.000Z', '2026-08-14T10:00:00.000Z')).toBe(1);
  });
});

describe('reconcile（LWW 核心）', () => {
  it('E35：本地独有 → push；云端独有 → pull；幂等（同状态重放结果为空）', () => {
    const local = [rec('a', 'T1')];
    const cloud = [rec('b', 'T2')];
    const r1 = reconcile(local, cloud);
    expect(r1.toPush.map((x) => x.id)).toEqual(['a']);
    expect(r1.toPull.map((x) => x.id)).toEqual(['b']);
    expect(r1.overwrittenByCloud).toEqual([]);
    // 幂等：双方时间戳一致后无操作
    const settled = reconcile(
      applyRemote(local, r1.toPull),
      [...cloud, ...r1.toPush],
    );
    expect(settled.toPush).toEqual([]);
    expect(settled.toPull).toEqual([]);
  });

  it('E36：双设备同条目 LWW——较新者胜', () => {
    const local = [rec('a', 'T10', { project: { name: 'x' } as never })];
    const cloud = [rec('a', 'T20', { project: { name: 'y' } as never })];
    const r = reconcile(local, cloud);
    expect(r.toPush).toEqual([]);
    expect(r.toPull.map((x) => x.id)).toEqual(['a']);
    expect(r.overwrittenByCloud).toEqual(['a']);
  });

  it('E37：云端删除 vs 本地离线编辑——本地较新复活；云端较新覆盖为删除', () => {
    // 本地编辑较新 → push 本地条目（复活）
    const localEdit = [rec('a', 'T20', { project: { name: 'edited' } as never })];
    const cloudTomb = [rec('a', 'T10', { deleted: true })];
    expect(reconcile(localEdit, cloudTomb).toPush.map((x) => x.id)).toEqual(['a']);

    // 云端删除较新 → pull 墓碑 + overwrittenByCloud
    const localOlder = [rec('a', 'T05')];
    const cloudTombNewer = [rec('a', 'T10', { deleted: true })];
    const r2 = reconcile(localOlder, cloudTombNewer);
    expect(r2.toPull).toHaveLength(1);
    expect(r2.toPull[0].deleted).toBe(true);
    expect(r2.overwrittenByCloud).toEqual(['a']);
  });

  it('E37：本地离线删除 vs 云端条目——本地墓碑较新 → push 墓碑', () => {
    const local = [rec('a', 'T30', { deleted: true })];
    const cloud = [rec('a', 'T10')];
    const r = reconcile(local, cloud);
    expect(r.toPush.map((x) => x.id)).toEqual(['a']);
    expect(r.toPush[0].deleted).toBe(true);
  });

  it('云端墓碑且本地从未见过该 id → 忽略（不引入垃圾墓碑）', () => {
    const r = reconcile([], [rec('a', 'T10', { deleted: true })]);
    expect(r.toPull).toEqual([]);
  });

  it('确定性：输出按 id 排序；同输入两次结果一致', () => {
    const local = [rec('c', 'T2'), rec('a', 'T1'), rec('b', 'T3')];
    const cloud = [rec('b', 'T2'), rec('a', 'T1')];
    const r1 = reconcile(local, cloud);
    const r2 = reconcile(local, cloud);
    expect(r1).toEqual(r2);
    // a 时间戳相等（幂等）；b 本地较新 → push；c 本地独有 → push
    expect(r1.toPush.map((x) => x.id)).toEqual(['b', 'c']);
    expect(r1.toPull).toEqual([]);
  });

  it('空输入安全', () => {
    expect(reconcile([], [])).toEqual({ toPush: [], toPull: [], overwrittenByCloud: [] });
  });
});

describe('applyRemote / upsertLocal / markLocalDeleted', () => {
  it('applyRemote：墓碑删除本地条目、其余 upsert、确定性排序、不修改入参', () => {
    const local = [rec('a', 'T1'), rec('b', 'T2')];
    const pulled = [rec('c', 'T3'), rec('b', 'T5', { deleted: true })];
    const out = applyRemote(local, pulled);
    expect(out.map((x) => x.id)).toEqual(['a', 'c']);
    expect(local.map((x) => x.id)).toEqual(['a', 'b']); // 入参不变
  });

  it('upsertLocal：新条目插入、旧条目覆盖、排序确定', () => {
    const local = [rec('b', 'T1')];
    const out = upsertLocal(local, rec('a', 'T2'));
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
    const out2 = upsertLocal(out, rec('b', 'T9'));
    expect(out2.find((x) => x.id === 'b')!.updatedAt).toBe('T9');
  });

  it('markLocalDeleted：仅目标条目置墓碑，时间戳更新，其他不变', () => {
    const local = [rec('a', 'T1'), rec('b', 'T2')];
    const out = markLocalDeleted(local, 'a', 'T9');
    expect(out.find((x) => x.id === 'a')).toEqual({ id: 'a', updatedAt: 'T9', deleted: true });
    expect(out.find((x) => x.id === 'b')).toEqual(local[1]);
    expect(local.find((x) => x.id === 'a')!.deleted).toBe(false); // 入参不变
  });
});

describe('E38 配套（限额在 API 层，引擎保证超限前的行为自洽）', () => {
  it('大量条目（100）比对结果确定且完整', () => {
    const local = Array.from({ length: 100 }, (_, i) => rec(`l${i}`, `T${i}`));
    const cloud = Array.from({ length: 100 }, (_, i) => rec(`c${i}`, `T${i}`));
    const r = reconcile(local, cloud);
    expect(r.toPush).toHaveLength(100);
    expect(r.toPull).toHaveLength(100);
  });
});
