/** Visual QA with Microsoft's actual template engine and browser renderer.
 * This proves template expansion/rendering, not registration in Windows Widgets Board.
 * HostConfig uses heyta tokens for a reproducible visual preview; system host styling may differ.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '../../e2e/node_modules/@playwright/test/index.mjs';
import { ADAPTIVE_CARD_KINDS, ADAPTIVE_CARD_TEMPLATES, buildAdaptiveCardData, buildAdaptiveCardPlaceholder } from '../../packages/widget-core/dist/index.js';
import { translate } from '../../packages/i18n/dist/index.js';
import { tokensForTheme } from '../../packages/design-system/dist/index.js';
// QA-only Microsoft SDKs; never shipped with heyta. MIT, upstream active 2026-10-06.
// npm install --prefix /tmp/heyta-widget-render-qa --ignore-scripts adaptivecards@3.0.6 adaptivecards-templating@2.3.1
const QA=process.env.HEYTA_WIDGET_QA_DIR ?? '/tmp/heyta-widget-render-qa';
const require=createRequire(resolve(QA, 'package.json'));
const {Template}=require('adaptivecards-templating');
const ROOT=fileURLToPath(new URL('../../', import.meta.url));
const OUT=ROOT+'/apps/web/evidence/widget-cards-final';
await mkdir(OUT,{recursive:true});
const payload=JSON.parse(await readFile(ROOT+'/packages/widget-core/fixtures/v1.golden.plaintext.json','utf8'));
const browser=await chromium.launch({headless:true});
const results=[];
try {
 for(const locale of ['zh-CN','en']) for(const theme of ['light','dark']) for(const width of [280,340]) {
  const page=await browser.newPage({viewport:{width:800,height:1400}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const tokens=tokensForTheme(theme);
  await page.setContent('<html><body><main id="cards"></main></body></html>');
  await page.addScriptTag({path:resolve(QA,'node_modules/adaptivecards/dist/adaptivecards.js')});
  await page.addStyleTag({path:resolve(QA,'node_modules/adaptivecards/dist/adaptivecards.css')});
  await page.addStyleTag({content:`body{margin:24px;background:${tokens['color.background']};font-family:system-ui}#cards{display:grid;grid-template-columns:repeat(2,${width}px);gap:24px;align-items:start}.sample{overflow:hidden;border-radius:12px;background:${tokens['color.surface']}}`});
  for(const kind of ADAPTIVE_CARD_KINDS) for(const state of ['ready','placeholder','empty','long']) {
   const t=(key,vars)=>translate(locale,key,vars);
   const input=structuredClone(payload);
   if(state==='empty'){input.today=[];input.quadrant={};input.habits=[];input.focus={active:false};}
   if(state==='long'){for(const row of [...input.today,...Object.values(input.quadrant).flat(),...input.habits]) row.title=locale==='zh-CN'?'阅读最新版本的跨平台设计方案并整理需要在下次讨论会上确认的产品交互细节':'Review the latest cross-platform design and prepare interaction details for the next product discussion';}
   const data=state==='placeholder'?buildAdaptiveCardPlaceholder(kind,t):buildAdaptiveCardData(kind,input,'2026-10-07',t);
   const expanded=new Template(ADAPTIVE_CARD_TEMPLATES[kind]).expand({$root:data});
   const sample=await page.evaluate(({expanded,tokens,kind,state})=>{
    const host=new AdaptiveCards.HostConfig({fontFamily:'system-ui',fontSizes:{small:12,default:14,medium:16,large:20,extraLarge:26},containerStyles:{default:{backgroundColor:tokens['color.surface'],foregroundColors:{default:{default:tokens['color.foreground'],subtle:tokens['color.foreground-muted']},accent:{default:tokens['color.primary'],subtle:tokens['color.primary']},good:{default:tokens['color.success-strong'],subtle:tokens['color.success-strong']}}}}});
    const card=new AdaptiveCards.AdaptiveCard();card.hostConfig=host;card.parse(expanded);
    const validation=card.validateProperties().validationEvents.map(v=>v.message);
    const el=card.render();const container=document.createElement('div');container.className='sample';container.dataset.kind=kind;container.dataset.state=state;container.append(el);document.querySelector('#cards').append(container);
    const rect=container.getBoundingClientRect();
    return {kind,state,validation,text:el.innerText,height:rect.height,width:rect.width,overflow:el.scrollWidth>el.clientWidth+1};
   },{expanded,tokens,kind,state});
   results.push({locale,theme,hostWidth:width,...sample});
  }
  await page.screenshot({path:`${OUT}/${locale}-${theme}-${width}.png`,fullPage:true});
  results.push({locale,theme,hostWidth:width,pageErrors:errors});await page.close();
 }
 await writeFile(OUT+'/render-results.json',JSON.stringify(results,null,2));
 const bad=results.filter(r=>r.overflow||r.validation?.length||r.pageErrors?.length||r.text?.includes('${'));
 console.log(JSON.stringify({states:results.filter(r=>r.kind).length,failures:bad},null,2));
 if(bad.length) process.exitCode=1;
} finally {await browser.close();}
