import Notice from '@/components/ui/Notice';

/** 表单错误提示（role=alert 供无障碍与测试定位）。 */
export default function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Notice kind="danger">{message}</Notice>;
}
