const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const dir = '/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/design-demos/ai-chat';
  const files = ['A-weknora.html','B-heyta.html','C-editorial.html'];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1060 }, deviceScaleFactor: 2 });
  for (const f of files) {
    const url = 'file://' + path.join(dir, f);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const out = path.join(dir, f.replace('.html','.png'));
    await page.screenshot({ path: out, clip: { x:0, y:0, width:1440, height:1060 } });
    console.log('shot', out);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
