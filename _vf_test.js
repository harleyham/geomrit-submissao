const puppeteer=require('puppeteer-core');
(async()=>{
  require('child_process').execSync('node /tmp/vf/serve.js',{stdout:'ignore',stderr:'ignore'});
  await new Promise(r=>setTimeout(r,600));
  const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox']});
  const p=await b.newPage(); const logs=[]; p.on('console',m=>m.type()==='error'&&logs.push(m.text()));
  p.on('pageerror',e=>logs.push('PAGEERR '+e.message));
  await p.goto('http://localhost:4600/',{waitUntil:'networkidle0'});
  const r=await p.evaluate(()=>{
    const ds=document.getElementById('ds'); const out={before:ds.value};
    ds.flatpickrInstance.jumpToDate(new Date(2026,11,1));
    const days=[...document.querySelectorAll('.flatpickr-day:not(.prevMonthDay):not(.nextMonthDay):not(.today):not(.selected)')]
      .find(x=>x.textContent.trim()==='20'); if(days)days.click();
    out.after_pick=ds.value;
    document.getElementById('f').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    out.after_submit=ds.value; return out;
  });
  console.log(JSON.stringify(r,null,2));
  console.log('erros:',logs.length?logs:'nenhum');
  await b.close();process.exit(0);
})();
