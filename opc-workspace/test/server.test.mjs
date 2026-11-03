
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
