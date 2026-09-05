import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';
import { fillField, selectChoice, waitHydrated } from './helpers';

const widths=[350,390,768,1280,1440];
const output=(name:string)=>resolve('.scratch/site-visual-refinement/evidence',name);

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

test('后台待审、批次和人员队列五宽度排版与无障碍',async({page},info)=>{
  await page.goto('/login?next=/admin/reviews');await fillField(page,'邮箱','e2e-admin@example.com');await fillField(page,'密码','E2e-pass-123!');
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/admin\/reviews$/);
  for(const route of ['/admin/reviews','/admin/batches','/admin/users']){
    await page.goto(route);await waitHydrated(page);await expect(page.locator('main#main h1')).toBeVisible();await page.evaluate(()=>document.fonts.ready.then(()=>undefined));
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
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/admin\/analytics$/);
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
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/community$/);
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
