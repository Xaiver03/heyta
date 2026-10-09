/** Real DOM preview interaction and small-screen geometry acceptance. */
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {chromium,expect} from '../../e2e/node_modules/@playwright/test/index.mjs';
const out=process.env.HEYTA_PREVIEW_EVIDENCE ?? fileURLToPath(new URL('../../apps/landing/evidence/dom-preview-final', import.meta.url));await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const results=[];
try {for(const width of [390,1440]) for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.HEYTA_PREVIEW_URL ?? 'http://127.0.0.1:4359/') + '?lang=zh-CN',{waitUntil:'networkidle'});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 const s=page.locator('#showcase');await s.scrollIntoViewIfNeeded();await expect(s.locator('.lp-showcase-interactive__tab-index')).toHaveCount(0);
 const frame=s.locator('.mk-frame');await frame.screenshot({path:`${out}/${width}-${theme}-tasks.png`});
 const metrics=await frame.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,stage:el.querySelector('.mk-stage').scrollWidth,content:el.querySelector('.mk-content').scrollWidth,contentWidth:el.querySelector('.mk-content').clientWidth}));
 expect(metrics.scroll).toBeLessThanOrEqual(metrics.width+1);expect(metrics.content).toBeLessThanOrEqual(metrics.contentWidth+1);
 const task=s.locator('button.mk-task__body').nth(2);const title=await task.getAttribute('aria-label');await task.click();await expect(s.locator('.mk-detail')).toBeVisible();await expect(s.locator('.mk-detail__task-title strong')).toHaveText(title);await frame.screenshot({path:`${out}/${width}-${theme}-detail.png`});
 if(width===390)await s.locator('.mk-detail__close').click();const checkbox=s.locator('button.mk-task__check').first();const before=await checkbox.getAttribute('aria-checked');await checkbox.click();await expect(checkbox).toHaveAttribute('aria-checked',before==='true'?'false':'true');
 for(const key of ['habits','quadrant','focus','timeline']){let tab=s.locator(`button[data-view-key="${key}"]`);if(!(await tab.isVisible()))await s.locator('.mk-rail__more').click();tab=s.locator(`button[data-view-key="${key}"]`);await tab.click();await expect(s.locator('.lp-showcase-interactive__status')).not.toBeEmpty();
 if(key==='habits'){const check=s.locator('.mk-habit__check-in').first();await check.click();await expect(check).toHaveAttribute('aria-pressed','true');await expect(s.locator('.mk-heat button')).toHaveCount(0);}
 const geom=await frame.evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth}));expect(geom.scroll,`${key} frame overflow`).toBeLessThanOrEqual(geom.width+1);await frame.screenshot({path:`${out}/${width}-${theme}-${key}.png`});}
 expect(errors).toEqual([]);results.push({width,theme,metrics,errors});await page.close();
}await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();}
