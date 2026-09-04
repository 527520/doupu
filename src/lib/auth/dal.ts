import { AppError } from '@/lib/errors';
import { authorize, type Actor, type Capability } from './authorization';
import { getSessionActor } from './session';

/** Authorization seam for Route Handlers and server-side data modules. */
export async function requireApiActor(capability: Capability): Promise<Actor> {
  const actor = await getSessionActor();
  if (!actor) throw new AppError('UNAUTHORIZED', '请先登录');
  if (!actor.emailVerified) throw new AppError('FORBIDDEN', '请先验证邮箱');
  if (!authorize(actor, capability)) throw new AppError('FORBIDDEN', '没有执行此操作的权限');
  return actor;
}
