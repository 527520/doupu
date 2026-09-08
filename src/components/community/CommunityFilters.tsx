'use client';

import { useState, type MouseEvent } from 'react';
import Button, { ButtonLink } from '@/components/ui/Button';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import SegmentedControl from '@/components/ui/SegmentedControl';
import DetailPanel from '@/components/ui/DetailPanel';
import DateRangePicker from '@/components/ui/DateRangePicker';
import Disclosure from '@/components/ui/Disclosure';
import TextField from '@/components/ui/TextField';
import useCompactLayout from '@/components/ui/useCompactLayout';
import { BOARD_PROFILE_IDS, getBoardProfile } from '@/lib/boardProfiles';
import type { CommunityListQuery } from '@/lib/community/queries';
import { zhCN } from '@/messages/zh-CN';

/**
 * 豆社筛选（ui-polish-2026）：搜索 + 筛选主按钮一行；排序是滑块式分段；
 * 更多筛选是一行 .form-row（作者 / 规格 / 发布日期区间），桌面在折叠面板里、手机在底部面板里，
 * 两端同一套字段与 GET 参数（author / boardProfile / from / to）。
 */
export default function CommunityFilters({ query }: { query: CommunityListQuery }) {
  const t=zhCN.communityAdmin.community;
  const compact=useCompactLayout();
  const [open,setOpen]=useState(false);
  const [draft,setDraft]=useState({q:query.q??'',sort:query.sort,author:query.author??'',boardProfile:query.boardProfile??'',from:query.from??'',to:query.to??''});
  const [editing,setEditing]=useState(draft);
  // WebKit 鼠标点原生按钮不会给它焦点；先把焦点放到入口再开抽屉，关闭时 react-aria 才有可恢复的入口。
  const begin=(event:MouseEvent<HTMLButtonElement>)=>{event.currentTarget.focus();setEditing(draft);setOpen(true);};
  const fields=(data:typeof draft, update:(value:typeof draft)=>void)=><>
    <TextField label={t.authorFilter} name="author" maxLength={80} value={data.author} onChange={e=>update({...data,author:e.target.value})} />
    <ResponsiveSelect label={t.boardFilter} name="boardProfile" value={data.boardProfile} onValueChange={v=>update({...data,boardProfile:v as typeof data.boardProfile})}
      options={[{value:'',label:t.allBoards},...BOARD_PROFILE_IDS.map(id=>({value:id,label:getBoardProfile(id).displayName}))]} />
    <DateRangePicker label={t.dateRange} startName="from" endName="to" startLabel={t.fromDate} endLabel={t.toDate} value={{ start: data.from, end: data.to }} onValueChange={({ start, end })=>update({...data,from:start,to:end})} className="form-row-wide" />
  </>;
  const activeCount=[draft.author,draft.boardProfile,draft.from,draft.to].filter(Boolean).length;
  return <>
    <form className="community-filters" method="get" action="/community">
      <div className="community-search-row"><label><span className="sr-only">{t.searchLabel}</span><input name="q" maxLength={80} value={draft.q} onChange={e=>setDraft({...draft,q:e.target.value})} className="input-field" placeholder={t.searchPlaceholder} /></label><Button type="submit" variant="primary" icon="search">{t.filter}</Button></div>
      <div className="community-filter-bar"><SegmentedControl label={t.sortLabel} name="sort" value={draft.sort} onValueChange={sort=>setDraft({...draft,sort:sort as typeof draft.sort})}
        options={[{value:'latest',label:zhCN.selection.latest},{value:'featured',label:zhCN.selection.featured},{value:'popular',label:zhCN.selection.popular}]} />
        {compact && <Button variant="secondary" icon="filter" onClick={begin}>{t.moreFilters}{activeCount>0 && <span className="community-filter-count">{activeCount}</span>}</Button>}
      </div>
      {query.tag && <input type="hidden" name="tag" value={query.tag} />}{query.palette && <input type="hidden" name="palette" value={query.palette} />}
      {compact ? <>{(['author','boardProfile','from','to'] as const).map(key=><input key={key} type="hidden" name={key} value={draft[key]} />)}</> : <Disclosure className="community-filter-details is-flat" icon="filter" summary={t.moreFilters} meta={activeCount>0?t.activeFilters(activeCount):undefined} defaultExpanded={activeCount>0}><div className="community-filter-fields form-row">{fields(draft,setDraft)}<div className="form-row-actions"><ButtonLink variant="quiet" icon="close" href="/community">{t.clearFilters}</ButtonLink></div></div></Disclosure>}
    </form>
    <DetailPanel title={t.moreFilters} open={open} onClose={()=>setOpen(false)}><form method="get" action="/community" className="community-panel-filters">
      <input type="hidden" name="q" value={draft.q} /><input type="hidden" name="sort" value={draft.sort} />
      {query.tag && <input type="hidden" name="tag" value={query.tag} />}{query.palette && <input type="hidden" name="palette" value={query.palette} />}
      {fields(editing,setEditing)}<div className="panel-actions"><ButtonLink variant="secondary" href="/community">{t.clearFilters}</ButtonLink><Button type="submit" variant="primary" icon="filter">{t.filter}</Button></div>
    </form></DetailPanel>
  </>;
}
