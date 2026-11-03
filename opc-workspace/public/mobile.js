
'use strict';
(()=>{
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 let deferredPrompt=null;
 const button=document.createElement('button');
 button.type='button';button.className='phone-entry-launch';button.textContent='＋ 添加到手机桌面';button.hidden=standalone();
 const guide=document.createElement('dialog');guide.className='mobile-install-dialog';guide.setAttribute('aria-labelledby','mobile-install-title');
 guide.innerHTML='<h2 id="mobile-install-title">添加到手机桌面</h2><div id="mobile-install-steps"></div><p>添加后，点击桌面上的 OPC工作台 图标即可打开。电脑和手机使用同一账号，首次打开需要联网。</p><button type="button">知道了</button>';
 document.body.append(button,guide);
 guide.querySelector('button').onclick=()=>guide.close();
 guide.addEventListener('click',e=>{if(e.target===guide){const r=guide.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)guide.close();}});
 function instructions(){
  const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  document.getElementById('mobile-install-steps').innerHTML=ios
   ?'<p>请用 iPhone 或 iPad 的 Safari 打开此工作台。</p><ol><li>点击浏览器的“分享”按钮（方框上箭头）。</li><li>在菜单中选择“添加到主屏幕”；如果没看到，向下滑动菜单查找。</li><li>名称保留“OPC工作台”，点击“添加”。如出现“作为网页App打开”，请保持开启。</li></ol>'
   :'<p>请用手机的 Chrome 或支持安装网页应用的浏览器打开此工作台。</p><ol><li>点击浏览器右上角菜单 ⋮。</li><li>选择“安装应用”或“添加到主屏幕”。</li><li>确认名称为“OPC工作台”，点击“安装”或“添加”。</li></ol>';
  guide.showModal();
 }
 button.onclick=async()=>{
  if(!deferredPrompt){instructions();return;}
  const prompt=deferredPrompt;deferredPrompt=null;
  try{await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==='accepted')button.hidden=true;}catch{instructions();}
 };
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;});
 window.addEventListener('appinstalled',()=>{deferredPrompt=null;button.hidden=true;if(guide.open)guide.close();});
 matchMedia('(display-mode: standalone)').addEventListener('change',()=>{button.hidden=standalone();});
 if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
})();
