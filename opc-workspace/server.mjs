
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {emptySupply, validateSupply, opsEmpty, opsValidate, OPS_SPEC} from './domain.mjs';

const ROOT=new URL('.',import.meta.url);
const MAX_BODY=20*1024*1024;
function canonical(d){for(const key of Object.keys(d))if(Array.isArray(d[key]))d[key].sort((a,b)=>String(a.createdAt||a.at||'').localeCompare(String(b.createdAt||b.at||''))||a.id.localeCompare(b.id));return d;}
const sha=v=>createHash('sha256').update(v).digest('hex');
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
function json(res,status,value,extra={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(value));}
async function readJSON(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'请使用JSON请求');
 const chunks=[];let length=0;
 for await(const chunk of req){length+=chunk.length;if(length>MAX_BODY)throw new HttpError(413,'数据超过20MB');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'JSON格式错误');}
}
function cookie(req,name){const found=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));return found?found.slice(name.length+1):'';}
function tlsOptions(url,mode){
 if(mode==='disable')return false;
 const u=new URL(url);
 // Render private-network URLs use a short host and support self-signed TLS.
 if(mode==='render-internal'||(!u.hostname.includes('.')&&u.hostname.startsWith('dpg-')))return {rejectUnauthorized:false};
 if(mode==='require')return {rejectUnauthorized:true};
 if(['localhost','127.0.0.1','::1'].includes(u.hostname))return false;
 return {rejectUnauthorized:true};
}
export async function createApplication(options={}){
 const env=options.env||process.env,production=env.NODE_ENV==='production';
 const login=String(env.ADMIN_LOGIN||'').trim().toLowerCase(),password=String(env.ADMIN_PASSWORD||'');
 if(!login||login.length>200||(password.length<16||password.length>512))throw new Error('设置ADMIN_LOGIN和至少16位的ADMIN_PASSWORD后再启动');
 if(!env.DATABASE_URL)throw new Error('缺少DATABASE_URL，请使用Render Postgres连接地址');
 const connection=new URL(env.DATABASE_URL);
 for(const k of ['sslmode','sslcert','sslkey','sslrootcert'])connection.searchParams.delete(k);
 const pool=new Pool({connectionString:connection.toString(),ssl:tlsOptions(env.DATABASE_URL,env.DATABASE_SSL),max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:20000});
 const sql=await readFile(new URL('schema.sql',ROOT),'utf8');
 try{await pool.query(sql);}catch(e){await pool.end();throw e;}
 const salt=randomBytes(16),passwordHash=scryptSync(password,salt,32),credentialVersion=sha(login+'\0'+password);
 const cookieName=production?'__Host-opc_session':'opc_session';
 const cookieOptions='; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800'+(production?'; Secure':'');
 const attempts=new Map();
 const clientTemplate=await readFile(new URL('public/index.html',ROOT),'utf8');
 const loginPage=await readFile(new URL('public/login.html',ROOT),'utf8');
 async function tx(actor,fn){
  const db=await pool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('app.user_sub',$1,true)",[actor]);const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }
 async function workspace(db,lock=false){
  await db.query("INSERT INTO opc_workspaces(id,owner_subject) VALUES($1,$2) ON CONFLICT(owner_subject) DO NOTHING",[randomUUID(),login]);
  const r=await db.query('SELECT * FROM opc_workspaces WHERE owner_subject=$1'+(lock?' FOR UPDATE':''),[login]);return r.rows[0];
 }
 async function snapshot(db,w){
  const supply=emptySupply(),operations=opsEmpty(false);
  supply.revision=Number(w.supply_revision);operations.revision=Number(w.operations_revision);
  const rows=await db.query('SELECT entity_type,payload FROM opc_entities WHERE workspace_id=$1 ORDER BY created_at,entity_id',[w.id]);
  for(const row of rows.rows){const isSupply=row.entity_type.startsWith('supply_'),kind=row.entity_type.slice(isSupply?7:11),target=isSupply?supply:operations;if(Array.isArray(target[kind]))target[kind].push(row.payload);}
  return {revision:Number(w.revision),supply:canonical(validateSupply(supply)),operations:canonical(opsValidate(operations,validateSupply(supply)))};
 }
 async function authenticated(req){
  const token=cookie(req,cookieName);if(!/^[a-f0-9]{64}$/.test(token))return false;
  const q=await pool.query('SELECT token_hash FROM opc_sessions WHERE token_hash=$1 AND user_subject=$2 AND credential_version=$3 AND expires_at>now()',[sha(token),login,credentialVersion]);return q.rowCount===1;
 }
 function checkOrigin(req){
  const configured=env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL;
  const expected=configured?new URL(configured).origin:(production?'https://':'http://')+req.headers.host;
  if(req.headers.origin!==expected)throw new HttpError(403,'请求来源不匹配，请从工作台网址重新打开');
 }
 function validateChange(before,raw){
  const supply=canonical(validateSupply(raw?.supply)),operations=canonical(opsValidate(raw?.operations,supply));
  for(const [name,next] of [['supply',supply],['operations',operations]]){
   const old=before[name],oldArrays=Object.keys(old).filter(k=>Array.isArray(old[k]));
   for(const kind of oldArrays){
    const seen=new Set();for(const row of next[kind]){if(!row.id||seen.has(row.id))throw new HttpError(422,'记录编号缺失或重复');seen.add(row.id);}
    for(const row of old[kind]){const replacement=next[kind].find(x=>x.id===row.id);if(!replacement)throw new HttpError(422,'请归档记录，不能删除历史档案');
     if(kind==='logs'&&stable(row)!==stable(replacement))throw new HttpError(422,'历史操作日志不可修改');
     if(row.createdAt&&replacement.createdAt!==row.createdAt)throw new HttpError(422,'已有记录的创建时间不可修改');
     if(name==='operations'&&kind==='movements'&&row.status==='已审核'&&stable(row)!==stable(replacement))throw new HttpError(422,'已审核流水只能冲销，不能修改');
    }
   }
   const changed=oldArrays.some(k=>stable(old[k])!==stable(next[k]));
   if(next.revision!==old.revision+(changed?1:0))throw new HttpError(409,'数据修订号不一致，请刷新后再保存');
  }
  return {supply,operations};
 }
 async function saveSnapshot(body){
  if(!Number.isSafeInteger(body.expectedRevision)||typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(body.requestId))throw new HttpError(400,'缺少有效请求编号或修订号');
  const hash=sha(stable({expectedRevision:body.expectedRevision,supply:body.supply,operations:body.operations}));
  return tx(login,async db=>{
   const w=await workspace(db,true);
   const repeated=await db.query('SELECT request_hash FROM opc_requests WHERE workspace_id=$1 AND request_id=$2',[w.id,body.requestId]);
   if(repeated.rowCount){if(repeated.rows[0].request_hash!==hash)throw new HttpError(409,'相同请求编号对应不同内容');return {...await snapshot(db,w),replayed:true};}
   if(Number(w.revision)!==body.expectedRevision)throw new HttpError(409,'另一设备已更新，请刷新后再提交；当前表单未保存');
   const before=await snapshot(db,w);
   let next;try{next=validateChange(before,body);}catch(e){throw e.status?e:new HttpError(422,e.message);}
   const revision=Number(w.revision)+1;
   for(const [group,data] of Object.entries(next)){
    for(const kind of Object.keys(data).filter(k=>Array.isArray(data[k]))){
     const old=new Map(before[group][kind].map(x=>[x.id,x]));
     for(const record of data[kind]){
      const previous=old.get(record.id);if(previous&&stable(previous)===stable(record))continue;
      const type=group+'_'+kind,business=record.businessId||null;
      await db.query('INSERT INTO opc_entities(workspace_id,entity_type,entity_id,business_id,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,entity_type,entity_id) DO UPDATE SET payload=EXCLUDED.payload,business_id=EXCLUDED.business_id,row_revision=opc_entities.row_revision+1,updated_at=now()',[w.id,type,record.id,business,JSON.stringify(record)]);
      await db.query('INSERT INTO opc_audit(id,workspace_id,actor_subject,request_id,action,entity_type,entity_id,before_payload,after_payload,workspace_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),w.id,login,body.requestId,previous?'update':'create',type,record.id,previous?JSON.stringify(previous):null,JSON.stringify(record),revision]);
     }
    }
   }
   await db.query('UPDATE opc_workspaces SET revision=$1,supply_revision=$2,operations_revision=$3,updated_at=now() WHERE id=$4 AND owner_subject=$5',[revision,next.supply.revision,next.operations.revision,w.id,login]);
   await db.query("INSERT INTO opc_requests(workspace_id,request_id,request_hash,actor_subject,response_payload,workspace_revision) VALUES($1,$2,$3,$4,$5,$6)",[w.id,body.requestId,hash,login,JSON.stringify({revision}),revision]);
   return {revision,...next};
  });
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   const path=new URL(req.url,'http://localhost').pathname;
   if(path==='/health'&&req.method==='GET'){await pool.query('SELECT 1');return json(res,200,{status:'ok',version:'0.4.0'});}
   if(req.method==='POST'||req.method==='PUT')checkOrigin(req);
   if(path==='/api/login'&&req.method==='POST'){
    const body=await readJSON(req),key=req.socket.remoteAddress||'unknown',now=Date.now();let a=attempts.get(key);
    if(!a||now-a.start>15*60*1000){a={start:now,count:0};attempts.set(key,a);}
    if(a.count>=10)throw new HttpError(429,'尝试次数过多，请15分钟后重试');
    a.count++;
    const supplied=String(body.password||'');if(supplied.length>512||String(body.login||'').trim().toLowerCase()!==login||!timingSafeEqual(scryptSync(supplied,salt,32),passwordHash))throw new HttpError(401,'账号或密码不正确');
    a.count=0;
    const token=randomBytes(32).toString('hex');
    await pool.query("INSERT INTO opc_sessions(token_hash,user_subject,credential_version,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",[sha(token),login,credentialVersion]);
    return json(res,200,{ok:true},{'set-cookie':cookieName+'='+token+cookieOptions});
   }
   const authed=await authenticated(req);
   if(path==='/login'&&req.method==='GET'){if(authed){res.writeHead(303,{location:'/'});return res.end();}res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(loginPage);}
   if(!authed){if(path.startsWith('/api/'))throw new HttpError(401,'登录已过期，请重新登录');res.writeHead(303,{location:'/login'});return res.end();}
   if(path==='/api/logout'&&req.method==='POST'){await pool.query('DELETE FROM opc_sessions WHERE token_hash=$1',[sha(cookie(req,cookieName))]);return json(res,200,{ok:true},{'set-cookie':cookieName+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(production?'; Secure':'')});}
   if(path==='/api/workspace'&&req.method==='GET'){
    const current=await tx(login,async db=>{const w=await workspace(db,true);if(new URL(req.url,'http://localhost').searchParams.get('since')===String(w.revision))return null;return snapshot(db,w);});
    if(current===null){res.writeHead(304);return res.end();}return json(res,200,current);
   }
   if(path==='/api/workspace'&&req.method==='PUT')return json(res,200,await saveSnapshot(await readJSON(req)));
   if(path==='/'&&req.method==='GET'){
    const current=await tx(login,async db=>snapshot(db,await workspace(db,true)));
    const serialized=JSON.stringify(current).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    return res.end(clientTemplate.replace('/*OPC_CLOUD_BOOTSTRAP*/','window.OPC_CLOUD='+serialized+';'));
   }
   throw new HttpError(404,'页面或接口不存在');
  }catch(e){
   const status=e.status||500;
   if(status===500)console.error('Request failed',e.code||e.name);
   if(!res.headersSent)json(res,status,{error:status===500?'数据库或服务暂不可用，请稍后重试':e.message});else res.end();
  }
 });
 return {server,pool,async close(){await new Promise(resolve=>server.close(resolve));await pool.end();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const app=await createApplication();const port=Number(process.env.PORT||10000);app.server.listen(port,'0.0.0.0',()=>console.log('OPC service ready on configured PORT'));const stop=async()=>{await app.close();process.exit(0);};process.once('SIGTERM',stop);process.once('SIGINT',stop);}catch(e){console.error('OPC startup failed:',e.code||e.message);process.exit(1);}
}
