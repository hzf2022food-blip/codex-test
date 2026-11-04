
'use strict';
(()=>{
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let schema;
async function api(path,body){
 const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const data=await r.json();if(!r.ok)throw Error(data.error||'读取失败，请稍后再试');return data;
}
window.openTableImport=async function(initialKind='suppliers'){
 let dialog=document.getElementById('table-import-dialog');
 if(dialog?.open)return;
 try{schema=await api('/api/import/schema');}catch(e){window.showToast?.(e.message);return;}
 if(!dialog){dialog=document.createElement('dialog');dialog.id='table-import-dialog';dialog.className='table-import-dialog';dialog.setAttribute('aria-labelledby','ti-title');document.body.append(dialog);}
 const kinds=schema.kinds,kind=Object.hasOwn(kinds,initialKind)?initialKind:'suppliers';
 const defaultBusiness=typeof state!=='undefined'&&state.business!=='all'?state.business:'';
 let current={file:'',filename:'',headers:[],mapping:{},previewId:null,results:[],summary:null},busy=false;
 dialog.innerHTML='<div class="ti-head"><div><h2 id="ti-title">表格导入 · 供应链档案</h2><p>上传表格 → 核对字段 → 预览 → 保存到云端</p></div><button type="button" class="btn" id="ti-close">关闭</button></div>'+
 '<div class="ti-grid"><label>导入类型<select id="ti-kind">'+Object.entries(kinds).map(([k,v])=>'<option value="'+k+'" '+(k===kind?'selected':'')+'>'+v.label+'</option>').join('')+'</select></label>'+
 '<label>默认所属业务<select id="ti-business"><option value="">请选择，或由表格提供</option>'+schema.businesses.map(b=>'<option value="'+b[0]+'" '+(b[0]===defaultBusiness?'selected':'')+'>'+escape(b[1])+'</option>').join('')+'</select></label></div>'+
 '<p class="ti-help">表格有“所属业务”列时按每行导入；没有时使用上方默认业务。先导入供应商和工厂，再按名称或系统编号导入关联关系。</p>'+
 '<div class="ti-file"><label for="ti-file">选择Excel或CSV表格（最多5MB、1000条）</label><input id="ti-file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"><a class="btn" id="ti-template" href="/api/import/template?kind='+kind+'">下载当前类型模板</a></div>'+
 '<div class="ti-grid"><label>工作表<select id="ti-sheet" disabled><option value="0">请先选择文件</option></select></label><label>表头在第几行<input id="ti-header" type="number" min="1" max="20" value="1" inputmode="numeric"></label></div>'+
 '<p id="ti-message" role="status" aria-live="polite">支持.xlsx和CSV；旧.xls请先另存为.xlsx。电话和编号请保留文本格式。</p>'+
 '<section id="ti-mapping"></section><section id="ti-samples"></section><div id="ti-error" role="alert"></div><section id="ti-results" aria-live="polite"></section>'+
 '<div class="ti-actions"><button class="btn" id="ti-backup">导出导入前备份</button><button class="btn" id="ti-error-export" hidden>下载错误清单CSV</button><button class="btn" id="ti-preview" disabled>预览导入</button><button class="btn primary" id="ti-commit" disabled>确认导入到云端</button></div>'+
 '<p class="ti-help">仅新增档案；完全相同的记录跳过，冲突不覆盖。预览有错误时整批不导入。关闭页面前请确认已收到保存成功提示。</p>';
 const el=id=>dialog.querySelector('#'+id),error=message=>{el('ti-error').textContent=message;};
 const body=()=>({kind:el('ti-kind').value,businessId:el('ti-business').value,filename:current.filename,file:current.file,sheet:Number(el('ti-sheet').value||0),headerRow:Number(el('ti-header').value),mapping:current.mapping});
 function invalidate(){current.previewId=null;current.results=[];current.summary=null;el('ti-results').innerHTML='';el('ti-commit').disabled=true;el('ti-error-export').hidden=true;error('');}
 function lock(value){busy=value;dialog.setAttribute('aria-busy',String(value));dialog.querySelectorAll('input,select,button').forEach(control=>control.disabled=value);
  if(!value){el('ti-sheet').disabled=!current.file;el('ti-preview').disabled=!current.file||!current.headers.length;el('ti-commit').disabled=!current.previewId;}}
 function mappings(){
  const fields=kinds[el('ti-kind').value].fields;
  const shown=fields.filter(f=>f[2]||Object.hasOwn(current.mapping,f[0])),other=fields.filter(f=>!f[2]&&!Object.hasOwn(current.mapping,f[0]));
  const field=f=>'<label for="ti-map-'+f[0]+'">'+escape(f[1])+(f[2]?' *':'')+'<select id="ti-map-'+f[0]+'" data-field="'+f[0]+'"><option value="">不导入</option>'+current.headers.map((header,i)=>'<option value="'+i+'" '+(current.mapping[f[0]]===i?'selected':'')+'>'+escape(header)+'（第'+(i+1)+'列）</option>').join('')+'</select></label>';
  el('ti-mapping').innerHTML='<h3>核对字段对应</h3><p class="ti-help">带*为必填。已识别字段显示在下方；其他字段可展开选择。每列只对应一个字段。</p><div class="ti-grid">'+shown.map(field).join('')+'</div>'+(other.length?'<details><summary>其他可选字段（'+other.length+'项）</summary><div class="ti-grid">'+other.map(field).join('')+'</div></details>':'');
  dialog.querySelectorAll('[data-field]').forEach(select=>select.onchange=()=>{invalidate();if(select.value==='')delete current.mapping[select.dataset.field];else current.mapping[select.dataset.field]=Number(select.value);});
 }
 async function inspect(){
  if(!current.file)return;invalidate();lock(true);el('ti-message').textContent='正在读取表格…';
  try{
   const result=await api('/api/import/inspect',body());current.headers=result.headers;current.mapping=result.mapping;
   el('ti-sheet').innerHTML=result.sheets.map((name,i)=>'<option value="'+i+'" '+(i===result.sheet?'selected':'')+'>'+escape(name)+'</option>').join('');
   mappings();el('ti-message').textContent='已读取 '+current.filename+'，共 '+result.total+' 条记录。请核对字段后点击预览。';
   el('ti-samples').innerHTML='<details><summary>查看原表前3条</summary><div class="ti-scroll"><table><thead><tr><th>表格行</th>'+result.headers.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+result.samples.map(r=>'<tr><td>'+r.number+'</td>'+result.headers.map((_,i)=>'<td>'+escape(r.cells[i])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></details>';
  }catch(e){current.headers=[];el('ti-mapping').innerHTML='';el('ti-samples').innerHTML='';error(e.message);el('ti-message').textContent='表格尚未读取成功。';}finally{lock(false);}
 }
 el('ti-close').onclick=()=>{if(!busy)dialog.close();};
 dialog.oncancel=e=>{if(busy)e.preventDefault();};
 el('ti-file').onchange=async e=>{
  invalidate();current.headers=[];const file=e.target.files[0];if(!file){current.file='';return;}
  if(file.size>5*1024*1024){error('文件超过5MB，请拆分表格');current.file='';return;}
  lock(true);
  try{const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));current.file=btoa(binary);current.filename=file.name;el('ti-sheet').innerHTML='<option value="0">第一个工作表</option>';await inspect();}catch(e){error(e.message);}finally{lock(false);}
 };
 el('ti-sheet').onchange=inspect;el('ti-header').onchange=inspect;
 el('ti-kind').onchange=()=>{el('ti-template').href='/api/import/template?kind='+el('ti-kind').value;inspect();};
 el('ti-business').onchange=invalidate;
 el('ti-preview').onclick=async()=>{
  invalidate();lock(true);el('ti-message').textContent='正在核对重复档案及关联信息…';
  try{
   const result=await api('/api/import/preview',body());current.previewId=result.previewId;current.results=result.results;current.summary=result.summary;
   const x=result.summary;el('ti-message').textContent='预览完成：共 '+x.total+' 条，新增 '+x.added+' 条，跳过 '+x.skipped+' 条，错误 '+x.errors+' 条。';
   el('ti-results').innerHTML='<h3>导入预览</h3><p>'+(x.errors?'请先修正错误后重新上传并预览。本批次尚未导入。':x.added?'请核对结果，再点击“确认导入到云端”。预览有效期20分钟。':'没有需要新增的档案，已有数据保持不变。')+'</p><div class="ti-result-list">'+result.results.map(r=>'<article class="'+(r.status==='错误'?'ti-bad':'')+'"><strong>第'+r.row+'行 · '+escape(r.status)+'</strong><span>'+escape(r.name)+'</span><small>'+escape(r.message)+'</small></article>').join('')+'</div>';
   el('ti-error-export').hidden=!x.errors;
  }catch(e){error(e.message);el('ti-message').textContent='尚未导入，请核对后重新预览。';}finally{lock(false);}
 };
 el('ti-commit').onclick=async()=>{
  if(!current.previewId||window.OPC_CLOUD_BUSY)return;
  lock(true);window.OPC_CLOUD_BUSY=true;el('ti-message').textContent='正在保存到云端，请稍候…';error('');
  try{const result=await api('/api/import/commit',{previewId:current.previewId});window.OPC_TABLE_IMPORT_FINISH(result);dialog.close();}
  catch(e){error(e.message);if(/预览|更新|过期/.test(e.message))current.previewId=null;el('ti-message').textContent='保存未确认，请根据提示重试。';}
  finally{window.OPC_CLOUD_BUSY=false;lock(false);}
 };
 el('ti-backup').onclick=()=>{if(window.OPC_CLOUD)window.downloadData('OPC-导入前备份-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({format:'opc.workspace.backup',version:1,exportedAt:new Date().toISOString(),supply:window.OPC_CLOUD.supply,operations:window.OPC_CLOUD.operations},null,2));};
 el('ti-error-export').onclick=()=>{const quote=v=>'"'+String(/^[=+\-@\t\r]/.test(String(v))?"'"+v:v).replaceAll('"','""')+'"';const rows=[['表格行','结果','档案','错误说明'],...current.results.filter(r=>r.status==='错误').map(r=>[r.row,r.status,r.name,r.message])];window.downloadData('OPC-导入错误清单.csv','\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n'),'text/csv;charset=utf-8');};
 dialog.showModal();
};
})();
