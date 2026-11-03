
import {deflateSync} from 'node:zlib';
function crc32(data){let c=0xffffffff;for(const b of data){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}
export function appIcon(size){
 if(![180,192,512].includes(size))throw Error('Unsupported icon size');
 const raw=Buffer.alloc((size*4+1)*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=x/size,v=y/size;
  let rgb=[23,52,54];
  for(const cx of [.38,.62])for(const cy of [.38,.62]){
   const dx=Math.abs(u-cx),dy=Math.abs(v-cy),r=.025;
   if(dx<.095&&dy<.095&&(dx<.095-r||dy<.095-r||(dx-(.095-r))**2+(dy-(.095-r))**2<r*r))rgb=(cx>.5&&cy<.5)?[176,230,203]:[255,255,255];
  }
  const i=y*(size*4+1)+1+x*4;raw[i]=rgb[0];raw[i+1]=rgb[1];raw[i+2]=rgb[2];raw[i+3]=255;
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
