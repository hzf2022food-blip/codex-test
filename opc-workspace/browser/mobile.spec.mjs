
import {test,expect} from '@playwright/test';

test('public mobile assets install without exposing private workspace',async({request})=>{
 const manifest=await request.get('/manifest.webmanifest');expect(manifest.status()).toBe(200);
 expect(manifest.headers()['content-type']).toContain('application/manifest+json');
 const data=await manifest.json();expect(data.display).toBe('standalone');expect(data.start_url).toBe('/');expect(data.scope).toBe('/');
 expect(data.icons.map(i=>i.sizes)).toEqual(['192x192','512x512']);
 for(const [src,size] of [...data.icons.map(i=>[i.src,Number(i.sizes.split('x')[0])]),['/icons/apple-touch-icon.png',180]]){
  const response=await request.get(src);expect(response.status()).toBe(200);expect(response.headers()['content-type']).toBe('image/png');
  const image=await response.body();expect([...image.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);expect(image.readUInt32BE(16)).toBe(size);expect(image.readUInt32BE(20)).toBe(size);
 }
 const worker=await request.get('/sw.js');expect(worker.status()).toBe(200);expect(worker.headers()['service-worker-allowed']).toBe('/');
 expect((await request.get('/api/workspace')).status()).toBe(401);
 expect((await request.get('/mobile-icons.mjs',{maxRedirects:0})).status()).toBe(303);
});

test('iPhone home screen instructions, phone layout and decoded icon',async({browser})=>{
 const context=await browser.newContext({viewport:{width:360,height:780},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
 const page=await context.newPage();
 try{
  await page.goto('/login');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href','/manifest.webmanifest');
  const imageSize=await page.evaluate(()=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve([i.naturalWidth,i.naturalHeight]);i.onerror=reject;i.src='/icons/apple-touch-icon.png';}));expect(imageSize).toEqual([180,180]);
  await page.getByRole('button',{name:'＋ 添加到手机桌面',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Safari');
  await expect(page.getByRole('dialog')).toContainText('添加到主屏幕');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'知道了',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
 }finally{await context.close();}
});

test('Android install action uses browser prompt and hides once installed',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 try{
  await page.goto('/login');
  await page.getByRole('button',{name:'＋ 添加到手机桌面',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Chrome');
  await page.getByRole('button',{name:'知道了',exact:true}).click();
  await page.evaluate(()=>{
   window.promptUsed=false;const event=new Event('beforeinstallprompt',{cancelable:true});
   event.prompt=async()=>{window.promptUsed=true;};event.userChoice=Promise.resolve({outcome:'accepted'});
   window.dispatchEvent(event);
  });
  await page.getByRole('button',{name:'＋ 添加到手机桌面',exact:true}).click();
  expect(await page.evaluate(()=>window.promptUsed)).toBe(true);
  await expect(page.getByRole('button',{name:'＋ 添加到手机桌面',exact:true})).not.toBeVisible();
 }finally{await context.close();}
});

test('offline launch explains connection requirement and stores no private pages',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 try{
  await page.goto('/login');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  expect(await page.evaluate(()=>caches.keys())).toEqual([]);
  await context.setOffline(true);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'当前离线'})).toBeVisible();
  await expect(page.getByText('云端资料需要联网读取',{exact:false})).toBeVisible();
  await context.setOffline(false);await page.getByRole('link',{name:'重新连接'}).click();
  await expect(page.getByRole('heading',{name:'登录你的工作台'})).toBeVisible();
 }finally{await context.setOffline(false);await context.close();}
});
