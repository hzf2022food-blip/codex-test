
import {test,expect} from '@playwright/test';
import ExcelJS from 'exceljs';
async function signIn(page){await page.goto('/login');await page.getByLabel('工作台账号').fill('browser-test-owner');await page.getByLabel('工作台密码').fill('Only-for-browser-CI-42-password');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(u=>u.pathname==='/');}
async function open(page){await page.goto('/#A01?business=BUS-001');await page.getByRole('button',{name:'表格导入',exact:true}).click();await expect(page.locator('#table-import-dialog')).toBeVisible();}
async function csv(page,content){await page.locator('#ti-file').setInputFiles({name:'供应商.csv',mimeType:'text/csv',buffer:Buffer.from(content)});await expect(page.locator('#ti-message')).toContainText('已读取');}
async function preview(page){await page.getByRole('button',{name:'预览导入',exact:true}).click();await expect(page.locator('#ti-message')).toContainText('预览完成');}
test('Excel/CSV import, preview, backup, duplicates, conflicts, references and mobile persistence',async({browser})=>{
 const desktop=await browser.newContext({viewport:{width:1365,height:950}}),phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await desktop.newPage(),mobile=await phone.newPage(),name='表格供应商-'+Date.now(),factory='表格工厂-'+Date.now(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));mobile.on('pageerror',e=>errors.push(e.message));
 try{
  await signIn(page);await open(page);
  const template=page.waitForEvent('download');await page.getByRole('link',{name:'下载当前类型模板'}).click();expect((await template).suggestedFilename()).toContain('.xlsx');
  const content='公司名称,联系电话,备注\n'+name+',001234,浏览器测试';
  await csv(page,content);await expect(page.locator('#ti-map-name')).toHaveValue('0');await preview(page);await expect(page.locator('#ti-message')).toContainText('新增 1 条');
  const before=await (await page.request.get('/api/workspace')).json();expect(before.supply.suppliers.some(r=>r.name===name)).toBe(false);
  const backup=page.waitForEvent('download');await page.getByRole('button',{name:'导出导入前备份'}).click();expect((await backup).suggestedFilename()).toContain('.json');
  await page.getByRole('button',{name:'确认导入到云端'}).click();await expect(page.locator('#table-import-dialog')).not.toBeVisible();
  await expect(page.locator('#record-results').getByText(name,{exact:true})).toBeVisible();await page.reload();await expect(page.locator('#record-results').getByText(name,{exact:true})).toBeVisible();
  await signIn(mobile);await mobile.goto('/#A01?business=BUS-001');await expect(mobile.locator('#record-results').getByText(name,{exact:true})).toBeVisible();await expect(mobile.getByText('001234',{exact:true})).toBeVisible();
  await open(page);await csv(page,content);await preview(page);await expect(page.locator('#ti-message')).toContainText('跳过 1 条');await expect(page.getByRole('button',{name:'确认导入到云端'})).toBeDisabled();
  await csv(page,'公司名称,联系电话\n'+name+',009999');await preview(page);await expect(page.locator('#ti-message')).toContainText('错误 1 条');await expect(page.getByRole('button',{name:'确认导入到云端'})).toBeDisabled();
  const report=page.waitForEvent('download');await page.getByRole('button',{name:'下载错误清单CSV'}).click();expect((await report).suggestedFilename()).toContain('.csv');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await open(mobile);await mobile.locator('#ti-kind').selectOption('factories');
  const book=new ExcelJS.Workbook();book.addWorksheet('说明').addRow(['填写说明']);const sheet=book.addWorksheet('工厂资料');sheet.addRow(['工厂名称','联系电话','产能']);sheet.addRow([factory,'000456','待核实']);
  await mobile.locator('#ti-file').setInputFiles({name:'工厂.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});
  await expect(mobile.locator('#ti-sheet')).toContainText('工厂资料');await mobile.locator('#ti-sheet').selectOption('1');await expect(mobile.locator('#ti-map-name')).toHaveValue('0');await preview(mobile);
  expect(await mobile.evaluate(()=>document.querySelector('#table-import-dialog').scrollWidth<=document.querySelector('#table-import-dialog').clientWidth+1)).toBe(true);
  const png=(await mobile.screenshot({fullPage:true})).toString('base64'),size=6000,count=Math.ceil(png.length/size);for(let i=0;i<count;i++)console.log('OPC_PNG:phone-table-import:'+i+':'+count+':'+png.slice(i*size,(i+1)*size));
  await mobile.getByRole('button',{name:'确认导入到云端'}).click();await expect(mobile.locator('#table-import-dialog')).not.toBeVisible();
  await open(page);await page.locator('#ti-kind').selectOption('links');await csv(page,'供应商名称,工厂名称\n'+name+','+factory);await preview(page);await page.getByRole('button',{name:'确认导入到云端'}).click();await expect(page.locator('#table-import-dialog')).not.toBeVisible();
  const state=await (await page.request.get('/api/workspace')).json(),supplier=state.supply.suppliers.find(r=>r.name===name),fac=state.supply.factories.find(r=>r.name===factory);
  expect(fac.phone).toBe('000456');expect(state.supply.links.some(r=>r.supplierId===supplier.id&&r.factoryId===fac.id)).toBe(true);
  await page.goto('/#system?business=BUS-001');await expect(page.getByRole('heading',{name:'云端连接与数据管理'})).toBeVisible();await page.getByRole('button',{name:'完整备份',exact:true}).click();await expect(page.getByRole('heading',{name:'完整备份与恢复'})).toBeVisible();expect(errors).toEqual([]);
 }finally{await desktop.close();await phone.close();}
});
