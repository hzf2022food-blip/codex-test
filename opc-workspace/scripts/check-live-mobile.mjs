
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const origin=process.env.OPC_PUBLIC_URL;
if(!origin||new URL(origin).protocol!=='https:')throw Error('HTTPS public URL required');
let ready=false;
for(let attempt=0;attempt<12;attempt++){
 try{
  const health=await fetch(new URL('/health',origin),{signal:AbortSignal.timeout(20000),cache:'no-store'});
  assert.equal(health.status,200);assert.equal((await health.json()).version,'0.4.2');
  const manifest=await fetch(new URL('/manifest.webmanifest',origin),{signal:AbortSignal.timeout(20000),cache:'no-store'});
  assert.equal(manifest.status,200);assert.equal((await manifest.json()).display,'standalone');ready=true;break;
 }catch{console.log('Waiting for mobile deployment, attempt '+(attempt+1));if(attempt<11)await new Promise(resolve=>setTimeout(resolve,10000));}
}
assert(ready,'Mobile version has not appeared on the public service');
const browser=await chromium.launch();
try{
 const context=await browser.newContext({baseURL:origin,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/login',{timeout:60000,waitUntil:'networkidle'});
 await page.getByLabel('工作台账号').waitFor();
 assert.equal(await page.locator('link[rel="manifest"]').getAttribute('href'),'/manifest.webmanifest');
 await page.getByRole('button',{name:'＋ 添加到手机桌面',exact:true}).waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const box=await page.getByRole('button',{name:'＋ 添加到手机桌面',exact:true}).boundingBox();
 assert(box.x>=0&&box.x+box.width<=390,'Install button must fit inside phone screen');
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 assert.equal((await context.request.get('/api/workspace')).status(),401);
 assert.deepEqual(errors,[]);
 const png=(await page.screenshot({fullPage:true})).toString('base64'),size=6000,count=Math.ceil(png.length/size);
 for(let i=0;i<count;i++)console.log('OPC_PNG:live-phone-login:'+i+':'+count+':'+png.slice(i*size,(i+1)*size));
 console.log('LIVE_MOBILE_OK: health database ready, v0.4.2 manifest, public phone login, home screen button, worker registration, unauthorized data blocked');
 await context.close();
}finally{await browser.close();}
