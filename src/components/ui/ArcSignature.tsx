/**
 * 豆谱签名元素（优化票 01 · 温柔治愈）：手绘弧线 + 小星光。
 * 全站唯一装饰性签名——标题下/卡片顶部点缀，纯装饰（aria-hidden）。
 * 刻意保留轻微的不完美曲线（两段贝塞尔偏移），避免机器感。
 */
export default function ArcSignature({ className = 'w-24' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* 主弧线（主粉） */}
      <path
        d="M 6 22 C 30 6, 66 5, 96 16"
        stroke="var(--color-primary)"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.9"
      />
      {/* 伴弧线（丁香紫，轻微偏移 → 手绘双线感） */}
      <path
        d="M 14 26 C 38 14, 72 13, 104 22"
        stroke="var(--color-lilac)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.8"
      />
      {/* 端点小星光（四角星） */}
      <path
        d="M 108 6 C 109.5 9.5, 110.5 10.5, 114 12 C 110.5 13.5, 109.5 14.5, 108 18 C 106.5 14.5, 105.5 13.5, 102 12 C 105.5 10.5, 106.5 9.5, 108 6 Z"
        fill="var(--color-primary)"
        opacity="0.9"
      />
    </svg>
  );
}
