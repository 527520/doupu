'use client';

/** 设计名称编辑（工作台顶部）。 */
import { zhCN } from '@/messages/zh-CN';
import { LIMITS } from '@/lib/appInfo';

interface Props {
  name: string;
  onChange: (name: string) => void;
}

export default function DesignNameEditor({ name, onChange }: Props) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="shrink-0 text-gray-600">{zhCN.workbench.designName}</span>
      <input
        type="text"
        value={name}
        maxLength={LIMITS.designNameLength}
        placeholder={zhCN.project.unnamed}
        aria-label={zhCN.workbench.designName}
        onChange={(e) => onChange(e.target.value)}
        className="w-44 rounded border border-gray-300 px-2 py-1"
      />
    </label>
  );
}
