
import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./browser',timeout:90000,workers:1,retries:0,reporter:'line',
 use:{baseURL:'http://127.0.0.1:4173',browserName:'chromium',headless:true},
 webServer:{command:'npm start',url:'http://127.0.0.1:4173/health',timeout:45000,reuseExistingServer:false,env:{...process.env,PORT:'4173',NODE_ENV:'test',ADMIN_LOGIN:'browser-test-owner',ADMIN_PASSWORD:'Only-for-browser-CI-42-password',PUBLIC_ORIGIN:'http://127.0.0.1:4173',RENDER_EXTERNAL_URL:''}}
});
