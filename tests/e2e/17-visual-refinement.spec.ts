import { expect, test, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { attachSubmissionOriginal, fillField, selectChoice, uploadDraftOriginal, waitHydrated } from './helpers';

const widths=[350,390,768,1280,1440];
const output=(name:string)=>resolve('.scratch/ui-polish-2026/evidence',name);
/** 同一行控件的底边必须对齐（表单行尺寸律）。 */
async function expectBottomsAligned(locators:Locator[],tolerance=1){
  const bottoms=await Promise.all(locators.map(async locator=>{const box=await locator.boundingBox();expect(box).not.toBeNull();return box!.y+box!.height;}));
  for(const bottom of bottoms) expect(Math.abs(bottom-bottoms[0]),`bottoms ${bottoms.map(v=>v.toFixed(1)).join(' / ')}`).toBeLessThanOrEqual(tolerance);
}
async function expectNoMotionTransform(element:Locator){
  expect(await element.evaluate(node=>{const value=getComputedStyle(node).transform;return value==='none'||new DOMMatrixReadOnly(value).isIdentity;})).toBe(true);
  await expect(element).toHaveCSS('translate','none');
}

test('合法的长英文公开标题不裁切，减少动态效果取消卡片位移',async({page},info)=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/login?next=/admin/batches');await fillField(page,'邮箱','e2e-admin@example.com');await fillField(page,'密码','E2e-pass-123!');
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect.poll(()=>new URL(page.url()).pathname).toBe('/admin/batches');
  await expect(page.locator('main#main h1')).toBeVisible();
  const sourceList=await (await page.request.get('/api/community/works')).json();
  const source=await (await page.request.get(`/api/community/works/${sourceList.items[0].id}`)).json();
  const post=async(url:string,body:unknown)=>{
    const result=await page.evaluate(async({url,body,key})=>{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};},{url,body,key:randomUUID()});
    expect(result.status,JSON.stringify(result.body)).toBeLessThan(300);return result.body;
  };
  const title=`${info.project.name}${'HandmadeFlowers'.repeat(5)}`.slice(0,80);
  const batch=await post('/api/admin/batches',{itemCount:1,defaultParams:source.snapshot.params,engineVersion:source.snapshot.engineVersion,reason:'本地长标题排版验证'});
  const draft=await post(`/api/admin/batches/${batch.id}/drafts`,{title,snapshot:source.snapshot,reason:'本地长标题排版验证'});
  await uploadDraftOriginal(page,draft.revisionId);
  await post(`/api/admin/batches/${batch.id}/publish`,{revisionIds:[draft.revisionId],expectedVersion:batch.version,reason:'本地长标题排版验证'});
  await page.goto(`/community?q=${title}`);
  const card=page.locator('.community-card').filter({has:page.getByRole('heading',{name:title,exact:true})});
  for(const width of widths){
    await page.setViewportSize({width,height:844});await expect(card).toBeVisible();
    expect(await card.locator('.community-card-body > div').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await card.hover();await expectNoMotionTransform(card);
  }
  await page.screenshot({path:output(`long-title-${info.project.name}.png`),fullPage:true});
  await page.goto('/');
  const blank=page.locator('.home-blank-action');await blank.hover();await expectNoMotionTransform(blank);
  const upload=page.getByRole('button',{name:'选择图片文件'});await upload.hover();await page.mouse.down();await expectNoMotionTransform(upload);await page.mouse.up();
  await page.mouse.move(0,0);await upload.dispatchEvent('dragenter');
  await expect(upload).toHaveClass(/is-dragging/);
  // 钉板落区：拖入时底色只是轻微变粉，钉阵与描边变莓果色，不再整块实心。
  await expect(upload).toHaveCSS('background-color','rgb(255, 247, 249)');
  await expect(upload).toHaveCSS('border-top-color','rgb(185, 62, 98)');
  expect((await new AxeBuilder({page}).include('.upload-dropzone-primary').analyze()).violations).toEqual([]);
  await expectNoMotionTransform(upload);await upload.dispatchEvent('dragleave');
});

test('豆社、色板和登录页五宽度排版与无障碍',async({page},info)=>{
  for(const route of ['/community','/palettes','/login']){
    await page.goto(route);await waitHydrated(page);await page.evaluate(()=>document.fonts.ready.then(()=>undefined));
    for(const width of widths){
      await page.setViewportSize({width,height:844});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth),`${route} ${width}px`).toBeLessThanOrEqual(width);
      expect((await new AxeBuilder({page}).analyze()).violations,`${route} ${width}px`).toEqual([]);
      if(width===350||width===1440)await page.screenshot({path:output(`${route.slice(1)}-${info.project.name}-${width}.png`),fullPage:true});
    }
  }
});

test('后台待审、批次和人员队列五宽度排版与无障碍',async({page,browser,baseURL},info)=>{
  // 由本用例通过真实投稿界面创建样本，不污染较早的审核队列清空契约。
  const title=`窗边的小花——待审视觉样本 ${info.project.name}`;
  const authorContext=await browser.newContext({baseURL});
  try{
    const author=await authorContext.newPage();
    await author.goto('/login?next=/community/submit');await fillField(author,'邮箱','e2e-user@example.com');await fillField(author,'密码','E2e-pass-123!');
    await author.getByRole('button',{name:'登录',exact:true}).click();await expect.poll(()=>new URL(author.url()).pathname).toBe('/community/submit');
    await selectChoice(author,'选择云端设计','E2E 私人设计');
    await author.getByLabel('公开作品标题').fill(title);
    await author.getByRole('checkbox',{name:/合法发布权/}).check();
    await attachSubmissionOriginal(author, resolve(process.cwd(), 'tests/fixtures/photo-gradient-64.png'));
    await author.getByRole('button',{name:'提交审核'}).click();
    await expect.poll(()=>new URL(author.url()).pathname).toBe('/community/mine');
  }finally{await authorContext.close();}
  await page.goto('/login?next=/admin/reviews');await fillField(page,'邮箱','e2e-admin@example.com');await fillField(page,'密码','E2e-pass-123!');
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect.poll(()=>new URL(page.url()).pathname).toBe('/admin/reviews');
  for(const route of ['/admin/reviews','/admin/batches','/admin/users']){
    await page.goto(route);await expect.poll(()=>new URL(page.url()).pathname).toBe(route);await waitHydrated(page);await expect(page.locator('.admin-page h1')).toBeVisible();await page.evaluate(()=>document.fonts.ready.then(()=>undefined));
    if(route==='/admin/reviews'){
      await page.locator('.review-queue button').filter({hasText:title}).click();
      await expect(page.locator('.review-preview canvas').first()).toBeVisible();
    }
    for(const width of widths){
      await page.setViewportSize({width,height:844});
      if(width>=1280){
        if(route==='/admin/reviews'){
          // 图纸舞台与作者原图舞台顶边严格对齐（说明行 → 工具行 → 舞台三段对位）
          const pair=page.locator('.review-material-pair').first();
          const stage=await pair.locator('.pattern-preview-stage').first().boundingBox();const original=await pair.locator('.admin-original-stage').boundingBox();
          expect(stage).not.toBeNull();expect(original).not.toBeNull();expect(Math.abs(stage!.y-original!.y)).toBeLessThanOrEqual(2);
          // 禁用的主按钮不再靠半透明表达：理由为空时「批准发布」禁用但 opacity 仍为 1
          const approve=page.getByRole('button',{name:'批准发布'});await expect(approve).toBeDisabled();await expect(approve).toHaveCSS('opacity','1');
          // 空态 / 详情靠顶：返回按钮与左栏列表第一项在同一水平带内
          const back=await page.getByRole('button',{name:'返回列表'}).boundingBox();const firstItem=await page.locator('.review-queue button').first().boundingBox();
          expect(Math.abs(back!.y-firstItem!.y)).toBeLessThan(60);
        }
        if(route==='/admin/users'){
          // 筛选行：搜索输入与「查询」按钮同行且底边对齐
          await expectBottomsAligned([page.getByRole('textbox',{name:'搜索账号'}),page.getByRole('button',{name:'查询'})]);
        }
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth),`${route} ${width}px`).toBeLessThanOrEqual(width);
      expect((await new AxeBuilder({page}).analyze()).violations,`${route} ${width}px`).toEqual([]);
      if(width===350||width===1440)await page.screenshot({path:output(`${route.replaceAll('/','-')}-${info.project.name}-${width}.png`),fullPage:true});
    }
  }
});

test('无 JavaScript 时保留原生选择和 GET 筛选降级',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,javaScriptEnabled:false,viewport:{width:390,height:844}});
  try{
    const page=await context.newPage();await page.goto('/community');await page.getByText('更多筛选',{exact:true}).click();
    await page.getByRole('combobox',{name:'制作规格',exact:true}).selectOption('5mm-29');
    await page.getByRole('button',{name:'筛选',exact:true}).click();
    await expect.poll(()=>new URL(page.url()).searchParams.get('boardProfile')).toBe('5mm-29');
  } finally{await context.close();}
});

test('字体实际加载，首屏选择图片完整可见，五宽度无溢出',async({page},info)=>{
  const failures:string[]=[];
  page.on('response',response=>{if(response.url().includes('/fonts/ui/')&&response.status()>=400)failures.push(response.url());});
  await page.setViewportSize({width:390,height:844});
  await page.goto('/'); await waitHydrated(page);
  await expect(page.getByRole('complementary',{name:'匿名使用数据偏好'})).toBeVisible();
  const button=page.getByRole('button',{name:'选择图片文件',exact:true});
  const box=await button.boundingBox(); expect(box).not.toBeNull(); expect(box!.y+box!.height).toBeLessThan(770);
  const loaded=await page.evaluate(async()=>{
    const text=await document.fonts.load('400 16px "DouPu Text"','豆谱龘');
    const display=await document.fonts.load('400 30px "DouPu Round"','把喜欢，一颗颗拼出来。');
    return {text:text.length,display:display.length,ready:[...text,...display].every(font=>font.status==='loaded'),body:getComputedStyle(document.body).fontFamily};
  });
  expect(loaded.text).toBeGreaterThan(0);expect(loaded.display).toBeGreaterThan(0);expect(loaded.ready).toBe(true);expect(loaded.body).toContain('DouPu Text');expect(failures).toEqual([]);
  for(const width of widths){
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
    await page.screenshot({path:output(`home-${info.project.name}-${width}.png`),fullPage:true});
  }
});

test('手机筛选嵌套选择、取消、GET 应用及浏览器返回',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/community');
  await page.getByRole('button',{name:'更多筛选',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'更多筛选',exact:true});
  await expect(panel).toBeVisible();
  await selectChoice(page,'制作规格','2.6mm / 52×52');
  await panel.getByRole('textbox',{name:'作者',exact:true}).fill('未提交的作者');
  await panel.getByRole('button',{name:'关闭选择'}).click();
  await expect(page.getByRole('button',{name:'更多筛选',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'更多筛选',exact:true}).click();
  await expect(panel.getByRole('textbox',{name:'作者',exact:true})).toHaveValue('');
  await expect(panel.getByRole('button',{name:/制作规格/})).toContainText('全部规格');
  await selectChoice(page,'制作规格','5mm / 29×29');
  await page.screenshot({path:output(`filters-${info.project.name}.png`),fullPage:false});
  await panel.getByRole('button',{name:'筛选',exact:true}).click();
  await expect.poll(()=>new URL(page.url()).searchParams.get('boardProfile')).toBe('5mm-29');
  await page.goBack();await expect(page).toHaveURL(/\/community$/);
  await page.getByRole('radio',{name:'精选',exact:true}).check();
  await page.getByRole('button',{name:'筛选',exact:true}).click();
  await expect.poll(()=>new URL(page.url()).searchParams.get('sort')).toBe('featured');
});

test('色板详情独立展示不撑高卡片，关闭恢复焦点',async({page},info)=>{
  await page.goto('/palettes');
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:844});
    const card=page.locator('.palette-series-card').first();const before=await card.boundingBox();
    const trigger=card.getByRole('button',{name:'查看全部颜色',exact:true});await trigger.click();
    const panel=page.getByRole('dialog');await expect(panel).toBeVisible();
    await expect(page.locator('.detail-panel[data-entering]')).toHaveCount(0);
    await expect(panel.getByRole('listitem').first()).toBeVisible();
    // Compare CSS pixels: Firefox's DOMRect subpixel arithmetic differs by 0.00003px after scroll lock.
    expect(Math.round((await card.boundingBox())!.height)).toBe(Math.round(before!.height));
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
    await page.screenshot({path:output(`palette-${info.project.name}-${width}.png`)});
    await panel.getByRole('button',{name:'关闭选择'}).click();await expect(trigger).toBeFocused();
  }
});

test('长选项搜索、键盘取消、减少动态效果与200%布局放大',async({page},info)=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/login?next=/admin/analytics');await fillField(page,'邮箱','e2e-admin@example.com');await fillField(page,'密码','E2e-pass-123!');
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect.poll(()=>new URL(page.url()).pathname).toBe('/admin/analytics');
  await expect(page.getByRole('heading',{name:'使用统计',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:output(`admin-${info.project.name}.png`),fullPage:true});
  await page.goto('/palettes');
  await page.getByRole('button',{name:'新建色板',exact:true}).click();
  const trigger=page.getByRole('button',{name:/复制内置色板/});
  await trigger.click();
  const search=page.getByRole('searchbox',{name:'搜索选项'});await expect(search).toBeVisible();await search.fill('MARD');
  await expect(page.getByRole('option').first()).toBeVisible();
  await search.press('Escape');await expect(trigger).toBeFocused();
  await page.goto('/');await page.evaluate(()=>{document.body.style.zoom='2';});
  // Layout-zoom simulation, not a claim of physical-device browser zoom.
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button',{name:'选择图片文件',exact:true})).toBeVisible();
  await page.screenshot({path:output(`zoom-layout-${info.project.name}.png`),fullPage:true});
});

test('多色续作、长标题，以及加载失败后的重试状态',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/login?next=/community');await fillField(page,'邮箱','e2e-user@example.com');await fillField(page,'密码','E2e-pass-123!');
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect.poll(()=>new URL(page.url()).pathname).toBe('/community');
  // 固定真实花朵样本，不依赖跨浏览器共享库的最新作品排序。
  const samples=await Promise.all(['E2E 已公开作品','E2E 待审修改版'].map(async title=>{
    const response=await page.request.get(`/api/community/works?q=${encodeURIComponent(title)}`);
    expect(response.ok()).toBe(true);return (await response.json()).items as Array<{id:string;title:string}>;
  }));
  const flowers=samples.flat().filter(item=>/^E2E (已公开作品|待审修改版)$/.test(item.title));
  expect(flowers).toHaveLength(1);await page.goto(`/community/${flowers[0].id}`);
  await page.getByRole('button',{name:'用这张制作'}).click();
  await expect(page).toHaveURL(/\/app\?id=/);
  const designId=new URL(page.url()).searchParams.get('id');expect(designId).toBeTruthy();
  await page.getByRole('button',{name:'返回预览',exact:true}).click();
  const name='窗边的小花与暖暖阳光——给自己的一份手作礼物';
  await fillField(page,'设计名称',name);
  await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('本地：已保存', {exact:true}).first()).toBeVisible();
  await page.route('**/api/community/works?sort=*',route=>route.fulfill({status:503,json:{}}));
  await page.goto('/');const recent=page.getByRole('region',{name:'继续上次制作'});
  // 同名设计合法；必须检查本次实际创建的独立副本，不能只按名称或取首项。
  const resumed=recent.locator(`a[href^="/app?id=${designId}&"]`);await expect(resumed).toHaveCount(1);
  await expect(resumed.getByRole('heading',{name,exact:true})).toBeVisible();
  const preview=resumed.locator('.recent-design-preview');expect((await preview.boundingBox())!.width).toBeGreaterThanOrEqual(88);
  await expect(recent.locator('.recent-design-preview > span')).toHaveCount(0);
  await expect(page.locator('.home-community').getByRole('alert')).toBeVisible();
  await page.screenshot({path:output(`recent-error-${info.project.name}.png`),fullPage:true});
  await recent.scrollIntoViewIfNeeded();
  await page.screenshot({path:output(`recent-detail-${info.project.name}.png`),fullPage:false});
  await page.unroute('**/api/community/works?sort=*');
  await page.locator('.home-community').getByRole('button',{name:'重试',exact:true}).click();
  await expect(page.locator('.home-community img.community-thumbnail').first()).toBeVisible();
});

test('分段滑块随选中位移，日期字段整块可点，审计筛选行底边对齐',async({page})=>{
  await page.setViewportSize({width:1280,height:844});await page.goto('/community');await waitHydrated(page);
  const track=page.locator('.community-filter-bar .segmented-track');
  // 滑块是轨道的 ::before，位移读它 transform 矩阵的 X 分量（在浏览器里解析，Node 没有 DOMMatrix）。
  const thumbX=()=>track.evaluate(node=>new DOMMatrixReadOnly(getComputedStyle(node,'::before').transform).m41);
  expect(await thumbX()).toBe(0);
  await page.getByRole('radio',{name:'精选',exact:true}).check();
  await expect.poll(thumbX).toBeGreaterThan(0);
  // 更多筛选里的「发布日期」：点字段本体（不是右侧日历按钮）就能打开月历
  await page.getByRole('button',{name:'更多筛选',exact:true}).click();
  const group=page.getByRole('group',{name:/发布日期/}).first();await expect(group).toBeVisible();
  await group.click({position:{x:12,y:20}});
  await expect(page.getByRole('dialog',{name:'发布日期'})).toBeVisible();await page.keyboard.press('Escape');
  // 审计筛选：搜索、日期区间、查询三者底边对齐（标签锁高，不因文案长短换行）
  await page.goto('/login?next=/admin/audit');await fillField(page,'邮箱','e2e-admin@example.com');await fillField(page,'密码','E2e-pass-123!');
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect.poll(()=>new URL(page.url()).pathname).toBe('/admin/audit');await waitHydrated(page);
  await expectBottomsAligned([page.getByRole('textbox',{name:'搜索记录'}),page.getByRole('group',{name:/日期范围/}).first(),page.getByRole('button',{name:'查询',exact:true})]);
});

test('空白起稿有唯一主按钮：选板数只改摘要，点「创建空白图纸」才进入修补',async({page})=>{
  await page.setViewportSize({width:1280,height:844});await page.goto('/app?new=1#blank-start');await waitHydrated(page);
  const create=page.getByRole('button',{name:'创建空白图纸',exact:true});await expect(create).toBeVisible();
  await expect(page.getByText(/将创建 29 × 29 格/)).toBeVisible();
  await page.getByRole('radio',{name:'2 板',exact:true}).check();
  await expect(page.getByText(/将创建 58 × 58 格/)).toBeVisible();
  await expect(page.getByRole('tab',{name:'编辑'})).toHaveCount(0);
  expect((await new AxeBuilder({page}).include('#blank-start').analyze()).violations).toEqual([]);
  await create.click();
  await expect(page.getByRole('tab',{name:'编辑'})).toHaveAttribute('aria-selected','true');
});
