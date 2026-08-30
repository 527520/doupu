/** 项目文件序列化（spec §5.3）：格式化 JSON（2 空格缩进），updatedAt 置当前时间。 */
import { PROJECT_FILE_FORMAT, PROJECT_FILE_VERSION } from '@/lib/appInfo';
import { projectFileSchema } from '@/lib/schemas';
import type { ProjectFile } from '@/lib/types';

/** 序列化所需的设计数据（不含 format/version，由本模块补全）。 */
export interface ProjectSource {
  name: string;
  createdAt: string;
  engineVersion: string;
  boardProfile: ProjectFile['boardProfile'];
  paletteSelection: ProjectFile['paletteSelection'];
  params: ProjectFile['params'];
  pattern: ProjectFile['pattern'];
}

export function serializeProject(source: ProjectSource, now: Date = new Date()): string {
  const project: ProjectFile = {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    engineVersion: source.engineVersion,
    boardProfile: source.boardProfile,
    name: source.name,
    createdAt: source.createdAt,
    updatedAt: now.toISOString(),
    paletteSelection: source.paletteSelection,
    params: source.params,
    pattern: source.pattern,
  };
  // Export is a trust boundary too: never offer a JSON file that this same
  // application cannot read back.
  return JSON.stringify(projectFileSchema.parse(project), null, 2);
}

/** 生成下载文件名：豆谱-<设计名>.json；非法文件名字符替换，空名回退。 */
export function projectFileName(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return `豆谱-${sanitized || '未命名设计'}.json`;
}
