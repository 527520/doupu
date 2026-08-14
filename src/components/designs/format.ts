/** 时间显示格式化（确定性，避免测试随 locale 波动）：YYYY-MM-DD HH:mm。 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 删除确认文案中的 {name} 占位替换。 */
export function fillDeleteHint(template: string, name: string): string {
  return template.replace('{name}', name);
}
