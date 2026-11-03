// OPC v0.3 portable domain rules. Prepared for cloud migration; hosting/auth not implemented here.
// Sources: verified v0.3 HTML; no real user records are included.
const SUPPLY_KEY="opc.supply.v1";
const SUPPLY_FIELDS={
suppliers:["id","businessId","name","type","creditCode","country","address","contact","phone","messenger","email","website","products","currency","paymentTerms","status","verifiedAt","documents","notes","createdAt","updatedAt"],
factories:["id","businessId","name","country","address","contact","phone","process","capacity","products","certificates","inspection","status","documents","notes","createdAt","updatedAt"],
links:["id","supplierId","factoryId","type","status","proof","startDate","endDate","notes","createdAt","updatedAt"]
};
const BUSINESS_IDS=["BUS-001","BUS-002","BUS-003","BUS-004"];
const PARTY_STATUSES=["待核实","可合作","暂停","归档"];
const SUPPLIER_TYPES=["工厂直供","贸易商","代理商","服务商","待核实"];
const LINK_STATUSES=["待核实","已核实","已终止"];
function emptySupply(){return {schemaVersion:1,revision:0,suppliers:[],factories:[],links:[],logs:[]};}
function normalizeName(v){return String(v||"").replace(/\s+/g,"").toLowerCase();}
function cloneSupply(v){return JSON.parse(JSON.stringify(v));}
function checkURL(v){if(!v)return true;try{const u=new URL(v);return (u.protocol==="https:"||u.protocol==="http:")&&!!u.hostname;}catch(e){return /^https?:\/\/[^\s/]+(?:[/?#][^\s]*)?$/.test(v);}}
function validateSupply(input){
 if(!input||input.schemaVersion!==1||!Number.isInteger(input.revision)||input.revision<0)throw Error("备份版本或修订号无效。");
 const db=emptySupply();db.revision=input.revision;
 ["suppliers","factories","links"].forEach(function(kind){
  if(!Array.isArray(input[kind])||input[kind].length>10000)throw Error("档案格式错误或数量超过10000条。");
  const ids=new Set();
  db[kind]=input[kind].map(function(raw){
   if(!raw||typeof raw!=="object")throw Error("档案格式错误。");
   const out={};SUPPLY_FIELDS[kind].forEach(function(key){if(typeof raw[key]!=="string"&&raw[key]!==undefined)throw Error("字段必须为文本："+key);out[key]=String(raw[key]||"").trim();if(out[key].length>8000)throw Error("字段内容过长："+key);});
   if(!/^(SUP|FAC|SFR)-[A-Za-z0-9_-]{3,80}$/.test(out.id)||!out.id.startsWith({suppliers:"SUP-",factories:"FAC-",links:"SFR-"}[kind])||ids.has(out.id))throw Error("档案编号缺失、重复或格式错误。");
   ids.add(out.id);
   if(kind!=="links"){
    if(!out.name||!BUSINESS_IDS.includes(out.businessId)||!PARTY_STATUSES.includes(out.status))throw Error("名称、所属业务或合作状态无效。");
    if(kind==="suppliers"&&!SUPPLIER_TYPES.includes(out.type))throw Error("供应商类型无效。");
    if(out.website&&!checkURL(out.website))throw Error("官网地址需以http://或https://开头。");
    if(out.documents&&out.documents.split(/\r?\n/).filter(Boolean).some(function(u){return !checkURL(u.trim());}))throw Error("资料链接请每行填写一个完整的http或https地址。");
   }else if(!LINK_STATUSES.includes(out.status)||(out.proof&&!checkURL(out.proof)))throw Error("关系状态或证明链接无效。");
   return out;
  });
  if(kind!=="links"){
   const names=new Set(),credits=new Set();
   db[kind].forEach(function(r){
    const nameKey=r.businessId+"|"+normalizeName(r.name);
    if(names.has(nameKey))throw Error("同一业务内存在同名档案："+r.name);
    names.add(nameKey);
    if(kind==="suppliers"&&r.creditCode){const key=r.businessId+"|"+normalizeName(r.creditCode);if(credits.has(key))throw Error("同一业务内信用代码重复。");credits.add(key);}
   });
  }
 });
 const pairs=new Set();
 db.links.forEach(function(r){
  const s=db.suppliers.find(function(x){return x.id===r.supplierId}),f=db.factories.find(function(x){return x.id===r.factoryId});
  if(!s||!f)throw Error("供应商或工厂不存在，无法建立关系。");
  if(s.businessId!==f.businessId)throw Error("供应商与工厂的所属业务不一致。");
  const pair=r.supplierId+"|"+r.factoryId;if(pairs.has(pair))throw Error("供应商与工厂的关系已存在，请编辑原记录。");pairs.add(pair);
 });
 if(!Array.isArray(input.logs)||input.logs.length>50000)throw Error("操作日志格式无效或超过50000条。");
 db.logs=input.logs.map(function(r){if(!r||typeof r!=="object")throw Error("日志格式错误。");const o={};["id","at","action","kind","entityId","detail"].forEach(function(k){o[k]=String(r[k]||"").slice(0,20000);});return o;});
 return db;
}
function filterParties(db,kind,business,query,status){
 const q=String(query||"").toLowerCase();
 return db[kind].filter(function(r){return (business==="all"||r.businessId===business)&&(!status||r.status===status)&&(!q||[r.id,r.name,r.contact,r.phone,r.messenger,r.products,r.address].join(" ").toLowerCase().includes(q));});
}
function prepareSupplyChange(db,kind,record,now,idFactory){
 if(!SUPPLY_FIELDS[kind])throw Error("未知档案类型。");
 const next=cloneSupply(db),existing=record.id?next[kind].find(function(r){return r.id===record.id}):null;
 if(record.id&&!existing)throw Error("档案不存在，请刷新页面。");
 const result={};
 SUPPLY_FIELDS[kind].forEach(function(key){result[key]=String(record[key]||"").trim();});
 result.id=existing?existing.id:idFactory({suppliers:"SUP",factories:"FAC",links:"SFR"}[kind]);
 result.createdAt=existing?existing.createdAt:now;result.updatedAt=now;
 if(existing)next[kind][next[kind].indexOf(existing)]=result;else next[kind].push(result);
 next.revision=db.revision+1;
 next.logs.push({id:idFactory("LOG"),at:now,action:existing?"更新":"新增",kind:kind,entityId:result.id,detail:JSON.stringify({before:existing||null,after:result})});
 return validateSupply(next);
}
function persistSupply(storage,db,next){
 const current=storage.getItem(SUPPLY_KEY);
 const currentRevision=current?validateSupply(JSON.parse(current)).revision:0;
 if(currentRevision!==db.revision)throw Error("另一个窗口已更新档案，请先刷新页面再修改。");
 storage.setItem(SUPPLY_KEY,JSON.stringify(next));
 return next;
}
function csvValue(v){v=String(v||"");if(/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
function supplyCSV(db,kind){
 const heads={
 suppliers:["供应商ID","供应商名称","类型","业务ID","统一社会信用代码","国家地区","地址","联系人","电话","微信或WhatsApp","邮箱","1688或官网","主营范围","结算币种","付款条件","合作状态","资料链接","资料核实日期","备注"],
 factories:["工厂ID","工厂名称","业务ID","国家地区","生产地址","联系人","联系方式","工艺与设备","产能及单位","可生产范围","证书与有效期","验厂记录","资料链接","合作状态","更新日期","备注"],
 links:["关系ID","供应商ID","工厂ID","关系类型","核实状态","证明链接","起始日期","终止日期","备注"]
 };
 const keys={
 suppliers:["id","name","type","businessId","creditCode","country","address","contact","phone","messenger","email","website","products","currency","paymentTerms","status","documents","verifiedAt","notes"],
 factories:["id","name","businessId","country","address","contact","phone","process","capacity","products","certificates","inspection","documents","status","updatedAt","notes"],
 links:["id","supplierId","factoryId","type","status","proof","startDate","endDate","notes"]
 };
 return "\uFEFF"+[heads[kind],...db[kind].map(function(r){return keys[kind].map(function(k){return r[k]||"";});})].map(function(row){return row.map(csvValue).join(",");}).join("\r\n");
}








function prepareSupplyImport(db,incoming,now,idFactory){
 incoming=validateSupply(incoming);
 let added=0;const candidate=cloneSupply(db);
 ["suppliers","factories","links"].forEach(function(kind){
  incoming[kind].forEach(function(r){
   const exists=candidate[kind].find(function(x){return x.id===r.id;});
   if(exists){if(JSON.stringify(exists)!==JSON.stringify(r))throw Error("相同编号存在内容冲突："+r.id+"。本次未导入任何记录。");}
   else{candidate[kind].push(r);added++;}
  });
 });
 const known=new Set(candidate.logs.map(function(l){return l.id;}));
 incoming.logs.forEach(function(l){if(!known.has(l.id)){candidate.logs.push(l);known.add(l.id);}});
 candidate.revision=db.revision+1;
 candidate.logs.push({id:idFactory("LOG"),at:now,action:"导入备份",kind:"system",entityId:"backup",detail:"新增档案 "+added+" 条；不覆盖已有编号。"});
 return {data:validateSupply(candidate),added:added};
}


















const OPS_SPEC={"tables":{"products":{"code":"PRD","label":"产品档案","module":"A02","fields":[["name","产品名称","text",true],["businessId","所属业务","business",true],["brand","品牌","text"],["model","型号","text",true],["material","材料／品类","text"],["parameterURL","正式参数资料链接","url"],["parameterStatus","参数核实","select",true,["待提供","待核实","已核实"]],["status","状态","select",true,["在用","暂停","归档"]],["notes","备注","textarea",false]]},"skus":{"code":"SKU","label":"SKU规格","module":"A02","fields":[["name","规格名称","text",true],["businessId","所属业务","business",true],["productId","产品","ref:products",true],["color","颜色／色号","text"],["size","尺寸／线径","text"],["weight","净重说明","text"],["unit","单位","select",true,["kg","卷","件","个","包","双","套"]],["barcode","条码","text"],["status","状态","select",true,["在用","暂停","归档"]],["notes","备注","textarea",false]]},"offers":{"code":"SRC","label":"供货关系与成本","module":"A02","fields":[["businessId","所属业务","business",true],["skuId","SKU规格","ref:skus",true],["supplierId","供应商","ref:suppliers",true],["factoryId","工厂","ref:factories"],["unitPrice","单价","number",true],["currency","币种","select",true,["CNY","USD","EUR","GBP","其他"]],["unit","单位","select",true,["kg","卷","件","个","包","双","套"]],["moq","起订量","number"],["leadTime","交期说明","text"],["terms","贸易条款","text"],["validUntil","有效截至","date"],["sourceURL","报价依据链接","url"],["status","核实状态","select",true,["待核实","已核实","失效"]],["notes","备注","textarea",false]]},"salesPrices":{"code":"QTE","label":"销售参考价","module":"A02","fields":[["businessId","所属业务","business",true],["productId","产品","ref:products",true],["currency","币种","select",true,["CNY","USD","EUR","GBP","其他"]],["unit","单位","select",true,["kg","卷","件","个","包","双","套"]],["minQty","数量下限（含）","number",true],["maxQty","数量上限（不含；空为无限）","number"],["unitPrice","单价","number",true],["terms","贸易条款","text"],["validUntil","有效截至","date"],["sourceURL","来源链接","url"],["status","确认状态","select",true,["参考／使用前确认","已核实","失效"]],["notes","备注","textarea",false]]},"purchases":{"code":"PUR","label":"采购明细","module":"A03","fields":[["documentNo","采购单号（同单多行可复用）","text"],["businessId","所属业务","business",true],["supplierId","供应商","ref:suppliers",true],["factoryId","工厂","ref:factories"],["skuId","SKU规格","ref:skus",true],["quantity","数量","number",true],["unit","单位","select",true,["kg","卷","件","个","包","双","套"]],["unitPrice","单价","number",true],["currency","币种","select",true,["CNY","USD","EUR","GBP","其他"]],["warehouseId","收货仓库","ref:warehouses",true],["expectedDate","预计到货日","date"],["status","采购进度","select",true,["草稿","已下单","取消"]],["sourceURL","采购凭证链接","url"],["notes","备注","textarea",false]]},"warehouses":{"code":"WH","label":"仓库档案","module":"A04","fields":[["name","仓库名称","text",true],["businessId","所属业务","business",true],["country","国家／地区","text"],["address","地址","text"],["contact","联系人","text"],["phone","电话","tel"],["status","状态","select",true,["在用","暂停","归档"]],["notes","备注","textarea",false]]},"movements":{"code":"MOV","label":"出入库流水","module":"A04","fields":[["businessId","所属业务","business",true],["skuId","SKU规格","ref:skus",true],["warehouseId","仓库","ref:warehouses",true],["action","动作","select",true,["期初入库","采购入库","销售出库","退货入库","采购退货","盘盈","盘亏","调拨入库","调拨出库","冲销"]],["quantity","数量","number",true],["unit","单位","select",true,["kg","卷","件","个","包","双","套"]],["sourceId","关联明细编号（收发货时自动带入）","text"],["supplierId","来源供应商","ref:suppliers"],["factoryId","来源工厂","ref:factories"],["batch","批次号","text"],["status","审核状态","select",true,["草稿","已审核","作废"]],["reversalOf","冲销原流水编号","text"],["transferId","调拨关联编号","text"],["sourceURL","凭证链接","url"],["notes","备注","textarea",false]]},"assets":{"code":"AST","label":"资料与素材","module":"A05","fields":[["name","资料标题","text",true],["businessId","所属业务","business",true],["productId","关联产品","ref:products"],["kind","资料类型","select",true,["产品图片","原始视频","剪辑成片","封面","参数资料","授权证明","其他"]],["url","云盘或文件链接","url",true],["authorization","使用授权","select",true,["待确认","允许推广","自有素材","禁用"]],["status","核实状态","select",true,["待核实","已核实","禁用"]],["notes","备注","textarea",false]]},"content":{"code":"CNT","label":"内容发布","module":"A05","fields":[["name","内容主题","text",true],["businessId","所属业务","business",true],["skuId","关联SKU","ref:skus"],["assetId","主要素材","ref:assets"],["platform","发布平台","select",true,["Facebook","Instagram","淘宝","Shopify","其他"]],["language","内容语言","select",true,["英语","中文","其他"]],["coverText","封面文字","text"],["caption","发布文案","textarea"],["tags","标签","text"],["plannedDate","计划日期","date"],["status","制作进度","select",true,["待素材","待制作","待审核","待发布","已发布","暂停"]],["publishURL","发布链接","url"],["views","播放量","number"],["inquiries","询盘数","number"],["notes","备注","textarea",false]]},"channels":{"code":"CHN","label":"渠道与店铺","module":"A06","fields":[["name","店铺／账号名称","text",true],["businessId","所属业务","business",true],["platform","渠道","select",true,["淘宝","Shopify","独立站","Facebook","Instagram","WhatsApp","其他"]],["url","店铺或主页链接","url"],["market","目标市场","text"],["checkStatus","购买路径检查","select",true,["待检查","检查通过","需修复"]],["checkedDate","检查日期","date"],["status","状态","select",true,["在用","暂停","归档"]],["notes","备注","textarea",false]]},"listings":{"code":"LST","label":"上架与优化","module":"A06","fields":[["name","商品页面任务","text",true],["businessId","所属业务","business",true],["channelId","渠道","ref:channels",true],["skuId","SKU规格","ref:skus",true],["unitPrice","单价","number",true],["currency","币种","select",true,["CNY","USD","EUR","GBP","其他"]],["url","商品链接","url"],["status","进度","select",true,["准备中","待审核","已上架","优化中","已下架"]],["nextAction","下一步","textarea"],["notes","备注","textarea",false]]},"customers":{"code":"CUS","label":"客户档案","module":"A07","fields":[["name","客户名称","text",true],["businessId","所属业务","business",true],["country","国家／地区","text"],["channel","来源渠道","select",true,["淘宝","Shopify","独立站","WhatsApp","其他"]],["contact","联系人","text"],["phone","电话／WhatsApp","text"],["email","邮箱","email"],["customerType","客户类型","select",true,["个人买家","打印农场","经销商","企业客户","其他"]],["nextDate","下次跟进日","date"],["status","状态","select",true,["在用","暂停","归档"]],["notes","备注","textarea",false]]},"leads":{"code":"LEA","label":"询盘跟进","module":"A07","fields":[["name","需求主题","text",true],["businessId","所属业务","business",true],["customerId","客户","ref:customers",true],["skuId","意向SKU","ref:skus"],["quantity","需求数量","number"],["unit","单位","select",false,["","kg","卷","件","个","包","双","套"]],["requirements","需求原文／要点","textarea"],["country","交付国家","text"],["nextDate","下次跟进日","date"],["status","询盘阶段","select",true,["新询盘","需求确认","待报价","已报价","跟进中","已成交","未成交"]],["notes","备注","textarea",false]]},"quotes":{"code":"OFR","label":"对客报价明细","module":"A07","fields":[["documentNo","报价单号（同单多行可复用）","text"],["businessId","所属业务","business",true],["customerId","客户","ref:customers",true],["leadId","关联询盘","ref:leads"],["skuId","SKU规格","ref:skus",true],["quantity","数量","number",true],["unit","单位","select",true,["kg","卷","件","个","包","双","套"]],["unitPrice","单价","number",true],["currency","币种","select",true,["CNY","USD","EUR","GBP","其他"]],["freight","本行分摊运费（未知留空）","number"],["terms","贸易条款","text"],["destination","交付地点","text"],["paymentTerms","付款条件","text"],["leadTime","交期说明","text"],["validUntil","有效截至","date"],["status","报价状态","select",true,["草稿","待确认","已发送","已接受","已失效"]],["notes","备注","textarea",false]]},"orders":{"code":"ORD","label":"销售订单明细","module":"A08","fields":[["documentNo","订单号（同单多行可复用）","text"],["orderDate","订单日期","date",true],["businessId","所属业务","business",true],["channel","成交渠道","select",true,["淘宝","Shopify","独立站","WhatsApp","其他"]],["customerId","客户（平台订单可后补）","ref:customers"],["quoteId","来源报价明细","ref:quotes"],["skuId","SKU规格","ref:skus",true],["quantity","数量","number",true],["unit","单位","select",true,["kg","卷","件","个","包","双","套"]],["unitPrice","单价","number",true],["currency","币种","select",true,["CNY","USD","EUR","GBP","其他"]],["warehouseId","发货仓库","ref:warehouses",true],["paymentStatus","收款状态","select",true,["未收款","部分收款","已收款","赊销","部分退款","已退款"]],["tracking","物流单号","text"],["status","履约状态","select",true,["正常","已交付","取消"]],["sourceURL","订单凭证链接","url"],["notes","备注","textarea",false]]},"returns":{"code":"RET","label":"售后工单","module":"A09","fields":[["name","售后主题","text",true],["businessId","所属业务","business",true],["orderId","原订单明细","ref:orders",true],["kind","问题类型","select",true,["退货退款","仅退款","换货","质量／使用问题","其他"]],["quantity","退货数量（仅退款可为0）","number",true],["reason","问题及证据说明","textarea",true],["refundAmount","拟退款金额","number"],["currency","币种","select",true,["CNY","USD","EUR","GBP","其他"]],["warehouseId","退回仓库","ref:warehouses"],["status","处理进度","select",true,["待处理","处理中","待退货","待退款","已完成","关闭"]],["sourceURL","证据链接","url"],["notes","备注","textarea",false]]},"payments":{"code":"PAY","label":"收支流水","module":"A10","fields":[["name","收支事项","text",true],["businessId","所属业务","business",true],["date","发生日期","date",true],["direction","收／支","select",true,["收","支"]],["category","收支类别","select",true,["销售收款","采购付款","客户退款","运费","推广费","平台费用","包装","其他"]],["amount","原币金额","number",true],["currency","币种","select",true,["CNY","USD","EUR","GBP","其他"]],["fx","人民币汇率（CNY填1）","number",true],["sourceId","关联业务单据编号","text"],["receiptRef","支付流水号（有则填写）","text"],["status","确认状态","select",true,["待核实","已确认","作废"]],["sourceURL","凭证链接","url"],["notes","备注","textarea",false]]},"tasks":{"code":"TSK","label":"任务与行动","module":"A00","fields":[["name","任务名称","text",true],["businessId","所属业务","business",true],["module","负责板块","select",true,["A00","A01","A02","A03","A04","A05","A06","A07","A08","A09","A10","A11"]],["priority","优先级","select",true,["P0","P1","P2"]],["owner","负责人","text"],["dueDate","截止日期","date"],["nextAction","下一步","textarea"],["status","任务状态","select",true,["待办","进行中","待验证","受阻","已完成","取消"]],["outputURL","产出链接","url"],["notes","备注","textarea",false]]},"metrics":{"code":"MET","label":"经营指标","module":"A11","fields":[["name","指标名称","select",true,["访客数","支付买家数","支付订单数","支付件数","支付金额","退款金额","播放量","询盘数","推广花费","其他"]],["businessId","所属业务","business",true],["channel","渠道","select",true,["淘宝","Shopify","独立站","WhatsApp","Facebook","Instagram","其他"]],["startDate","开始日期","date",true],["endDate","结束日期","date",true],["value","数值","number",true],["unit","指标单位","text",true],["definition","统计口径","textarea",true],["source","来源说明或链接","textarea",true],["status","核实状态","select",true,["待核实","已核实"]],["notes","备注","textarea",false]]}},"map":{"A00":["tasks"],"A02":["products","skus","offers","salesPrices"],"A03":["purchases","offers"],"A04":["balance","movements","warehouses"],"A05":["content","assets"],"A06":["channels","listings"],"A07":["customers","leads","quotes"],"A08":["orders"],"A09":["returns","customers"],"A10":["payments"],"A11":["summary","metrics","tasks"]},"seedProducts":[],"seedPrices":[]};




const OPS_KEY="opc.operations.v1";
function opsEmpty(seed){const d={version:1,revision:0,logs:[]};Object.keys(OPS_SPEC.tables).forEach(function(k){d[k]=[];});if(seed){d.products=cloneSupply(OPS_SPEC.seedProducts);d.salesPrices=cloneSupply(OPS_SPEC.seedPrices);}return d;}
function opsFind(d,s,kind,id){return (kind==="suppliers"||kind==="factories"?s[kind]:d[kind]||[]).find(function(r){return r.id===id;});}
function opsLabel(r){return r?r.name||r.documentNo||r.id:"未找到";}
function opsOriginal(d,m){return m.action==="冲销"?d.movements.find(function(x){return x.id===m.reversalOf;}):m;}
function opsMoveSign(d,m){if(m.status!=="已审核")return 0;const base=opsOriginal(d,m);if(!base)throw Error("冲销原流水不存在");const sign=["期初入库","采购入库","退货入库","盘盈","调拨入库"].includes(base.action)?1:-1;return sign*(m.action==="冲销"?-1:1);}
function opsBalance(d,sku,wh){return d.movements.reduce(function(n,m){return n+(m.skuId===sku&&m.warehouseId===wh?opsMoveSign(d,m)*m.quantity:0);},0);}
function opsSourceQty(d,source,action){
return d.movements.reduce(function(n,m){if(m.status!=="已审核")return n;const base=opsOriginal(d,m);if(base.sourceId!==source||base.action!==action)return n;return n+m.quantity*(m.action==="冲销"?-1:1);},0);
}
function opsShipped(d,id){return opsSourceQty(d,id,"销售出库");}
function opsReceived(d,id){return opsSourceQty(d,id,"采购入库")-opsSourceQty(d,id,"采购退货");}
function opsReturned(d,id){return opsSourceQty(d,id,"退货入库");}
function opsLineTotal(r){return Number(r.quantity||0)*Number(r.unitPrice||0);}
function opsCash(d,business){return d.payments.filter(function(r){return r.status==="已确认"&&(business==="all"||r.businessId===business);}).reduce(function(n,r){return n+(r.direction==="收"?1:-1)*r.amount*r.fx;},0);}
function opsPaidOrders(d,business,channel){
const groups={};d.orders.filter(function(r){return (business==="all"||r.businessId===business)&&(!channel||r.channel===channel);}).forEach(function(r){const key=r.businessId+"|"+r.channel+"|"+r.documentNo;(groups[key]||(groups[key]=[])).push(r);});
return Object.values(groups).filter(function(rows){return rows.every(function(r){return r.status!=="取消"&&r.paymentStatus==="已收款";});}).length;
}
function opsValidate(input,supply){
 if(!input||input.version!==1||!Number.isInteger(input.revision)||input.revision<0)throw Error("业务备份版本或修订号错误");
 const d=opsEmpty(false);d.revision=input.revision;
 Object.entries(OPS_SPEC.tables).forEach(function(entry){
 const kind=entry[0],def=entry[1],ids=new Set();
 if(!Array.isArray(input[kind])||input[kind].length>15000)throw Error(def.label+"格式错误或超过15000条");
 d[kind]=input[kind].map(function(raw){
  if(!raw||typeof raw!=="object")throw Error("记录格式错误");
  const r={};["id","createdAt","updatedAt","postedAt"].forEach(function(k){r[k]=String(raw[k]||"");});
  if(!r.id.startsWith(def.code+"-")||!/^[A-Za-z0-9_-]{5,100}$/.test(r.id)||ids.has(r.id))throw Error(def.label+"编号重复或无效");ids.add(r.id);
  def.fields.forEach(function(f){const key=f[0],value=raw[key];if(f[2]==="number"){r[key]=value===""||value==null?"":Number(value);if(r[key]!==""&&!Number.isFinite(r[key]))throw Error(f[1]+"必须为数字");}else{if(value!=null&&typeof value!=="string")throw Error(f[1]+"必须为文本");r[key]=String(value||"").trim();if(r[key].length>10000)throw Error(f[1]+"内容过长");}
  if(f[3]&&(r[key]===""||r[key]==null))throw Error(def.label+"缺少："+f[1]);
  if(r[key]!==""&&f[2]==="select"&&!f[4].includes(r[key]))throw Error(f[1]+"选项无效");
  if(r[key]&&f[2]==="url"&&!checkURL(r[key]))throw Error(f[1]+"链接无效");
  if(r[key]&&f[2]==="date"&&(!/^\d{4}-\d{2}-\d{2}$/.test(r[key])||(Number.isNaN(new Date(r[key]+"T00:00:00Z").getTime())||new Date(r[key]+"T00:00:00Z").toISOString().slice(0,10)!==r[key])))throw Error(f[1]+"日期无效");
  if(f[2]==="number"&&r[key]!==""&&r[key]<0)throw Error(f[1]+"不能为负数");
  });
  if(!BUSINESS_IDS.includes(r.businessId))throw Error("所属业务无效");
  return r;
 });
 });
 Object.entries(OPS_SPEC.tables).forEach(function(entry){
 const kind=entry[0],def=entry[1];
 d[kind].forEach(function(r){
 def.fields.filter(function(f){return f[2].startsWith("ref:")&&r[f[0]];}).forEach(function(f){
 const t=f[2].slice(4),other=opsFind(d,supply,t,r[f[0]]);
 if(!other)throw Error(def.label+"引用的"+f[1]+"不存在");
 if(other.businessId!==r.businessId)throw Error(def.label+"与"+f[1]+"所属业务不一致");
 });
 if(r.skuId&&r.unit){const sku=opsFind(d,supply,"skus",r.skuId);if(sku.unit!==r.unit)throw Error(def.label+"单位须与SKU基础单位一致，不自动换算");}
 if(["purchases","orders","quotes","movements"].includes(kind)&&!(r.quantity>0))throw Error("数量必须大于0");
 if(kind==="products"&&r.parameterStatus==="已核实"&&!r.parameterURL)throw Error("已核实参数必须提供来源链接");
 if(kind==="offers"&&r.factoryId&&!supply.links.some(function(l){return l.supplierId===r.supplierId&&l.factoryId===r.factoryId&&l.status!=="已终止";}))throw Error("供货工厂须先与供应商建立有效关系");
 if(kind==="salesPrices"&&r.maxQty!==""&&r.maxQty<=r.minQty)throw Error("价格数量上限须大于下限");
 if(["purchases","quotes","orders"].includes(kind)&&!r.documentNo)throw Error("单据号不能为空");
 if(kind==="assets"&&r.status==="已核实"&&r.authorization==="禁用")throw Error("禁用素材不能标为已核实");
 if(kind==="content"&&r.status==="已发布"&&!r.publishURL)throw Error("已发布内容需要填写发布链接");
 if(kind==="content"&&r.assetId&&r.status==="已发布"){
 const a=opsFind(d,supply,"assets",r.assetId);
 if(a.status==="禁用"||!["允许推广","自有素材"].includes(a.authorization))throw Error("发布素材授权尚未确认或已禁用");
 }
 if(kind==="payments"){
 if(!(r.amount>0)||!(r.fx>0))throw Error("收支金额与汇率必须大于0");
 if(r.currency==="CNY"&&r.fx!==1)throw Error("人民币收支的人民币汇率必须为1");
 }
 if(kind==="metrics"&&r.startDate>r.endDate)throw Error("指标结束日期不能早于开始日期");
 });
 });
 ["products","skus","warehouses","customers","channels"].forEach(function(kind){
 const seen=new Set();d[kind].forEach(function(r){const key=r.businessId+"|"+normalizeName(kind==="products"?r.model:r.name);if(seen.has(key))throw Error(OPS_SPEC.tables[kind].label+"存在同业务重名或重复型号");seen.add(key);});
 });
 const refs=new Set();d.payments.filter(function(r){return r.receiptRef&&r.status!=="作废";}).forEach(function(r){const key=r.businessId+"|"+r.direction+"|"+r.currency+"|"+r.receiptRef;if(refs.has(key))throw Error("同业务支付流水号重复");refs.add(key);});
 const reversed=new Set(),transfers={};
 d.movements.forEach(function(m){
 if(m.status!=="已审核")return;
 if(!m.postedAt||Number.isNaN(new Date(m.postedAt).getTime()))throw Error("已审核流水缺少有效入账时间");
 if(m.action==="冲销"){
 const original=d.movements.find(function(x){return x.id===m.reversalOf;});
 if(!original||original.action==="冲销"||original.status!=="已审核"||["调拨入库","调拨出库"].includes(original.action))throw Error("原流水不可单笔冲销；调拨需成对处理");
 if(reversed.has(original.id))throw Error("原流水已冲销，不可重复");reversed.add(original.id);
 if(["businessId","skuId","warehouseId","unit","quantity","sourceId","supplierId","factoryId","batch"].some(function(k){return m[k]!==original[k];}))throw Error("冲销须与原流水的数量、单据及来源完全一致");
 }else{
 if(m.reversalOf)throw Error("仅冲销动作可关联原流水");
 const sku=opsFind(d,supply,"skus",m.skuId);
 if(!sku)throw Error("出入库SKU不存在");
 if(["采购入库","采购退货"].includes(m.action)){
 const p=opsFind(d,supply,"purchases",m.sourceId);
 if(!p||p.businessId!==m.businessId||p.skuId!==m.skuId||p.warehouseId!==m.warehouseId||p.supplierId!==m.supplierId||p.factoryId!==m.factoryId)throw Error("采购流水必须与采购明细的业务、SKU、仓库及供应商工厂一致");
 }
 if(m.action==="销售出库"){
 const o=opsFind(d,supply,"orders",m.sourceId);
 if(!o||o.businessId!==m.businessId||o.skuId!==m.skuId||o.warehouseId!==m.warehouseId)throw Error("出库须关联同业务SKU及仓库的销售明细");
 }
 if(m.action==="退货入库"){
 const ret=opsFind(d,supply,"returns",m.sourceId),o=ret&&opsFind(d,supply,"orders",ret.orderId);
 if(!ret||!o||o.skuId!==m.skuId||ret.businessId!==m.businessId||ret.warehouseId!==m.warehouseId)throw Error("退货须关联同业务SKU及退回仓库的售后工单");
 }
 if(["期初入库","盘盈","盘亏"].includes(m.action)&&!m.notes)throw Error("期初和盘点流水需填写依据说明");
 if(["调拨入库","调拨出库"].includes(m.action)){if(!m.transferId)throw Error("调拨缺少关联号");(transfers[m.transferId]||(transfers[m.transferId]=[])).push(m);}
 }
 });
 
 const reversedTransfers=new Set();
 Object.values(transfers).forEach(function(pair){
 if(pair.length!==2||pair[0].action===pair[1].action||pair[0].skuId!==pair[1].skuId||pair[0].businessId!==pair[1].businessId||pair[0].quantity!==pair[1].quantity||pair[0].warehouseId===pair[1].warehouseId||pair[0].sourceId!==pair[1].sourceId)throw Error("调拨须成对、同SKU同数量且仓库不同");
 if(pair[0].sourceId){
 const origin=transfers[pair[0].sourceId];
 if(!origin||reversedTransfers.has(pair[0].sourceId)||origin.some(function(m){return !!m.sourceId;}))throw Error("原调拨不存在或已经反向处理");
 const before=origin.find(function(m){return m.action==="调拨出库";}),after=pair.find(function(m){return m.action==="调拨入库";});
 if(before.skuId!==after.skuId||before.businessId!==after.businessId||before.quantity!==after.quantity||before.warehouseId!==after.warehouseId)throw Error("反向调拨必须匹配原调拨");
 reversedTransfers.add(pair[0].sourceId);
 }
 });




 const balances={};
 d.movements.filter(function(m){return m.status==="已审核";}).slice().sort(function(a,b){return a.postedAt.localeCompare(b.postedAt);}).forEach(function(m){
 const key=m.skuId+"|"+m.warehouseId;balances[key]=(balances[key]||0)+opsMoveSign(d,m)*m.quantity;
 if(balances[key]<-0.00000001)throw Error("库存不足，不能产生负库存："+opsLabel(opsFind(d,supply,"skus",m.skuId)));
 });
 d.purchases.forEach(function(p){const n=opsReceived(d,p.id);if(n<-.00000001||n>p.quantity+.00000001)throw Error("采购净收货数量超出采购数量");if(p.status==="取消"&&n>0)throw Error("有未冲销收货记录的采购不可取消");});
 d.orders.forEach(function(o){const shipped=opsShipped(d,o.id);if(shipped<-.00000001||shipped>o.quantity+.00000001)throw Error("销售净出库数量超出订单数量");if(o.status==="取消"&&shipped>0)throw Error("已有出库的订单不可直接取消");if(o.status==="已交付"&&shipped<o.quantity-.00000001)throw Error("尚未全部发货，不能标记已交付");
 const physicalReturns=d.returns.filter(function(r){return r.orderId===o.id;}).reduce(function(n,r){return n+opsReturned(d,r.id);},0);if(physicalReturns>shipped+.00000001)throw Error("累计实物退回数量超出净发货数量");
 });
 d.returns.forEach(function(r){const o=opsFind(d,supply,"orders",r.orderId);if(r.currency!==o.currency)throw Error("售后币种须与原订单一致");if(r.quantity>opsShipped(d,o.id)+.00000001)throw Error("售后数量超出已发货数量");const returned=opsReturned(d,r.id);if(returned<-.00000001||returned>r.quantity+.00000001)throw Error("退货入库数量超出售后工单数量");});
 if(!Array.isArray(input.logs)||input.logs.length>100000)throw Error("操作记录无效或超过容量");
 d.logs=input.logs.map(function(r){return {id:String(r.id||""),at:String(r.at||""),kind:String(r.kind||""),entityId:String(r.entityId||""),action:String(r.action||""),detail:String(r.detail||"").slice(0,50000)};});
 return d;
}
function opsPrepare(db,supply,kind,record,now,idFactory){
 const def=OPS_SPEC.tables[kind];if(!def)throw Error("未知板块");
 const next=cloneSupply(db),old=record.id?next[kind].find(function(r){return r.id===record.id;}):null;
 if(record.id&&!old)throw Error("记录不存在，请刷新");
 if(kind==="movements"&&old&&old.status==="已审核")throw Error("已审核流水不可修改，请使用冲销或反向调拨");
 if(["purchases","offers"].includes(kind)&&record.supplierId){const s=opsFind(db,supply,"suppliers",record.supplierId);if(s&&s.status==="归档")throw Error("归档供应商不能用于新增或修改采购，请先恢复档案");}
 const r={id:old?old.id:idFactory(def.code),createdAt:old?old.createdAt:now,updatedAt:now,postedAt:old?old.postedAt||"":""};
 def.fields.forEach(function(f){r[f[0]]=record[f[0]]??"";});
 if(["purchases","quotes","orders"].includes(kind)&&!r.documentNo)r.documentNo=r.id;
 if(kind==="movements"&&r.status==="已审核"){r.postedAt=now;
 const source=r.action==="销售出库"?opsFind(next,supply,"orders",r.sourceId):["采购入库","采购退货"].includes(r.action)?opsFind(next,supply,"purchases",r.sourceId):r.action==="退货入库"?opsFind(next,supply,"returns",r.sourceId):null;
 if(source&&["取消","草稿","关闭"].includes(source.status))throw Error("来源单据状态不允许收发货");
 if(r.action==="销售出库"&&source&&!["已收款","赊销","部分退款"].includes(source.paymentStatus))throw Error("请先核对收款状态，或明确记录为赊销");
 }
 if(old)next[kind][next[kind].indexOf(old)]=r;else next[kind].push(r);
 next.revision=db.revision+1;next.logs.push({id:idFactory("LOG"),at:now,kind:kind,entityId:r.id,action:old?"编辑":"新增",detail:JSON.stringify({before:old||null,after:r})});
 return opsValidate(next,supply);
}
function opsPersist(storage,before,next){
 const raw=storage.getItem(OPS_KEY),current=raw?JSON.parse(raw):{revision:0};
 if(current.revision!==before.revision)throw Error("另一窗口已更新业务数据，请刷新后再操作");
 storage.setItem(OPS_KEY,JSON.stringify(next));return next;
}
function opsTransfer(db,supply,record,now,idFactory){
 if(record.fromWarehouse===record.toWarehouse)throw Error("调出和调入仓库不能相同");
 const next=cloneSupply(db),group=idFactory("TRF");
 ["调拨出库","调拨入库"].forEach(function(action,i){next.movements.push({id:idFactory("MOV"),businessId:record.businessId,skuId:record.skuId,warehouseId:i?record.toWarehouse:record.fromWarehouse,action:action,quantity:Number(record.quantity),unit:record.unit,sourceId:record.sourceTransfer||"",supplierId:"",factoryId:"",batch:record.batch||"",status:"已审核",reversalOf:"",transferId:group,sourceURL:"",notes:record.notes||"库存调拨",createdAt:now,updatedAt:now,postedAt:now});});
 next.revision=db.revision+1;next.logs.push({id:idFactory("LOG"),at:now,kind:"movements",entityId:group,action:"调拨",detail:JSON.stringify(record)});return opsValidate(next,supply);
}
function opsReverse(db,supply,movementId,now,idFactory){
 const m=db.movements.find(function(x){return x.id===movementId;});
 if(!m||m.status!=="已审核"||m.action==="冲销")throw Error("请选择未冲销的已审核原流水");
 if(m.transferId){const pair=db.movements.filter(function(x){return x.transferId===m.transferId;});if(pair.length!==2)throw Error("调拨记录不完整");const out=pair.find(function(x){return x.action==="调拨出库";}),inbound=pair.find(function(x){return x.action==="调拨入库";});return opsTransfer(db,supply,{businessId:m.businessId,skuId:m.skuId,unit:m.unit,quantity:m.quantity,fromWarehouse:inbound.warehouseId,toWarehouse:out.warehouseId,batch:m.batch,notes:"反向调拨："+m.transferId,sourceTransfer:m.transferId},now,idFactory);}
 return opsPrepare(db,supply,"movements",{...m,id:"",action:"冲销",reversalOf:m.id,status:"已审核",notes:"冲销原流水："+m.id},now,idFactory);
}
function opsImport(db,incoming,supply,now,idFactory){
 incoming=opsValidate(incoming,supply);const next=cloneSupply(db);let added=0;
 Object.keys(OPS_SPEC.tables).forEach(function(k){incoming[k].forEach(function(r){const old=next[k].find(function(x){return x.id===r.id;});if(old){if(JSON.stringify(old)!==JSON.stringify(r))throw Error("编号内容冲突："+r.id);}else{next[k].push(r);added++;}});});
 const ids=new Set(next.logs.map(function(l){return l.id;}));incoming.logs.forEach(function(l){if(!ids.has(l.id)){next.logs.push(l);ids.add(l.id);}});
 next.revision=db.revision+1;next.logs.push({id:idFactory("LOG"),at:now,kind:"system",entityId:"import",action:"导入",detail:"合并新增 "+added+" 条，不覆盖原记录"});return {data:opsValidate(next,supply),added:added};
}










export { BUSINESS_IDS, SUPPLY_FIELDS, OPS_SPEC, emptySupply, validateSupply, prepareSupplyChange, prepareSupplyImport, opsEmpty, opsValidate, opsPrepare, opsTransfer, opsReverse, opsImport, opsBalance, opsReceived, opsShipped, opsReturned, opsPaidOrders, opsCash, opsPersist };