
import ExcelJS from 'exceljs';
import {randomUUID} from 'node:crypto';
import {SUPPLY_FIELDS,validateSupply} from './domain.mjs';
export const BUSINESSES=[['BUS-001','3D打印耗材'],['BUS-002','手工DIY'],['BUS-003','代采业务'],['BUS-004','袜子业务']];
const common=[
 ['id','档案编号',false,[],['档案ID']],
 ['businessId','所属业务',false,BUSINESSES.map(b=>b[1]),['业务ID','业务','业务名称']],
 ['country','国家／地区',false,[],['国家地区','国家','地区']],
 ['address','地址',false,[],['生产地址','公司地址','工厂地址']],
 ['contact','联系人',false,[],['联系人员','联系人姓名']],
 ['phone','电话',false,[],['联系方式','联系电话','手机','手机号']],
 ['products','主营／生产范围',false,[],['主营范围','主营产品','主营产品与材料','可生产范围','产品范围']],
 ['status','合作状态',false,['待核实','可合作','暂停','归档'],['状态']],
 ['documents','资料链接',false,[],['文件链接','资料URL']],
 ['notes','备注',false,[],['说明']]
];
export const IMPORT_SCHEMA={
 suppliers:{label:'供应商',fields:[
  ['name','供应商名称',true,[],['名称','公司名称','供应商']],
  ...common,
  ['type','供应商类型',false,['工厂直供','贸易商','代理商','服务商','待核实'],['类型']],
  ['creditCode','统一社会信用代码',false,[],['信用代码','税号']],
  ['messenger','微信／WhatsApp',false,[],['微信或WhatsApp','微信','WhatsApp']],
  ['email','邮箱',false,[],['电子邮箱','Email']],
  ['website','1688／官网',false,[],['1688或官网','官网','官网链接','1688链接','网站']],
  ['currency','结算币种',false,['CNY','USD','EUR','GBP','其他'],['币种']],
  ['paymentTerms','付款条件',false,[],['付款方式','账期']],
  ['verifiedAt','资料核实日期',false,[],['核实日期']]
 ]},
 factories:{label:'工厂',fields:[
  ['name','工厂名称',true,[],['名称','公司名称','工厂']],
  ...common,
  ['process','工艺与设备',false,[],['工艺','设备','工艺设备']],
  ['capacity','产能及单位',false,[],['产能']],
  ['certificates','证书与有效期',false,[],['证书','认证']],
  ['inspection','验厂记录',false,[],['验厂']]
 ]},
 links:{label:'关联关系',fields:[
  ['supplierId','供应商名称或编号',true,[],['供应商','供应商名称','供应商ID','supplier']],
  ['factoryId','工厂名称或编号',true,[],['工厂','工厂名称','工厂ID','factory']],
  common[0],common[1],
  ['type','关系类型',false,[],[]],
  ['status','核实状态',false,['待核实','已核实','已终止'],['状态']],
  ['proof','证明链接',false,[],['关系证明链接']],
  ['startDate','起始日期',false,[],['关系起始日期']],
  ['endDate','终止日期',false,[],['关系终止日期']],
  common[common.length-1]
 ]}
};
const MAX_ROWS=1000,MAX_COLUMNS=60,MAX_FILE=5*1024*1024;
export function importError(message,status=422){return Object.assign(new Error(message),{status});}
const fail=message=>{throw importError(message);};
const norm=v=>String(v||'').normalize('NFKC').replace(/[\s／/()（）_-]/g,'').toLowerCase();
const clone=v=>JSON.parse(JSON.stringify(v));
const identity=v=>String(v||'').replace(/\s+/g,'').toLowerCase();
export function kindSchema(kind){if(!Object.hasOwn(IMPORT_SCHEMA,kind))fail('请选择供应商、工厂或关联关系');return IMPORT_SCHEMA[kind];}
export function parseCSV(text,headerRow=1){
 text=text.replace(/^\uFEFF/,'');
 if(text.includes('\0'))fail('CSV包含无效字符，请另存为UTF-8 CSV');
 const first=(text.split(/\r?\n/)[headerRow-1]||'');let delimiter=',',best=-1;
 for(const d of [',','\t',';']){let count=0,quoted=false;for(let i=0;i<first.length;i++){if(first[i]==='"'){if(quoted&&first[i+1]==='"')i++;else quoted=!quoted;}else if(!quoted&&first[i]===d)count++;}if(count>best){best=count;delimiter=d;}}
 const rows=[];let row=[],cell='',quoted=false,closed=false,line=1,start=1;
 function pushCell(){row.push(cell);if(row.length>MAX_COLUMNS)fail('表格超过60列，请保留需要导入的字段');cell='';closed=false;}
 function pushRow(){pushCell();rows.push({number:start,cells:row});row=[];if(rows.length>MAX_ROWS+100)fail('单次最多导入1000条，请拆分表格');}
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else{cell+=c;if(c==='\n')line++;}}
  else if(c==='"'){if(cell||closed)fail('第'+line+'行CSV引号格式错误');quoted=true;}
  else if(c===delimiter)pushCell();
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow();line++;start=line;}
  else{if(closed&&!/\s/.test(c))fail('第'+line+'行CSV引号后存在多余内容');if(!closed)cell+=c;}
  if(cell.length>8000)fail('第'+line+'行单元格超过8000字');
 }
 if(quoted)fail('CSV存在未闭合的引号');
 if(cell||row.length||closed)pushRow();
 return rows;
}
function checkZip(buffer){
 let end=-1;
 for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--){if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}}
 if(end<0)fail('不是有效的xlsx文件，请重新另存为Excel工作簿');
 const count=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16);
 if(count>300||count===65535||offset===0xffffffff)fail('Excel结构过大，请另存为简化的xlsx文件');
 let p=offset,total=0;
 for(let i=0;i<count;i++){
  if(p+46>buffer.length||buffer.readUInt32LE(p)!==0x02014b50)fail('Excel压缩结构损坏');
  const size=buffer.readUInt32LE(p+24),compressed=buffer.readUInt32LE(p+20),nameLen=buffer.readUInt16LE(p+28);
  if(size===0xffffffff||size>16*1024*1024||(size>1024*1024&&size>Math.max(compressed,1)*250))fail('Excel展开内容过大，请缩小表格');
  total+=size;if(total>24*1024*1024)fail('Excel展开内容超过24MB，请拆分表格');
  if(buffer.readUInt16LE(p+8)&1)fail('请先取消Excel文件密码保护');
  const name=buffer.toString('utf8',p+46,p+46+nameLen);
  if(/vbaProject|externalLinks/i.test(name))fail('请另存为不含宏和外部工作簿链接的xlsx文件');
  p+=46+nameLen+buffer.readUInt16LE(p+30)+buffer.readUInt16LE(p+32);
 }
}
function cellText(cell,row){
 const v=cell.value;
 if(v==null)return '';
 if(v instanceof Date)return v.toISOString().slice(0,10);
 if(typeof v==='object'){
  if(v.formula||v.sharedFormula)fail('第'+row+'行包含公式，请复制并粘贴为值后导入');
  if(v.error)fail('第'+row+'行包含Excel错误值');
  if(v.richText)return v.richText.map(x=>x.text).join('');
  if(Object.hasOwn(v,'text'))return String(v.text);
  fail('第'+row+'行含不支持的单元格内容');
 }
 if(typeof v==='number'&&(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER))fail('第'+row+'行数字精度不足，请将电话、编号等保存为文本后导入');
 const text=String(v);if(text.length>8000)fail('第'+row+'行单元格超过8000字');return text;
}
let parsing=false;
export async function readTable(input){
 if(parsing)throw importError('正在读取另一份表格，请稍后再试',429);
 parsing=true;
 try{
  if(!input||typeof input.filename!=='string'||typeof input.file!=='string')fail('请选择表格文件');
  if(input.file.length>Math.ceil(MAX_FILE/3)*4+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.file))fail('文件无效或超过5MB');
  const buffer=Buffer.from(input.file,'base64');if(!buffer.length||buffer.length>MAX_FILE)fail('文件为空或超过5MB');
  let sheets,rows;
  if(/\.csv$/i.test(input.filename)){
   let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{text=new TextDecoder('gb18030',{fatal:true}).decode(buffer);}
   sheets=['CSV'];rows=parseCSV(text,Number(input.headerRow||1));
  }else if(/\.xlsx$/i.test(input.filename)){
   checkZip(buffer);const book=new ExcelJS.Workbook();
   try{await book.xlsx.load(buffer);}catch{fail('Excel文件读取失败，请另存为xlsx后重试');}
   sheets=book.worksheets.map(s=>s.name);if(!sheets.length||sheets.length>20)fail('工作表数量无效，最多20个工作表');
   const index=input.sheet===undefined?0:Number(input.sheet);if(!Number.isInteger(index)||index<0||index>=sheets.length)fail('请选择有效的工作表');
   const sheet=book.worksheets[index];if(sheet.rowCount>MAX_ROWS+100||sheet.columnCount>MAX_COLUMNS)fail('单个工作表最多1000条、60列，请删除多余空白行列或拆分文件');
   rows=[];sheet.eachRow({includeEmpty:false},r=>{const cells=[];for(let col=1;col<=sheet.columnCount;col++)cells.push(cellText(r.getCell(col),r.number));rows.push({number:r.number,cells});});
  }else fail('支持.xlsx和.csv；旧版.xls请先另存为.xlsx');
  const headerNumber=Number(input.headerRow||1);
  if(!Number.isInteger(headerNumber)||headerNumber<1||headerNumber>20)fail('表头行需为1至20');
  const head=rows.find(r=>r.number===headerNumber);if(!head||head.cells.every(c=>!String(c).trim()))fail('指定表头行为空，请修改表头行号');
  let width=head.cells.length;while(width&&String(head.cells[width-1]).trim()==='')width--;
  if(!width||width>MAX_COLUMNS)fail('表头列数无效');
  const headers=head.cells.slice(0,width).map((c,i)=>String(c).trim()||'未命名列'+(i+1));
  const data=rows.filter(r=>r.number>headerNumber&&r.cells.some(c=>String(c).trim()!==''));
  if(data.length>MAX_ROWS)fail('单次最多导入1000条，请拆分表格');
  for(const r of data)if(r.cells.slice(width).some(c=>String(c).trim()!==''))fail('第'+r.number+'行存在没有表头的数据列，请补全表头');
  return {sheets,sheet:Number(input.sheet||0),headers,rows:data};
 }finally{parsing=false;}
}
export function detectMapping(headers,kind){
 const mapping={};for(const [key,label,,,aliases] of kindSchema(kind).fields){
  const names=[key,label,...aliases,...(key==='id'?[{suppliers:'供应商ID',factories:'工厂ID',links:'关系ID'}[kind]]:[])].map(norm),matches=headers.map((h,i)=>names.includes(norm(h))?i:-1).filter(i=>i>=0);
  if(matches.length===1)mapping[key]=matches[0];
 }return mapping;
}
function business(value,fallback){
 const v=String(value||fallback||'').trim();
 const b=BUSINESSES.find(x=>x[0]===v||norm(x[1])===norm(v));
 if(!b)fail('请填写所属业务，或在导入窗口选择默认业务');return b[0];
}
function dateCheck(key,value){if(!value)return;const s=value.replaceAll('/','-');if(!/^\d{4}-\d{1,2}-\d{1,2}$/.test(s))fail(key+'请使用YYYY-MM-DD格式');const [y,m,d]=s.split('-').map(Number);const t=new Date(Date.UTC(y,m-1,d));if(t.getUTCFullYear()!==y||t.getUTCMonth()!==m-1||t.getUTCDate()!==d)fail(key+'不是有效日期');return [y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');}
export function prepareTableImport(before,table,input,{now=new Date().toISOString(),idFactory=p=>p+'-'+randomUUID()}={}){
 const kind=input.kind,def=kindSchema(kind),mapping=input.mapping;
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))fail('请核对字段对应关系');
 const valid=new Set(def.fields.map(f=>f[0])),used=new Set();
 for(const [key,index] of Object.entries(mapping)){if(!valid.has(key)||!Number.isInteger(index)||index<0||index>=table.headers.length)fail('字段对应关系无效');if(used.has(index))fail('同一表格列不能对应多个字段');used.add(index);}
 for(const [key,label,required] of def.fields)if(required&&!Object.hasOwn(mapping,key))fail('请为“'+label+'”选择表格列');
 const work=validateSupply(before),results=[],records=[];let skipped=0;
 for(const row of table.rows){
  try{
   const values={};
   for(const [key,index] of Object.entries(mapping)){const v=String(row.cells[index]??'').trim();if(v)values[key]=v;}
   for(const [key,label,required,options] of def.fields){if(required&&!values[key])fail(label+'不能为空');if(values[key]&&options.length&&key!=='businessId'&&!options.includes(values[key]))fail(label+'应为：'+options.join('、'));}
   const biz=business(values.businessId,input.businessId);if(kind!=='links')values.businessId=biz;else delete values.businessId;
   for(const key of ['verifiedAt','startDate','endDate'])if(values[key])values[key]=dateCheck(key,values[key]);
   if(values.startDate&&values.endDate&&values.startDate>values.endDate)fail('终止日期不能早于起始日期');
   if(values.email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email))fail('邮箱格式无效');
   if(kind==='links'){
    for(const [field,party] of [['supplierId','suppliers'],['factoryId','factories']]){
     const matches=work[party].filter(r=>r.businessId===biz&&(r.id===values[field]||identity(r.name)===identity(values[field])));
     if(matches.length!==1)fail((party==='suppliers'?'供应商':'工厂')+'“'+values[field]+'”在所选业务中不存在或不唯一，请先导入档案');values[field]=matches[0].id;
    }
   }
   const prefix={suppliers:'SUP',factories:'FAC',links:'SFR'}[kind];
   if(values.id&&!new RegExp('^'+prefix+'-[A-Za-z0-9_-]{3,80}$').test(values.id))fail('档案编号需使用系统'+prefix+'-编号；自有编号可先对应到备注');
   const matches=work[kind].filter(r=>(values.id&&r.id===values.id)||(kind==='links'?r.supplierId===values.supplierId&&r.factoryId===values.factoryId:r.businessId===biz&&(identity(r.name)===identity(values.name)||(kind==='suppliers'&&values.creditCode&&identity(r.creditCode)===identity(values.creditCode)))));
   if(matches.length>1)fail('编号、名称或信用代码指向不同档案，请核对');
   if(matches.length){
    const old=matches[0];
    const differs=Object.entries(values).filter(([k,v])=>!((k==='name'||k==='creditCode')?identity(old[k])===identity(v):old[k]===v)).map(([k])=>def.fields.find(f=>f[0]===k)?.[1]||k);
    if(differs.length)fail('与已有档案冲突：'+differs.join('、')+'。请编辑原档案或修正表格');
    skipped++;results.push({row:row.number,status:'跳过',name:values.name||values.supplierId+' → '+values.factoryId,message:'内容相同，保留已有档案',id:old.id});continue;
   }
   const record=Object.fromEntries(SUPPLY_FIELDS[kind].map(key=>[key,values[key]||'']));
   record.id=values.id||idFactory(prefix);record.createdAt=now;record.updatedAt=now;record.status=values.status||'待核实';if(kind==='suppliers')record.type=values.type||'待核实';
   const candidate=clone(work);candidate[kind].push(record);validateSupply(candidate);work[kind].push(record);records.push(record);
   results.push({row:row.number,status:'新增',name:values.name||values.supplierId+' → '+values.factoryId,message:'确认后保存',id:record.id});
  }catch(e){results.push({row:row.number,status:'错误',name:String(row.cells[mapping.name]||''),message:e.message});}
 }
 const errors=results.filter(r=>r.status==='错误').length;
 const log={id:idFactory('LOG'),at:now,action:'表格导入',kind,entityId:'batch',detail:'文件 '+String(input.filename||'').slice(0,180)+'；新增 '+records.length+' 条；跳过 '+skipped+' 条'};
 return {kind,records,log,results,summary:{total:table.rows.length,added:records.length,skipped,errors},canCommit:!errors&&records.length>0};
}
export async function templateWorkbook(kind){
 const def=kindSchema(kind),book=new ExcelJS.Workbook(),sheet=book.addWorksheet(def.label);
 sheet.columns=def.fields.map(f=>({header:f[1],key:f[0],width:f[0]==='notes'?40:24,style:{numFmt:'@'}}));
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF173436'}};sheet.views=[{state:'frozen',ySplit:1}];
 for(let c=0;c<def.fields.length;c++){const f=def.fields[c];if(f[3].length)for(let row=2;row<=101;row++)sheet.getCell(row,c+1).dataValidation={type:'list',allowBlank:true,formulae:['"'+f[3].join(',')+'"']};}
 const help=book.addWorksheet('填写说明');help.columns=[{header:'字段',width:28},{header:'填写要求',width:90}];
 help.addRow(['使用顺序','先导入供应商，再导入工厂，最后按名称或编号建立关联关系。']);
 help.addRow(['导入方式','第一行是表头；上传后选择数据工作表，核对字段、业务及预览结果。']);
 help.addRow(['重复与冲突','相同档案跳过；内容冲突需修正后重新预览，不覆盖已有档案。']);
 help.addRow(['文本格式','电话、编号等保持文本格式；不要使用公式。资料链接填写完整https网址。']);
 for(const f of def.fields)help.addRow([f[1],(f[2]?'必填':'可留空')+(f[0]==='businessId'?'；可在导入窗口指定默认业务':'')+(f[3].length?'；可选：'+f[3].join('、'):'')]);
 return Buffer.from(await book.xlsx.writeBuffer());
}
