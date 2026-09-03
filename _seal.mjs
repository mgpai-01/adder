import { chromium } from 'playwright-chromium';
const S='/tmp/claude-0/-home-user-MGPwebsite/2384f963-0128-52af-aa5e-94397fb6483d/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:860,height:520},deviceScaleFactor:3});
await p.goto('file://'+S+'/seal.html',{waitUntil:'load'});
await p.waitForTimeout(900);
await p.screenshot({path:`${S}/seal.png`,fullPage:true});
await b.close();
