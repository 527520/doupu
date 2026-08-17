/**
 * GET /api/config：站点公开配置（票 02）。
 * 仅返回客户端可见、无敏感信息的子集（生成/导出默认参数）；
 * 安全阈值等敏感项绝不在此下发。
 * 公开接口，无需登录；禁用缓存头由 Next 默认处理（动态路由）。
 */
import { okJson, withApiErrors } from '@/lib/auth/http';
import { publicConfig } from '@/lib/config';

async function get(_request: Request) {
  return okJson(publicConfig());
}

export const GET = withApiErrors(get);
