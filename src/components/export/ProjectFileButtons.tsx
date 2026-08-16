'use client';

/** 项目文件导出/导入按钮组（spec §F7 项目文件）：导出下载 JSON；导入校验并处理名称冲突。 */
import { useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import { LIMITS } from '@/lib/appInfo';
import { conflictName, importProjectFile } from '@/lib/project/parse';
import { projectFileName, serializeProject, type ProjectSource } from '@/lib/project/serialize';
import type { ProjectFile } from '@/lib/types';

interface Props {
  /** 当前设计数据（serializeProject 的输入） */
  source: ProjectSource;
  /** 现有设计名（导入时用于名称冲突自动加后缀） */
  existingNames: string[];
  onImport: (project: ProjectFile) => void;
  disabled?: boolean;
}

export default function ProjectFileButtons({ source, existingNames, onImport, disabled }: Props) {
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = zhCN.project;

  const handleExport = (): void => {
    const text = serializeProject(source);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = projectFileName(source.name);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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
          className="rounded-full border border-lilac/50 px-3 py-1.5 text-sm transition-colors hover:bg-lilac-soft disabled:bg-lilac-soft disabled:text-ink-soft/60"
        >
          {t.exportLabel}
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="rounded-full border border-lilac/50 px-3 py-1.5 text-sm transition-colors hover:bg-lilac-soft disabled:bg-lilac-soft disabled:text-ink-soft/60"
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
      {errors.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          <p className="font-medium">{t.importFailed}</p>
          <ul className="list-inside list-disc">
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
