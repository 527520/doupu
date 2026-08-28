'use client';

/**
 * 色带（E-1/E-3）：用一条颜色条概括一套色板或一张图纸的用色。
 *
 * 为什么需要：色板管理页此前只显示「291 色」这个数字，一个颜色都看不到——
 * 对一个「选颜色」的产品来说，这是最该有颜色的地方却最没有颜色。
 * 设计列表同理：只有缩略图，看不出这张图纸用了哪些豆子。
 *
 * 取样规则：等间距抽样而不是取前 N 个，因为品牌色板按色号排序，
 * 取前 N 个只会得到一片同色系（漫德前 20 个全是灰白）。
 */
interface Props {
  colors: readonly string[];
  /** 最多展示多少格；超出按等间距抽样 */
  max?: number;
  /** 可访问名（例如「漫德 291 色」）；省略则视为装饰性 */
  label?: string;
  className?: string;
}

export function sampleColors(colors: readonly string[], max: number): string[] {
  if (colors.length <= max) return [...colors];
  const step = colors.length / max;
  return Array.from({ length: max }, (_, index) => colors[Math.floor(index * step)]);
}

export default function ColorBand({ colors, max = 24, label, className }: Props) {
  if (colors.length === 0) return null;
  const shown = sampleColors(colors, max);
  return (
    <div
      className={`flex h-3 w-full overflow-hidden rounded-full border border-lilac/30 ${className ?? ''}`}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}
    >
      {shown.map((hex, index) => (
        <span key={`${hex}-${index}`} className="h-full flex-1" style={{ backgroundColor: hex }} />
      ))}
    </div>
  );
}
