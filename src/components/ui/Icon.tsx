import type { ReactNode } from 'react';

export type IconName =
  | 'home' | 'spark' | 'folder' | 'palette' | 'user' | 'help' | 'info'
  | 'lock' | 'cloud' | 'upload' | 'blank' | 'arrow' | 'more' | 'plus'
  | 'search' | 'bell' | 'edit' | 'grid' | 'sliders' | 'download' | 'crop';

const paths: Record<IconName, ReactNode> = {
  home: <><path d="M3.5 10.5 12 3l8.5 7.5" /><path d="M5.5 9.5v10h13v-10M9.5 19.5v-6h5v6" /></>,
  spark: <><path d="m12 2 1.7 5.2L19 9l-5.3 1.8L12 16l-1.7-5.2L5 9l5.3-1.8L12 2Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
  folder: <path d="M3 6.5h6l2-2h10v15H3v-13Z" />,
  palette: <><path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.2-3.1 1.8 1.8 0 0 1 1.2-3.1H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z" /><path d="M7.2 10h.1M9.5 6.8h.1M14 6.5h.1M17 9.2h.1" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.5 2.5 0 1 1 3.7 2.2c-.9.5-1.4 1-1.4 2.1M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  cloud: <path d="M7 18H6a4 4 0 1 1 1-7.9A6 6 0 0 1 18.5 12H19a3 3 0 0 1 0 6H7Z" />,
  upload: <><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M4 14v6h16v-6" /></>,
  blank: <><path d="M5 3.5h10l4 4v13H5v-17Z" /><path d="M15 3.5v4h4M8.5 14h7M12 10.5v7" /></>,
  arrow: <><path d="M5 12h14M14 7l5 5-5 5" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8Z" /><path d="M10 21h4" /></>,
  edit: <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z" /><path d="m13.5 7 3.5 3.5" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>,
  sliders: <><path d="M4 6h6M14 6h6M4 12h11M19 12h1M4 18h3M11 18h9" /><circle cx="12" cy="6" r="2" /><circle cx="17" cy="12" r="2" /><circle cx="9" cy="18" r="2" /></>,
  download: <><path d="M12 4v11m0 0-4-4m4 4 4-4" /><path d="M4 18v2h16v-2" /></>,
  crop: <><path d="M7 3v14a2 2 0 0 0 2 2h12" /><path d="M3 7h12a2 2 0 0 1 2 2v12" /></>,
};

export default function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
