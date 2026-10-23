// Optional browser verification: install Playwright separately, then run this script.
// Start `node serve.cjs` first. CHROME_BIN optionally selects an installed browser.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const output = process.env.TEST_OUTPUT_DIR
  ? path.resolve(process.env.TEST_OUTPUT_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'kaiju-browser-check-'));
fs.mkdirSync(output, {recursive:true});
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4399';
const results = [];
const screenshots = [];
(async () => {
  const browser = await chromium.launch({headless:true,
    ...(process.env.CHROME_BIN ? {executablePath:process.env.CHROME_BIN} : {}),
    args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  async function createPage(width) {
    const context = await browser.newContext({viewport:{width,height:800},deviceScaleFactor:1});
    // The project has no favicon; exclude the browser's optional automatic request.
    await context.route('**/favicon.ico',route=>route.fulfill({status:204}));
    await context.addInitScript(() => {
      window.renderedLabels = new Set();
      for (const method of ['fillText','strokeText']) {
        const original = CanvasRenderingContext2D.prototype[method];
        CanvasRenderingContext2D.prototype[method] = function(text,...args) {
          window.renderedLabels.add(String(text));
          return original.call(this,text,...args);
        };
      }
    });
    const page = await context.newPage();
    const errors = [], warnings = [];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{
      if(message.type()==='error') errors.push(message.text());
      if(message.type()==='warning') warnings.push(message.text());
    });
    return {page,context,errors,warnings};
  }
  async function shot(page,name) {
    await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
    screenshots.push(name+'.png');
  }
  async function inspect(page,label,width,errors,warnings,allowHorizontal=false) {
    const frames = [];
    for(const frame of page.frames()) {
      frames.push(await frame.evaluate(() => ({
        title:document.title,lang:document.documentElement.lang,
        width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
        hasHan:/\p{Script=Han}/u.test(document.documentElement.outerHTML + [...(window.renderedLabels || [])].join('\n')),
        canvasLabels:[...(window.renderedLabels || [])],
      })));
    }
    for(const frame of frames) {
      assert.equal(frame.lang,'en',label+' document language');
      assert(!frame.hasHan,label+' contains a non-English source or canvas label');
      if(!allowHorizontal) assert(frame.scrollWidth<=frame.width+2,label+' horizontal overflow: '+JSON.stringify({width:frame.width,scrollWidth:frame.scrollWidth}));
    }
    assert.deepEqual(errors,[],label+' browser errors');
    results.push({label,width,frames,errors:[...errors],warnings:[...new Set(warnings)]});
  }
  try {
    for(const width of [1280,390,320]) {
      const {page,context,errors,warnings}=await createPage(width);
      await page.goto(base+'/kaiju-destroyer.html');
      await shot(page,'start-'+width);
      await page.locator('#start-guide-button').click();
      assert.equal(await page.locator('#guide-close').evaluate(e=>document.activeElement===e),true);
      await shot(page,'guide-'+width);
      await page.locator('#guide-enemies').scrollIntoViewIfNeeded();
      if(width===320) await shot(page,'guide-enemies-320');
      const overflow=await page.locator('#play-guide').evaluate(dialog=>[...dialog.querySelectorAll('*')].filter(e=>e.clientWidth&&e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.tagName));
      assert.deepEqual(overflow,[],'Guide content fits at '+width);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#start-guide-button').evaluate(e=>document.activeElement===e),true);
      await page.getByRole('button',{name:'Start Rampage',exact:true}).click();
      await page.waitForFunction(()=>game&&game.time>0);
      await page.locator('#play-guide-button').click();
      const before=await page.evaluate(()=>({time:game.time,hp:player.hp,score:player.score}));
      await page.waitForTimeout(150);
      assert.deepEqual(await page.evaluate(()=>({time:game.time,hp:player.hp,score:player.score})),before);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>paused),false);
      await page.keyboard.press('p');
      assert.equal(await page.evaluate(()=>paused),true);
      await shot(page,'paused-'+width);
      await page.keyboard.press('m');
      assert.equal(await page.locator('#mute-button').innerText(),'Unmute');
      await page.evaluate(()=>{player.fartDebuff=60;player.insultDebuff=20;player.lastInsult='Be a team player!';game.draw();drawPauseOverlay();});
      if(width===320) await shot(page,'status-320');
      await page.keyboard.press('p');
      await page.evaluate(()=>{game.running=false;});
      await page.waitForFunction(()=>!document.getElementById('gameover-screen').classList.contains('hidden'));
      if(width===320) await shot(page,'results-320');
      await page.locator('#end-guide-button').click();
      assert.equal(await page.locator('#guide-return').innerText(),'Back to Results');
      await page.keyboard.press('Escape');
      await inspect(page,'Game, guide, pause, mute, and results',width,errors,warnings);
      await page.goto(base+'/kaiju-destroyer.html?heroPractice=1');
      await page.waitForFunction(()=>window.HeroPractice&&HeroPractice.getState().heroState);
      await page.evaluate(()=>HeroPractice.pause(true));
      await shot(page,'practice-'+width);
      await page.locator('#play-guide-button').click();
      assert.equal(await page.locator('#guide-practice-note').isVisible(),true);
      if(width===390) await shot(page,'practice-guide-390');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>paused),true);
      await inspect(page,'Bloom Hero practice and guide',width,errors,warnings);
      await context.close();
    }
    for(const width of [1280,390,320]) {
      for(const route of ['boss-preview.html','hero-preview.html','city-preview.html']) {
        const {page,context,errors,warnings}=await createPage(width);
        await page.goto(base+'/'+route);
        await page.waitForTimeout(400);
        if(route==='boss-preview.html') {await page.locator('#back').click();await page.locator('#taunt').click();}
        if(route==='hero-preview.html') {await page.locator('[data-view="back"]').click();await page.locator('[data-pose="recover"]').click();}
        if(route==='city-preview.html') {
          await page.locator('[data-mode="single"]').click();
          await page.locator('#break-corner').click();
          assert.match(await page.locator('#demo-status').innerText(),/Corner is collapsing/);
          await page.locator('#restore').click();
        }
        await shot(page,route.replace('.html','')+'-'+width);
        await inspect(page,route,width,errors,warnings);
        await context.close();
      }
    }
    for(const route of ['tests/character-check.html','tests/scene-check.html','tests/hero-responsive-check.html','tests/city-responsive-check.html']) {
      const {page,context,errors,warnings}=await createPage(1280);
      await page.goto(base+'/'+route);await page.waitForTimeout(600);
      if(route==='tests/character-check.html') await shot(page,'characters-1280');
      if(route==='tests/scene-check.html') await shot(page,'scene-1280');
      await inspect(page,route,1280,errors,warnings,true);
      await context.close();
    }
    const {page,context,errors,warnings}=await createPage(1280);
    const network=[];page.on('request',request=>{if(/^https?:/.test(request.url())) network.push(request.url());});
    await page.goto(pathToFileURL(path.join(root,'kaiju-destroyer.html')).href);
    await page.getByRole('button',{name:'Start Rampage',exact:true}).click();
    await page.waitForFunction(()=>game&&game.time>0);
    await page.keyboard.press('p');
    assert.deepEqual(network,[],'Direct local-file play makes no HTTP requests');
    await inspect(page,'Offline file launch and gameplay',1280,errors,warnings);
    await context.close();
    fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({checks:results.length,screenshots,results},null,2)+'\n');
    console.log('PASS '+results.length+' browser scenarios; '+screenshots.length+' screenshots saved to '+output);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
