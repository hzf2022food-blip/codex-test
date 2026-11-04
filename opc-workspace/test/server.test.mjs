
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApplication} from '../server.mjs';
import {opsPrepare} from '../domain.mjs';

test('authenticated PostgreSQL persistence, idempotency and account isolation',async t=>{
 const env={...process.env,NODE_ENV:'test',ADMIN_LOGIN:'api-'+randomUUID(),ADMIN_PASSWORD:'Only-for-isolated-CI-test-42',PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:''};
 let app=await createApplication({env});
 async function listen(){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+app.server.address().port;}
 let origin=await listen(),session='';
 const call=(path,options={})=>fetch(origin+path,{redirect:'manual',...options,headers:{...(session?{cookie:session}:{}),...(options.method?{origin,'content-type':'application/json'}:{}),...options.headers}});
 try{
  await t.test('unauthenticated API cannot read records',async()=>assert.equal((await call('/api/workspace')).status,401));
  await t.test('unauthenticated page redirects to login',async()=>assert.equal((await call('/')).status,303));
  await t.test('wrong password rejected',async()=>assert.equal((await call('/api/login',{method:'POST',body:JSON.stringify({login:env.ADMIN_LOGIN,password:'wrong'})})).status,401));
  const login=await call('/api/login',{method:'POST',body:JSON.stringify({login:env.ADMIN_LOGIN,password:env.ADMIN_PASSWORD})});assert.equal(login.status,200);session=login.headers.get('set-cookie').split(';')[0];
  let before=await (await call('/api/workspace')).json();
  assert.equal(before.operations.tasks.length,0);
  const next=opsPrepare(before.operations,before.supply,'tasks',{name:'跨设备任务',businessId:'BUS-001',module:'A00',priority:'P0',owner:'测试',dueDate:'',nextAction:'核对同步',status:'待办',outputURL:'',notes:''},new Date().toISOString(),p=>p+'-'+randomUUID());
  const body={requestId:randomUUID(),expectedRevision:before.revision,supply:before.supply,operations:next};
  await t.test('forged origin rejected',async()=>assert.equal((await call('/api/workspace',{method:'PUT',headers:{origin:'https://other.invalid'},body:JSON.stringify(body)})).status,403));
  let saved;
  await t.test('save reaches PostgreSQL',async()=>{const r=await call('/api/workspace',{method:'PUT',body:JSON.stringify(body)});assert.equal(r.status,200);saved=await r.json();assert.equal(saved.operations.tasks[0].name,'跨设备任务');});
  await t.test('same request is idempotent',async()=>{const r=await call('/api/workspace',{method:'PUT',body:JSON.stringify(body)});assert.equal(r.status,200);const data=await r.json();assert.equal(data.revision,saved.revision);assert.equal(data.operations.tasks.length,1);});
  await t.test('stale writes rejected',async()=>assert.equal((await call('/api/workspace',{method:'PUT',body:JSON.stringify({...body,requestId:randomUUID()})})).status,409));
  await t.test('invalid relationships rejected without partial write',async()=>{
   const bad=JSON.parse(JSON.stringify(saved));bad.operations.revision++;bad.operations.skus.push({id:'SKU-invalid',businessId:'BUS-001',name:'bad',productId:'PRD-missing',color:'',size:'',weight:'',unit:'卷',barcode:'',status:'在用',notes:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),postedAt:''});
   const r=await call('/api/workspace',{method:'PUT',body:JSON.stringify({...bad,requestId:randomUUID(),expectedRevision:saved.revision})});assert.equal(r.status,422);
   const after=await (await call('/api/workspace')).json();assert.equal(after.revision,saved.revision);assert.equal(after.operations.skus.length,0);
  });
  await t.test('all state persists across application restart',async()=>{await app.close();app=await createApplication({env});origin=await listen();const r=await call('/api/workspace');assert.equal(r.status,200);assert.equal((await r.json()).operations.tasks[0].name,'跨设备任务');});
  await t.test('separate owner cannot read original account',async()=>{
   const other=await createApplication({env:{...env,ADMIN_LOGIN:'other-'+randomUUID()}});await new Promise(resolve=>other.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+other.server.address().port;
   try{assert.equal((await fetch(url+'/api/workspace',{headers:{cookie:session}})).status,401);}finally{await other.close();}
  });
  await t.test('logout revokes the session',async()=>{assert.equal((await call('/api/logout',{method:'POST',body:'{}'})).status,200);assert.equal((await call('/api/workspace')).status,401);});
 }finally{await app.close();}
});


test('spreadsheet preview and atomic commit through authenticated cloud API',async t=>{
 const env={...process.env,NODE_ENV:'test',ADMIN_LOGIN:'import-'+randomUUID(),ADMIN_PASSWORD:'Only-for-import-CI-42-password',PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:''};
 const app=await createApplication({env});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;
 let cookie='';
 const call=(path,body,extra={})=>fetch(origin+path,{redirect:'manual',method:body?'POST':'GET',...extra,headers:{...(cookie?{cookie}:{}),...(body?{origin,'content-type':'application/json'}:{}),...extra.headers},body:body?JSON.stringify(body):undefined});
 const payload=(csv,more={})=>({filename:'供应商.csv',file:Buffer.from(csv).toString('base64'),kind:'suppliers',businessId:'BUS-001',mapping:{name:0,phone:1},...more});
 const preview=async p=>{const r=await call('/api/import/preview',p);assert.equal(r.status,200,await r.clone().text());return r.json();};
 try{
  await t.test('upload requires login',async()=>assert.equal((await call('/api/import/inspect',payload('名称,电话\n甲,00123'))).status,401));
  const login=await call('/api/login',{login:env.ADMIN_LOGIN,password:env.ADMIN_PASSWORD});cookie=login.headers.get('set-cookie').split(';')[0];
  await t.test('template download is protected and valid xlsx',async()=>{const r=await call('/api/import/template?kind=suppliers');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/spreadsheet/);assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0,2).toString(),'PK');});
  await t.test('forged origin is rejected',async()=>assert.equal((await call('/api/import/preview',payload('名称,电话\n甲,00123'),{headers:{origin:'https://other.invalid'}})).status,403));
  await t.test('inspect detects fields and does not save business data',async()=>{
   const r=await call('/api/import/inspect',payload('供应商名称,电话\n甲,00123'));assert.equal(r.status,200);assert.deepEqual((await r.json()).mapping,{name:0,phone:1});
   assert.equal((await (await call('/api/workspace')).json()).supply.suppliers.length,0);
  });
  let plan;
  await t.test('preview is temporary and leaves entities unchanged',async()=>{
   plan=await preview(payload('供应商名称,电话\n甲,00123'));assert.ok(plan.previewId);assert.equal(plan.summary.added,1);
   assert.equal((await (await call('/api/workspace')).json()).supply.suppliers.length,0);
  });
  let saved;
  await t.test('confirmed batch reaches PostgreSQL with audit and text phones',async()=>{
   const r=await call('/api/import/commit',{previewId:plan.previewId});assert.equal(r.status,200);saved=await r.json();assert.equal(saved.supply.suppliers[0].phone,'00123');assert.equal(saved.supply.logs[0].action,'表格导入');
  });
  await t.test('repeated confirmation is idempotent and survives application sessions',async()=>{
   const r=await call('/api/import/commit',{previewId:plan.previewId});assert.equal(r.status,200);const x=await r.json();assert.equal(x.replayed,true);assert.equal(x.supply.suppliers.length,1);assert.equal(x.revision,saved.revision);
  });
  await t.test('same file skipped without a new commit token',async()=>{const x=await preview(payload('供应商名称,电话\n甲,00123'));assert.equal(x.summary.skipped,1);assert.equal(x.previewId,null);});
  await t.test('one conflicting row prevents all rows from being committed',async()=>{
   const x=await preview(payload('供应商名称,电话\n乙,00999\n甲,00456'));assert.equal(x.summary.errors,1);assert.equal(x.previewId,null);
   assert.equal((await (await call('/api/workspace')).json()).supply.suppliers.length,1);
  });
  await t.test('preview token is not accessible to a different account',async()=>{
   const otherEnv={...env,ADMIN_LOGIN:'other-import-'+randomUUID()},other=await createApplication({env:otherEnv});
   await new Promise(resolve=>other.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+other.server.address().port;
   try{const r=await fetch(url+'/api/login',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({login:otherEnv.ADMIN_LOGIN,password:env.ADMIN_PASSWORD})});const otherCookie=r.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(url+'/api/import/commit',{method:'POST',headers:{origin:url,cookie:otherCookie,'content-type':'application/json'},body:JSON.stringify({previewId:plan.previewId})})).status,404);
   }finally{await other.close();}
  });
  await t.test('stale preview cannot replace changes from another device',async()=>{
   const x=await preview(payload('供应商名称,电话\n乙,00999')),before=await (await call('/api/workspace')).json();
   const operations=opsPrepare(before.operations,before.supply,'tasks',{name:'预览期间新增任务',businessId:'BUS-001',module:'A00',priority:'P1',status:'待办'},new Date().toISOString(),p=>p+'-'+randomUUID());
   const r=await fetch(origin+'/api/workspace',{method:'PUT',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),expectedRevision:before.revision,supply:before.supply,operations})});assert.equal(r.status,200);
   assert.equal((await call('/api/import/commit',{previewId:x.previewId})).status,409);
   const current=await (await call('/api/workspace')).json();assert.equal(current.supply.suppliers.length,1);assert.equal(current.operations.tasks.length,1);
  });
  await t.test('expired plans require a new preview',async()=>{
   const x=await preview(payload('供应商名称,电话\n丙,00111'));await app.pool.query("UPDATE opc_import_previews SET expires_at=now()-interval '1 minute' WHERE id=$1",[x.previewId]);
   assert.equal((await call('/api/import/commit',{previewId:x.previewId})).status,404);
  });
 }finally{await app.close();}
});
