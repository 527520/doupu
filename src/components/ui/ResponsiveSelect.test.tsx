// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResponsiveSelect from './ResponsiveSelect';
import Modal from './Modal';
import DetailPanel from './DetailPanel';
import { useState } from 'react';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const options = [{ value: '', label: '全部规格' }, { value: 'mini', label: '2.6mm / 50×50' }];

describe('ResponsiveSelect', () => {
  it('必填项阻止空值提交，服务端错误可被读屏关联',async()=>{
    const user=userEvent.setup();const submit=vi.fn((event)=>event.preventDefault());
    const {rerender}=render(<form onSubmit={submit}><ResponsiveSelect label="必选规格" name="board" options={options} required /><button type="submit">提交</button></form>);
    await user.click(screen.getByRole('button',{name:'提交'}));
    expect(submit).not.toHaveBeenCalled();
    const trigger=screen.getByRole('button',{name:/必选规格/});
    await user.click(trigger);await user.click(screen.getByRole('option',{name:'2.6mm / 50×50'}));
    await user.click(screen.getByRole('button',{name:'提交'}));expect(submit).toHaveBeenCalledOnce();
    rerender(<form><ResponsiveSelect label="必选规格" name="board" options={options} error="该规格暂不可用，请重新选择" /></form>);
    expect(screen.getByRole('button',{name:/必选规格/}).parentElement).toHaveAttribute('data-invalid','true');
    expect(screen.getByRole('button',{name:/必选规格/})).toHaveAccessibleDescription('该规格暂不可用，请重新选择');
  });
  it('移动端嵌套面板打开时只有外层可见，选择器展开后显示全部选项', async()=>{
    vi.stubGlobal('innerWidth',390);
    const user=userEvent.setup();
    render(<DetailPanel title="筛选" open onClose={()=>{}}><ResponsiveSelect label="规格" options={options} /></DetailPanel>);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(screen.getByRole('button',{name:/规格/}));
    expect(await screen.findByRole('option',{name:'2.6mm / 50×50'})).toBeVisible();
    await user.click(screen.getByRole('option',{name:'2.6mm / 50×50'}));
    expect(screen.getByRole('dialog',{name:'筛选'})).toBeVisible();
  });
  it('选择后提交原始选项值，关闭列表并恢复入口焦点', async () => {
    const user = userEvent.setup();
    const { container } = render(<form><ResponsiveSelect label="制作规格" name="board" options={options} defaultValue="" /></form>);
    const trigger = screen.getByRole('button', { name: /制作规格/ });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: '2.6mm / 50×50' }));
    expect(new FormData(container.querySelector('form')!).get('board')).toBe('mini');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it('键盘可打开、选择与返回；禁用入口不可操作',async()=>{
    const user=userEvent.setup();const {container}=render(<form><ResponsiveSelect label="规格" name="board" options={options} /><ResponsiveSelect label="已锁定" options={options} disabled /></form>);
    const trigger=screen.getByRole('button',{name:'全部规格 规格'});
    await user.tab();expect(trigger).toHaveFocus();
    await user.keyboard('{ArrowDown}{End}{Enter}');
    expect(new FormData(container.querySelector('form')!).get('board')).toBe('mini');
    await waitFor(()=>expect(trigger).toHaveFocus());
    expect(screen.getByRole('button',{name:/已锁定/})).toBeDisabled();
  });
  it('超过12项时可搜索，取消不改变已经选择的值', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 15 }, (_, i) => ({ value: String(i), label: `色板系列 ${i}` }));
    const { container } = render(<form><ResponsiveSelect label="色板系列" name="palette" options={many} defaultValue="4" /></form>);
    const trigger = screen.getByRole('button', { name: /色板系列/ });
    await user.click(trigger);
    await user.type(await screen.findByRole('searchbox', { name: '搜索选项' }), '14');
    expect(screen.getByRole('option', { name: '色板系列 14' })).toBeVisible();
    expect(screen.queryByRole('option', { name: '色板系列 4' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(new FormData(container.querySelector('form')!).get('palette')).toBe('4');
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    expect(screen.getByRole('searchbox', {name:'搜索选项'})).toHaveValue('');
    expect(screen.getByRole('option', {name:'色板系列 4'})).toHaveAttribute('aria-selected','true');
    await user.keyboard('{Escape}');
  });
  it('原生表单重置恢复默认值且禁用项不可选择', async () => {
    const user = userEvent.setup();
    const { container } = render(<form><ResponsiveSelect label="规格" name="board" options={[...options, {value:'blocked',label:'不可用',disabled:true}]} defaultValue="" /><button type="reset">重置</button></form>);
    await user.click(screen.getByRole('button', {name:/规格/}));
    expect(screen.getByRole('option', {name:'不可用'})).toHaveAttribute('aria-disabled','true');
    await user.click(screen.getByRole('option', {name:'2.6mm / 50×50'}));
    await user.click(screen.getByRole('button', {name:'重置'}));
    expect(new FormData(container.querySelector('form')!).get('board')).toBe('');
    expect(screen.getByRole('button', {name:/规格/})).toHaveTextContent('全部规格');
  });
  it('嵌套选择面板取消时不关闭外层弹窗，再次取消恢复外部焦点', async () => {
    function Nested() {
      const [open,setOpen] = useState(false);
      return <><button onClick={()=>setOpen(true)}>打开编辑</button>{open && <Modal label="编辑作品" onClose={()=>setOpen(false)}><ResponsiveSelect label="规格" options={options} /></Modal>}</>;
    }
    const user=userEvent.setup(); render(<Nested />);
    const entry=screen.getByRole('button',{name:'打开编辑'});
    await user.click(entry);
    const trigger=screen.getByRole('button',{name:/规格/});
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog',{name:'编辑作品'})).toBeVisible();
    await waitFor(()=>expect(trigger).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(entry).toHaveFocus();
  });
});
