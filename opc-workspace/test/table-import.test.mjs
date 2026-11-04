
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {emptySupply} from '../domain.mjs';
import {parseCSV,readTable,detectMapping,prepareTableImport,templateWorkbook} from '../table-import.mjs';
const payload=(csv,more={})=>({filename:'档案.csv',file:Buffer.from(csv).toString('base64'),kind:'suppliers',businessId:'BUS-001',...more});
const prepare=async(input,before=emptySupply())=>{const table=await readTable(input);return prepareTableImport(before,table,{...input,mapping:input.mapping||detectMapping(table.headers,input.kind)});};
test('CSV preserves quoted commas, newlines, BOM, zeroes and physical row numbers',()=>{
 const rows=parseCSV('\uFEFF供应商名称,电话,备注\r\n"甲,乙","00123","第一行\n第二行"\r\n');assert.equal(rows[1].cells[0],'甲,乙');assert.equal(rows[1].cells[1],'00123');assert.equal(rows[1].cells[2],'第一行\n第二行');assert.equal(rows[1].number,2);
});
test('CSV rejects malformed quotations and supports semicolon/tab',()=>{
 assert.throws(()=>parseCSV('a,b\n"bad'),/引号/);assert.throws(()=>parseCSV('a,b\n"x"oops,2'),/多余/);
 assert.deepEqual(parseCSV('a;b\n1;2')[1].cells,['1','2']);assert.deepEqual(parseCSV('a\tb\n1\t2')[1].cells,['1','2']);
});
test('title rows and blank rows keep correct source row number',async()=>{
 const result=await prepare(payload('供应商资料\n供应商名称,电话\n\n甲供应商,00123',{headerRow:2}));assert.equal(result.results[0].row,4);assert.equal(result.records[0].phone,'00123');
});
test('supplier import defaults unverified and preserves inert formula-like CSV text',async()=>{
 const r=await prepare(payload('供应商名称,备注\n甲,=SUM(A1:A2)'));assert.equal(r.records[0].status,'待核实');assert.equal(r.records[0].type,'待核实');assert.equal(r.records[0].notes,'=SUM(A1:A2)');assert.equal(r.summary.errors,0);
});
test('identical duplicates skipped, conflicting duplicates block entire batch',async()=>{
 const a=await prepare(payload('供应商名称,电话\n甲,00123\n甲,00123'));assert.equal(a.summary.added,1);assert.equal(a.summary.skipped,1);
 const b=await prepare(payload('供应商名称,电话\n甲,00123\n甲,00456'));assert.equal(b.canCommit,false);assert.equal(b.summary.errors,1);
});
test('existing records remain unchanged when a repeated file is imported',async()=>{
 const a=await prepare(payload('供应商名称,电话\n甲,00123'));const db=emptySupply();db.suppliers.push(...a.records);
 const before=JSON.stringify(db),b=await prepare(payload('供应商名称,电话\n甲,00123'),db);assert.equal(b.summary.skipped,1);assert.equal(b.summary.added,0);assert.equal(JSON.stringify(db),before);
});
test('business can come from rows; missing or wrong business is reported',async()=>{
 const good=await prepare(payload('供应商名称,所属业务\n甲,手工DIY',{businessId:''}));assert.equal(good.records[0].businessId,'BUS-002');
 const bad=await prepare(payload('供应商名称\n甲',{businessId:''}));assert.equal(bad.summary.errors,1);
});
test('duplicate mappings and missing required name cannot bypass validation',async()=>{
 await assert.rejects(()=>prepare(payload('名称,电话\n甲,1',{mapping:{name:0,phone:0}})),/多个字段/);
 await assert.rejects(()=>prepare(payload('电话\n123',{mapping:{phone:0}})),/供应商名称/);
});
test('ambiguous duplicate headers are not automatically selected',()=>{
 assert.equal(detectMapping(['电话','联系电话','供应商名称'],'suppliers').phone,undefined);
 assert.equal(detectMapping(['供应商ID','工厂ID'],'links').supplierId,0);
 assert.equal(detectMapping(['供应商ID','工厂ID'],'links').id,undefined);
});
test('identities do not erase meaningful punctuation',async()=>{
 const r=await prepare(payload('供应商名称\nA/B\nAB'));assert.equal(r.summary.added,2);
});
test('relationships resolve existing parties within the selected business',async()=>{
 const a=await prepare(payload('供应商名称\n甲'));const db=emptySupply();db.suppliers.push(...a.records);
 const f=await prepare(payload('工厂名称\n乙',{kind:'factories'}),db);db.factories.push(...f.records);
 const r=await prepare(payload('供应商名称,工厂名称\n甲,乙',{kind:'links'}),db);assert.equal(r.records[0].supplierId,a.records[0].id);assert.equal(r.records[0].factoryId,f.records[0].id);
 const wrong=await prepare(payload('供应商名称,工厂名称\n甲,乙',{kind:'links',businessId:'BUS-002'}),db);assert.equal(wrong.summary.errors,1);
});
test('invalid dates, links and status are explicit row errors',async()=>{
 for(const [header,value] of [['资料核实日期','2026-02-31'],['1688／官网','javascript:alert(1)'],['合作状态','随便']]){
  const r=await prepare(payload('供应商名称,'+header+'\n甲,'+value));assert.equal(r.summary.errors,1);
 }
});
test('xlsx preserves text phones and allows sheet selection',async()=>{
 const book=new ExcelJS.Workbook();book.addWorksheet('说明').addRow(['填写说明']);const sheet=book.addWorksheet('工厂');sheet.addRow(['工厂名称','电话']);sheet.addRow(['乙工厂','001234']);
 const file=Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
 const r=await prepare({filename:'工厂.xlsx',file,sheet:1,kind:'factories',businessId:'BUS-001'});assert.equal(r.records[0].phone,'001234');
});
test('xlsx formulas are rejected rather than evaluated or silently cached',async()=>{
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('供应商');s.addRow(['供应商名称']);s.addRow([{formula:'"甲"',result:'甲'}]);
 const file=Buffer.from(await book.xlsx.writeBuffer()).toString('base64');await assert.rejects(()=>readTable({filename:'档案.xlsx',file}),/公式/);
});
test('downloadable template includes text columns, hints and valid headers',async()=>{
 const book=new ExcelJS.Workbook();await book.xlsx.load(await templateWorkbook('suppliers'));
 assert.equal(book.worksheets[0].getCell('A1').text,'供应商名称');assert.equal(book.worksheets[0].getColumn(1).numFmt,'@');assert.equal(book.worksheets[1].name,'填写说明');
});
test('unsupported, oversized and corrupt files have useful errors',async()=>{
 await assert.rejects(()=>readTable({filename:'a.xls',file:'YQ=='}),/xlsx/);
 await assert.rejects(()=>readTable({filename:'a.xlsx',file:'YQ=='}),/有效/);
 await assert.rejects(()=>readTable({filename:'a.csv',file:Buffer.alloc(5*1024*1024+1).toString('base64')}),/5MB/);
 await assert.rejects(()=>prepare(payload('供应商名称\n'+Array.from({length:1001},(_,i)=>'甲'+i).join('\n'))),/1000/);
});

test('legacy GB18030 CSV is decoded without corrupting Chinese names',async()=>{
 const file=Buffer.concat([Buffer.from('name,phone\n'),Buffer.from([0xbc,0xd7]),Buffer.from(',00123')]).toString('base64');
 const r=await prepare({filename:'legacy.csv',file,kind:'suppliers',businessId:'BUS-001'});assert.equal(r.records[0].name,'甲');assert.equal(r.records[0].phone,'00123');
});
