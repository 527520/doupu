'use client';

export default function Switch({ label, checked, onChange, disabled = false, name, describedBy }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; name?: string; describedBy?: string;
}) {
  return <label className="switch-control"><input type="checkbox" role="switch" name={name} checked={checked} onChange={e=>onChange(e.target.checked)} disabled={disabled} aria-describedby={describedBy} /><span className="switch-track" aria-hidden="true"><i /></span><span>{label}</span></label>;
}
