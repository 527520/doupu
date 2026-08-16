'use client';

/** 表单错误提示（role=alert 供无障碍与测试定位）。 */
export default function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
      {message}
    </p>
  );
}
