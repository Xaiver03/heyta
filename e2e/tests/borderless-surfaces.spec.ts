import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { openApp, openSettingsSheet, closeSettingsSheet, selectSettingsSection, switchTheme, switchView } from './helpers';
const out = fileURLToPath(new URL('../../apps/web/evidence/borderless-surfaces', import.meta.url));

test('全局无描边：设置各组与主视图真实页面巡检', async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(out, { recursive:true });
  await openApp(page);
  await page.emulateMedia({ reducedMotion:'reduce' });
  const rows=[];
  for(const theme of ['light','dark'] as const) {
    if(await page.locator('html').getAttribute('data-theme')!==theme) await switchTheme(page,theme);
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:width===390?844:900});
      await openSettingsSheet(page);
      for(const section of ['profile','appearance','sync','ai','data','account','help'] as const) {
        await selectSettingsSection(page,section);
        await page.screenshot({path:`${out}/settings-${section}-${width}-${theme}.png`});
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
        expect(overflow).toBe(false);
        rows.push({surface:`settings-${section}`,width,theme,overflow});
      }
      await closeSettingsSheet(page);
      for(const view of ['任务','习惯','四象限','便签','回收站'] as const) {
        await switchView(page,view);
        await page.screenshot({path:`${out}/view-${view}-${width}-${theme}.png`});
      }
    }
  }
  await writeFile(`${out}/readout.json`,JSON.stringify(rows,null,2));
});

test('窄屏日历范围抽屉按需打开、Esc返回、桌面恢复侧栏',async({page})=>{
  await mkdir(out,{recursive:true});
  await page.setViewportSize({width:390,height:844});
  await openApp(page);
  await switchView(page,'日历');
  await expect(page.locator('#calendar-sidebar')).not.toBeVisible();
  const toggle=page.getByTestId('calendar-sidebar-toggle');
  await toggle.click();
  await expect(page.locator('dialog.ht-scope-drawer')).toBeVisible();
  await expect(page.locator('#calendar-sidebar')).toBeVisible();
  await page.screenshot({path:`${out}/calendar-scope-390.png`});
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.ht-scope-drawer')).not.toBeVisible();
  await expect(toggle).toBeFocused();
  await page.setViewportSize({width:1440,height:900});
  await expect(page.locator('#calendar-sidebar')).toBeVisible();
});
