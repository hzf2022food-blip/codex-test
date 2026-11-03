
import {test,expect} from '@playwright/test';
async function signIn(page){
 await page.goto('/login');
 await page.getByLabel('工作台账号').fill('browser-test-owner');
 await page.getByLabel('工作台密码').fill('Only-for-browser-CI-42-password');
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(url=>url.pathname==='/');
}
async function screenshotToLog(page,name){
 const image=await page.screenshot({fullPage:true}),base=image.toString('base64'),size=6000,count=Math.ceil(base.length/size);
 for(let i=0;i<count;i++)console.log('OPC_PNG:'+name+':'+i+':'+count+':'+base.slice(i*size,(i+1)*size));
}
test('desktop -> phone -> desktop sync, refresh, backup and private login',async({browser})=>{
 const desktop=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:{width:1365,height:1000}});
 const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await desktop.newPage(),mobile=await phone.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));mobile.on('pageerror',e=>errors.push(e.message));
 const name='浏览器同步测试-'+Date.now();
 try{
  await signIn(page);
  await page.goto('/#A00?business=BUS-001');
  await page.getByRole('button',{name:/新增任务与行动/}).click();
  await page.getByLabel(/^任务名称/).fill(name);
  await page.getByRole('button',{name:'保存记录',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText(name,{exact:true})).toBeVisible();
  await signIn(mobile);await mobile.goto('/#A00?business=BUS-001');
  const row=mobile.getByRole('row').filter({hasText:name});
  await expect(row).toBeVisible();
  await row.getByRole('button',{name:'编辑',exact:true}).click();
  await mobile.getByLabel(/^任务名称/).fill(name+'-手机更新');
  await mobile.getByRole('button',{name:'保存记录',exact:true}).click();
  await expect(mobile.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'同步',exact:true}).click();
  await expect(page.getByText(name+'-手机更新',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText(name+'-手机更新',{exact:true})).toBeVisible();
  await screenshotToLog(page,'desktop-tasks');
  await screenshotToLog(mobile,'phone-tasks');
  await page.getByRole('button',{name:'完整备份',exact:true}).click();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出全部 JSON'}).click();
  expect((await download).suggestedFilename()).toContain('.json');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'退出',exact:true}).click();
  await page.waitForURL(/\/login$/);
  expect(errors).toEqual([]);
 }finally{await desktop.close();await phone.close();}
});
