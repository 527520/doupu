'use client';

export default function Switch({ label, checked, onChange, disabled = false, name, describedBy, compact = false, className = '' }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; name?: string; describedBy?: string;
  /** 紧凑档：行高 36，用于参数面板等工具行。 */
  compact?: boolean;
  className?: string;
}) {
  return <label className={`switch-control${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}><input type="checkbox" role="switch" name={name} checked={checked} onChange={e=>onChange(e.target.checked)} disabled={disabled} aria-describedby={describedBy} /><span className="switch-track" aria-hidden="true"><i /></span><span>{label}</span></label>;
}
