import { expect, test, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fillField, selectChoice, waitHydrated } from './helpers';

const widths=[350,390,768,1280,1440];
const output=(name:string)=>resolve('.scratch/site-visual-refinement/evidence',name);
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
  await expect(upload).toHaveCSS('background-color','rgb(150, 48, 79)');
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
    await author.getByRole('checkbox',{name:/我确认拥有发布权/}).check();
    await author.getByRole('button',{name:'冻结快照并提交审核'}).click();
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
  await expect(page.getByRole('heading',{name:'匿名分析校样',exact:true})).toBeVisible();
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
  await page.locator('.community-card a').first().click();await page.getByRole('button',{name:'用这张制作'}).click();
  await expect(page).toHaveURL(/\/app\?id=/);
  await page.getByRole('button',{name:'返回预览',exact:true}).click();
  const name='窗边的小花与暖暖阳光——给自己的一份手作礼物';
  await fillField(page,'设计名称',name);
  await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('本地：已保存', {exact:true}).first()).toBeVisible();
  await page.route('**/api/community/works?sort=*',route=>route.fulfill({status:503,json:{}}));
  await page.goto('/');const recent=page.getByRole('region',{name:'继续上次制作'});
  await expect(recent.getByRole('heading',{name,exact:true})).toBeVisible();
  const preview=recent.locator('.recent-design-preview').first();expect((await preview.boundingBox())!.width).toBeGreaterThanOrEqual(88);
  await expect(recent.locator('.recent-design-preview > span')).toHaveCount(0);
  await expect(page.locator('.home-community').getByRole('alert')).toBeVisible();
  await page.screenshot({path:output(`recent-error-${info.project.name}.png`),fullPage:true});
  await recent.scrollIntoViewIfNeeded();
  await page.screenshot({path:output(`recent-detail-${info.project.name}.png`),fullPage:false});
  await page.unroute('**/api/community/works?sort=*');
  await page.locator('.home-community').getByRole('button',{name:'重试',exact:true}).click();
  await expect(page.locator('.home-community canvas').first()).toBeVisible();
});
