'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from 'react-aria-components';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import SegmentedControl from '@/components/ui/SegmentedControl';
import DetailPanel from '@/components/ui/DetailPanel';
import DatePicker from '@/components/ui/DatePicker';
import Disclosure from '@/components/ui/Disclosure';
import useCompactLayout from '@/components/ui/useCompactLayout';
import { BOARD_PROFILE_IDS, getBoardProfile } from '@/lib/boardProfiles';
import type { CommunityListQuery } from '@/lib/community/queries';
import { zhCN } from '@/messages/zh-CN';

export default function CommunityFilters({ query }: { query: CommunityListQuery }) {
  const t=zhCN.communityAdmin.community;
  const compact=useCompactLayout();
  const [open,setOpen]=useState(false);
  const [draft,setDraft]=useState({q:query.q??'',sort:query.sort,author:query.author??'',boardProfile:query.boardProfile??'',from:query.from??'',to:query.to??''});
  const [editing,setEditing]=useState(draft);
  const begin=()=>{setEditing(draft);setOpen(true);};
  const fields=(data:typeof draft, update:(value:typeof draft)=>void)=><>
    <label>{t.authorFilter}<input name="author" maxLength={80} value={data.author} onChange={e=>update({...data,author:e.target.value})} className="input-field" /></label>
    <ResponsiveSelect label={t.boardFilter} name="boardProfile" value={data.boardProfile} onValueChange={v=>update({...data,boardProfile:v as typeof data.boardProfile})}
      options={[{value:'',label:t.allBoards},...BOARD_PROFILE_IDS.map(id=>({value:id,label:getBoardProfile(id).displayName}))]} />
    <DatePicker label={t.fromDate} name="from" value={data.from} max={data.to || undefined} onValueChange={from=>update({...data,from})} />
    <DatePicker label={t.toDate} name="to" value={data.to} min={data.from || undefined} onValueChange={to=>update({...data,to})} />
  </>;
  const activeCount=[draft.author,draft.boardProfile,draft.from,draft.to].filter(Boolean).length;
  return <>
    <form className="community-filters" method="get" action="/community">
      <div className="community-search-row"><label><span className="sr-only">{t.searchLabel}</span><input name="q" maxLength={80} value={draft.q} onChange={e=>setDraft({...draft,q:e.target.value})} className="input-field" placeholder={t.searchPlaceholder} /></label><button className="btn-primary">{t.filter}</button></div>
      <div className="community-filter-bar"><SegmentedControl label={t.sortLabel} name="sort" value={draft.sort} onValueChange={sort=>setDraft({...draft,sort:sort as typeof draft.sort})}
        options={[{value:'latest',label:zhCN.selection.latest},{value:'featured',label:zhCN.selection.featured},{value:'popular',label:zhCN.selection.popular}]} />
        {compact && <Button className="btn-outline" onPress={begin}>{t.moreFilters}</Button>}
      </div>
      {query.tag && <input type="hidden" name="tag" value={query.tag} />}{query.palette && <input type="hidden" name="palette" value={query.palette} />}
      {compact ? <>{(['author','boardProfile','from','to'] as const).map(key=><input key={key} type="hidden" name={key} value={draft[key]} />)}</> : <Disclosure className="community-filter-details is-flat" icon="filter" summary={t.moreFilters} meta={activeCount>0?t.activeFilters(activeCount):undefined} defaultExpanded={activeCount>0}><div className="community-filter-fields">{fields(draft,setDraft)}</div><Link href="/community" className="link-action">{t.clearFilters}</Link></Disclosure>}
    </form>
    <DetailPanel title={t.moreFilters} open={open} onClose={()=>setOpen(false)}><form method="get" action="/community" className="community-panel-filters">
      <input type="hidden" name="q" value={draft.q} /><input type="hidden" name="sort" value={draft.sort} />
      {query.tag && <input type="hidden" name="tag" value={query.tag} />}{query.palette && <input type="hidden" name="palette" value={query.palette} />}
      {fields(editing,setEditing)}<div className="panel-actions"><Link href="/community" className="btn-outline">{t.clearFilters}</Link><button className="btn-primary">{t.filter}</button></div>
    </form></DetailPanel>
  </>;
}
