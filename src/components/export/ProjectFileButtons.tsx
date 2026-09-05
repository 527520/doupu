'use client';

/** 项目文件导出/导入按钮组（spec §F7 项目文件）：导出下载 JSON；导入校验并处理名称冲突。 */
import { useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import Notice from '@/components/ui/Notice';
import { LIMITS } from '@/lib/appInfo';
import { conflictName, importProjectFile } from '@/lib/project/parse';
import { projectFileName, serializeProject, type ProjectSource } from '@/lib/project/serialize';
import type { ProjectFile } from '@/lib/types';
import { track } from '@/lib/analytics/client';

interface Props {
  /** 当前设计数据（serializeProject 的输入） */
  source: ProjectSource;
  /** 现有设计名（导入时用于名称冲突自动加后缀） */
  existingNames: string[];
  onImport: (project: ProjectFile) => void;
  disabled?: boolean;
  analyticsSource?: 'community' | 'other';
}

export default function ProjectFileButtons({ source, existingNames, onImport, disabled, analyticsSource = 'other' }: Props) {
  const [errors, setErrors] = useState<string[]>([]);
  const [exportError, setExportError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = zhCN.project;

  const handleExport = (): void => {
    if (disabled) return;
    setExportError(false);
    try {
    const text = serializeProject(source);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = projectFileName(source.name);
    document.body.appendChild(anchor);
    try { anchor.click(); } finally {
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_500);
    }
    track({ name: 'design_exported', properties: { format: 'project', source: analyticsSource } });
    } catch {
      setExportError(true);
      track({ name: 'export_failed', properties: { format: 'project', errorCode: 'PROJECT_EXPORT_FAILED' } });
    }
  };

  const handleImport = async (file: File): Promise<void> => {
    setErrors([]);
    if (file.size > LIMITS.projectFileBytes) {
      setErrors([t.tooLarge]);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setErrors([t.invalidFile]);
      return;
    }
    const result = importProjectFile(text);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const project = { ...result.project, name: conflictName(result.project.name, existingNames) };
    onImport(project);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const first = e.target.files?.[0];
    if (first) void handleImport(first);
    e.target.value = ''; // 允许重复选择同一文件
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleExport}
          disabled={disabled}
          className="btn-outline btn-sm"
        >
          {t.exportLabel}
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="btn-outline btn-sm"
        >
          {t.importLabel}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        aria-label={t.importInputLabel}
        onChange={onFileChange}
        className="sr-only"
      />
      {exportError && <Notice kind="danger">{t.exportFailed}</Notice>}
      {errors.length > 0 && (
        <Notice kind="danger" as="div" className="flex-col gap-1">
          <p className="font-medium">{t.importFailed}</p>
          <ul className="list-inside list-disc">
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}
