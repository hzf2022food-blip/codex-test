
import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../domain.mjs';
function createWorkspaceStorage(nativeStorage){
 const KEY="opc.workspace.v1",SUP="opc.supply.v1",OPS="opc.operations.v1";
 function read(){
  const raw=nativeStorage.getItem(KEY);
  if(raw){const e=JSON.parse(raw);if(!e||e.version!==1||!["string","object"].includes(typeof e.supplyRaw)||!["string","object"].includes(typeof e.opsRaw)||(typeof e.supplyRaw==="object"&&e.supplyRaw!==null)||(typeof e.opsRaw==="object"&&e.opsRaw!==null))throw Error("统一档案格式异常，请先备份原始浏览器数据");return e;}
  return {version:1,supplyRaw:nativeStorage.getItem(SUP),opsRaw:nativeStorage.getItem(OPS)};
 }
 return {
  getItem:function(k){if(k===SUP||k===OPS){const e=read();return k===SUP?e.supplyRaw:e.opsRaw;}return nativeStorage.getItem(k);},
  setItem:function(k,v){if(k===SUP||k===OPS){const e=read();e[k===SUP?"supplyRaw":"opsRaw"]=String(v);nativeStorage.setItem(KEY,JSON.stringify(e));}else nativeStorage.setItem(k,v);},
  removeItem:function(k){if(k===SUP||k===OPS){const e=read();e[k===SUP?"supplyRaw":"opsRaw"]=null;nativeStorage.setItem(KEY,JSON.stringify(e));}else nativeStorage.removeItem(k);},
  commitBoth:function(supplyRevision,opsRevision,supply,ops){const e=read(),s=e.supplyRaw?JSON.parse(e.supplyRaw):{revision:0},o=e.opsRaw?JSON.parse(e.opsRaw):{revision:0};if(s.revision!==supplyRevision||o.revision!==opsRevision)throw Error("另一窗口已更新档案，请刷新后重试");nativeStorage.setItem(KEY,JSON.stringify({version:1,supplyRaw:JSON.stringify(supply),opsRaw:JSON.stringify(ops)}));},
  rawBackup:function(){return nativeStorage.getItem(KEY)||JSON.stringify(read());}
 };
}

function runOpsTests(api,createStorage){
 const cloneSupply=v=>JSON.parse(JSON.stringify(v));const results=[];function check(name,fn){try{if(!fn())throw Error("返回false");results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}function rejects(fn){try{fn();return false;}catch(e){return true;}}
 let seq=0,clock=0;const id=p=>p+"-qa"+String(++seq).padStart(6,"0"),now=()=>new Date(Date.UTC(2026,10,3,0,0,++clock)).toISOString();
 let s=api.emptySupply(),d=api.opsEmpty(false);
 s=api.prepareSupplyChange(s,"suppliers",{name:"独立测试供应商",businessId:"BUS-001",status:"待核实",type:"工厂直供"},now(),id);const supplier=s.suppliers[0];
 s=api.prepareSupplyChange(s,"factories",{name:"独立测试工厂",businessId:"BUS-001",status:"待核实"},now(),id);const factory=s.factories[0];
 s=api.prepareSupplyChange(s,"links",{supplierId:supplier.id,factoryId:factory.id,status:"已核实"},now(),id);
 function row(kind,input){const r={businessId:"BUS-001"};api.OPS_SPEC.tables[kind].fields.forEach(function(f){r[f[0]]=f[2]==="select"?f[4][0]:"";});return Object.assign(r,{businessId:"BUS-001"},input);}
 function save(kind,input){d=api.opsPrepare(d,s,kind,row(kind,input),now(),id);return d[kind][d[kind].length-1];}
 const product=save("products",{name:"测试PLA",model:"QA-PLA",parameterStatus:"待提供"});
 const sku=save("skus",{name:"测试PLA黑色1卷",productId:product.id,unit:"卷"});
 const whA=save("warehouses",{name:"测试仓库A"}),whB=save("warehouses",{name:"测试仓库B"});
 const pur=save("purchases",{documentNo:"PO-QA",supplierId:supplier.id,factoryId:factory.id,skuId:sku.id,quantity:10,unit:"卷",unitPrice:10,currency:"CNY",warehouseId:whA.id,status:"已下单"});
 check("产品与SKU关联建档",()=>d.skus[0].productId===product.id);
 check("初始库存不造数",()=>api.opsBalance(d,sku.id,whA.id)===0);
 const receipt=save("movements",{action:"采购入库",skuId:sku.id,warehouseId:whA.id,quantity:10,unit:"卷",sourceId:pur.id,supplierId:supplier.id,factoryId:factory.id,status:"已审核"});
 check("采购收货关联供应商及工厂",()=>api.opsBalance(d,sku.id,whA.id)===10&&api.opsReceived(d,pur.id)===10);
 check("采购超量收货阻断",()=>rejects(()=>api.opsPrepare(d,s,"movements",row("movements",{action:"采购入库",skuId:sku.id,warehouseId:whA.id,quantity:1,unit:"卷",sourceId:pur.id,supplierId:supplier.id,factoryId:factory.id,status:"已审核"}),now(),id)));
 check("未审核不改变库存",()=>{const pending=api.opsPrepare(d,s,"movements",row("movements",{action:"盘盈",skuId:sku.id,warehouseId:whA.id,quantity:99,unit:"卷",status:"草稿",notes:"测试"}),now(),id);return api.opsBalance(pending,sku.id,whA.id)===10;});
 const order=save("orders",{documentNo:"SO-QA",orderDate:"2026-11-03",channel:"Shopify",skuId:sku.id,quantity:4,unit:"卷",unitPrice:20,currency:"CNY",warehouseId:whA.id,paymentStatus:"已收款",status:"正常"});
 const shipment=save("movements",{action:"销售出库",skuId:sku.id,warehouseId:whA.id,quantity:4,unit:"卷",sourceId:order.id,status:"已审核"});
 check("销售出库扣减正确",()=>api.opsBalance(d,sku.id,whA.id)===6&&api.opsShipped(d,order.id)===4);
 check("负库存阻断",()=>rejects(()=>api.opsPrepare(d,s,"movements",row("movements",{action:"盘亏",skuId:sku.id,warehouseId:whA.id,quantity:7,unit:"卷",status:"已审核",notes:"测试盘亏"}),now(),id)));
 check("销售超量发货阻断",()=>rejects(()=>api.opsPrepare(d,s,"movements",row("movements",{action:"销售出库",skuId:sku.id,warehouseId:whA.id,quantity:1,unit:"卷",sourceId:order.id,status:"已审核"}),now(),id)));
 check("SKU单位不一致阻断",()=>rejects(()=>api.opsPrepare(d,s,"movements",row("movements",{action:"盘盈",skuId:sku.id,warehouseId:whA.id,quantity:1,unit:"kg",status:"已审核",notes:"测试"}),now(),id)));
 const ret=save("returns",{name:"测试售后",orderId:order.id,kind:"退货退款",quantity:2,reason:"独立测试",currency:"CNY",warehouseId:whA.id,status:"待退货"});
 save("movements",{action:"退货入库",skuId:sku.id,warehouseId:whA.id,quantity:2,unit:"卷",sourceId:ret.id,status:"已审核"});
 check("退货入库关联原订单",()=>api.opsBalance(d,sku.id,whA.id)===8&&api.opsReturned(d,ret.id)===2);
 check("退货重复入库阻断",()=>rejects(()=>api.opsPrepare(d,s,"movements",row("movements",{action:"退货入库",skuId:sku.id,warehouseId:whA.id,quantity:1,unit:"卷",sourceId:ret.id,status:"已审核"}),now(),id)));
 check("有实物退回后禁止直接冲销原发货",()=>rejects(()=>api.opsReverse(d,s,shipment.id,now(),id)));
 const before=d;d=api.opsTransfer(d,s,{businessId:"BUS-001",skuId:sku.id,fromWarehouse:whA.id,toWarehouse:whB.id,quantity:3,unit:"卷"},now(),id);
 check("调拨双笔同时保存",()=>api.opsBalance(d,sku.id,whA.id)===5&&api.opsBalance(d,sku.id,whB.id)===3&&d.movements.length===before.movements.length+2);
 check("调拨超量全部阻断",()=>{const raw=JSON.stringify(d);const rejected=rejects(()=>api.opsTransfer(d,s,{businessId:"BUS-001",skuId:sku.id,fromWarehouse:whA.id,toWarehouse:whB.id,quantity:99,unit:"卷"},now(),id));return rejected&&JSON.stringify(d)===raw;});
 const transferId=d.movements[d.movements.length-1].id;d=api.opsReverse(d,s,transferId,now(),id);
 check("反向调拨恢复库存",()=>api.opsBalance(d,sku.id,whA.id)===8&&api.opsBalance(d,sku.id,whB.id)===0);
 check("原调拨不允许重复反向处理",()=>rejects(()=>api.opsReverse(d,s,transferId,now(),id)));
 check("已审核流水不可编辑",()=>rejects(()=>api.opsPrepare(d,s,"movements",{...receipt,quantity:9},now(),id)));
 check("采购原收货不能冲销成负库存",()=>rejects(()=>api.opsReverse(d,s,receipt.id,now(),id)));
 check("库存不足时不改变原始档案",()=>api.opsBalance(d,sku.id,whA.id)===8);
 save("payments",{name:"测试收款",date:"2026-11-03",direction:"收",category:"销售收款",amount:80,currency:"CNY",fx:1,receiptRef:"QA-PAY-1",status:"已确认"});
 save("payments",{name:"测试退款",date:"2026-11-03",direction:"支",category:"客户退款",amount:5,currency:"CNY",fx:1,status:"已确认"});
 check("收支人民币方向与汇总正确",()=>api.opsCash(d,"BUS-001")===75);
 check("重复支付流水号阻断",()=>rejects(()=>api.opsPrepare(d,s,"payments",row("payments",{name:"重复",date:"2026-11-03",direction:"收",amount:80,currency:"CNY",fx:1,receiptRef:"QA-PAY-1",status:"已确认"}),now(),id)));
 check("未核实收款不计现金",()=>{const q=api.opsPrepare(d,s,"payments",row("payments",{name:"待确认",date:"2026-11-03",direction:"收",amount:100,currency:"USD",fx:7,status:"待核实"}),now(),id);return api.opsCash(q,"all")===75;});
 check("人民币汇率必须为1",()=>rejects(()=>api.opsPrepare(d,s,"payments",row("payments",{name:"错汇率",date:"2026-11-03",direction:"收",amount:1,currency:"CNY",fx:7,status:"已确认"}),now(),id)));
 const o2=save("orders",{documentNo:"SO-QA",orderDate:"2026-11-03",channel:"Shopify",skuId:sku.id,quantity:1,unit:"卷",unitPrice:20,currency:"CNY",warehouseId:whA.id,paymentStatus:"已收款",status:"正常"});
 check("同订单多行只计一单",()=>api.opsPaidOrders(d,"BUS-001","Shopify")===1);
 check("不是所有行收款则不算已收款整单",()=>{const q=api.opsPrepare(d,s,"orders",{...o2,paymentStatus:"未收款"},now(),id);return api.opsPaidOrders(q,"BUS-001","Shopify")===0;});
 check("未发货不能标记交付",()=>rejects(()=>api.opsPrepare(d,s,"orders",{...o2,status:"已交付"},now(),id)));
 check("非法日历日期阻断",()=>rejects(()=>api.opsPrepare(d,s,"orders",{...o2,orderDate:"2026-02-31"},now(),id)));
 check("已核实参数必须有正式来源",()=>rejects(()=>api.opsPrepare(d,s,"products",{...product,parameterStatus:"已核实"},now(),id)));
 check("撤回参数不被种子数据恢复",()=>api.opsEmpty(true).products.every(p=>p.parameterStatus==="待提供"&&!p.parameterURL));
 const seed=api.opsValidate(api.opsEmpty(true),api.emptySupply());
 check("云端首次启动不预置私人报价或采购成本",()=>seed.salesPrices.length===0&&seed.offers.length===0);
 const restored=api.opsImport(api.opsEmpty(false),d,s,now(),id);
 check("完整业务备份恢复库存与关联",()=>api.opsBalance(restored.data,sku.id,whA.id)===8&&restored.data.orders.length===2);
 check("重复导入不新增重复记录",()=>api.opsImport(restored.data,d,s,now(),id).added===0);
 const changed=cloneSupply(d);changed.products[0].name="不同名称";
 check("备份编号冲突不覆盖",()=>rejects(()=>api.opsImport(d,changed,s,now(),id)));
 const map=new Map(),native={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 native.setItem("opc.supply.v1",JSON.stringify(s));native.setItem("opc.operations.v1",JSON.stringify(d));
 const storage=createStorage(native);
 check("兼容读取v0.2旧供应链及业务数据",()=>JSON.parse(storage.getItem("opc.supply.v1")).suppliers[0].id===supplier.id);
 const beforeNative=JSON.stringify(Array.from(map.entries()));
 check("跨窗口修订冲突阻断",()=>rejects(()=>api.opsPersist(storage,api.opsEmpty(false),d))&&beforeNative===JSON.stringify(Array.from(map.entries())));
 const nextOps=cloneSupply(d);nextOps.revision++;const nextSupply=cloneSupply(s);nextSupply.revision++;
 storage.commitBoth(s.revision,d.revision,nextSupply,nextOps);
 check("供应链与业务完整恢复一次写入",()=>JSON.parse(storage.getItem("opc.supply.v1")).revision===nextSupply.revision&&JSON.parse(storage.getItem("opc.operations.v1")).revision===nextOps.revision);
 const currentMain=native.getItem("opc.workspace.v1"),failNative={getItem:native.getItem,removeItem:native.removeItem,setItem:()=>{throw Error("quota");}};
 check("完整恢复保存失败不产生半次导入",()=>rejects(()=>createStorage(failNative).commitBoth(nextSupply.revision,nextOps.revision,nextSupply,nextOps))&&native.getItem("opc.workspace.v1")===currentMain);
 return results;
}





const results=runOpsTests(domain,createWorkspaceStorage);
for(const result of results)test(result.name,()=>assert.equal(result.passed,true,result.error));
