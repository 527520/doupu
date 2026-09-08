/**
 * 加载环（ui-polish-2026）：16px 细环，是全站唯一允许循环的动效之一。
 * 纯装饰——所在按钮已经用 aria-busy 表达「进行中」，这里不再重复播报。
 */
export default function Spinner({ size = 'md', className = '' }: { size?: 'md' | 'lg'; className?: string }) {
  return <span aria-hidden="true" className={`spinner${size === 'lg' ? ' is-lg' : ''}${className ? ` ${className}` : ''}`} />;
}
