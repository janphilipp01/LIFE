// Testet die eigene Web-App (public/index.html) gegen einen nachgebauten Supabase-Client inkl. Zugriffsregeln.
// Aufruf: node test/web.test.js   (benötigt jsdom)
const {JSDOM}=require('jsdom');const fs=require('fs');const path=require('path');
const R=path.join(__dirname,'..');
let html=fs.readFileSync(path.join(R,'public/index.html'),'utf8');
const shim=fs.readFileSync(path.join(R,'public/shim.js'),'utf8');
html=html.replace('<script src="/config.js"></script>','<script>window.LIFEOS_CONFIG={url:"https://x.supabase.co",anonKey:"anon"}</script>')
  .replace(/<script src="https:\/\/cdn[^"]+"><\/script>/,'')
  .replace('<script src="/shim.js"></script>','<script>window.__mkSB()</script><script>'+shim+'</script>');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function mkSB(users,members,rows){
  // rows: Map key coll|id -> {coll,id,data}
  let session=null;const authCbs=[];const rt=[];
  const canAccess=c=>{const m=session&&members[session.user.id];if(!m)return false;return m.role==='owner'||(m.role==='partner'&&(c==='hh'||c.startsWith('hh/')))};
  const emit=(row,old)=>rt.forEach(f=>f({new:row,old}));
  function table(name){
    const st={f:[],ord:null,lim:null,single:false};
    const run=()=>{
      if(name==='members'){const uid=st.f.find(x=>x[0]==='user_id');const m=uid&&session&&uid[1]===session.user.id?members[uid[1]]:null;return {data:m?{role:m.role,name:m.name}:null,error:null}}
      let out=[...rows.values()].filter(r=>canAccess(r.coll)&&st.f.every(([k,v,op])=>{const val=k.startsWith('data->>')?String(r.data[k.slice(7)]??''):r[k];return op==='eq'?val===v:op==='neq'?val!==v:op==='gt'?val>v:op==='gte'?val>=v:op==='lt'?val<v:val<=v}));
      if(st.ord){const k=st.ord[0].slice(7);out.sort((a,b)=>(String(a.data[k]??'')>String(b.data[k]??'')?1:-1)*(st.ord[1]?1:-1))}
      if(st.lim)out=out.slice(0,st.lim);
      if(st.single)return {data:out[0]?{data:out[0].data}:null,error:null};
      return {data:out.map(r=>({id:r.id,data:r.data})),error:null};
    };
    const b={select(){return b},eq(k,v){st.f.push([k,v,'eq']);return b},neq(k,v){st.f.push([k,v,'neq']);return b},gt(k,v){st.f.push([k,v,'gt']);return b},gte(k,v){st.f.push([k,v,'gte']);return b},lt(k,v){st.f.push([k,v,'lt']);return b},lte(k,v){st.f.push([k,v,'lte']);return b},
      order(k,o){st.ord=[k,o.ascending];return b},limit(n){st.lim=n;return b},maybeSingle(){st.single=true;return Promise.resolve(run())},then(res,rej){return Promise.resolve(run()).then(res,rej)},
      upsert(r){if(!canAccess(r.coll))return Promise.resolve({error:{message:'new row violates row-level security policy',code:'42501'}});rows.set(r.coll+'|'+r.id,JSON.parse(JSON.stringify(r)));setTimeout(()=>emit(r),5);return Promise.resolve({error:null})},
      delete(){return {eq(k,v){st.f.push([k,v,'eq']);return this},then(res){const del=[...rows.values()].filter(r=>canAccess(r.coll)&&st.f.every(([k,v])=>r[k]===v));del.forEach(r=>{rows.delete(r.coll+'|'+r.id);setTimeout(()=>emit(null,r),5)});return Promise.resolve({error:null}).then(res)}}}};
    return b;
  }
  const uploads={};
  return {
    auth:{getSession:async()=>({data:{session}}),onAuthStateChange:cb=>authCbs.push(cb),
      signInWithPassword:async({email,password})=>{const u=users[email];if(!u||u.pw!==password)return {data:{},error:{message:'Invalid login'}};session={user:{id:u.id,email}};return {data:{session},error:null}},
      signOut:async()=>{session=null},resetPasswordForEmail:async()=>({error:null}),updateUser:async()=>({error:null})},
    from:table,
    rpc:async(fn,{p_coll,p_id,p_patch})=>{const r=rows.get(p_coll+'|'+p_id);if(!r||!canAccess(p_coll))return {error:{message:'nicht gefunden'}};Object.assign(r.data,p_patch);setTimeout(()=>emit(r),5);return {error:null}},
    channel:()=>({on(_,__,f){rt.push(f);return this},subscribe(){return this}}),
    storage:{from:()=>({upload:async(id,f)=>{if(members[session.user.id].role!=='owner')return {error:{message:'denied'}};uploads[id]=f;return {error:null}},createSignedUrl:async id=>({data:{signedUrl:'https://signed/'+id}})})},
    _rows:rows,_uploads:uploads
  };
}
async function boot(email,pw,shared){
  const errors=[];
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://lifeos.test/',beforeParse(w){w.__mkSB=()=>{w.supabase={createClient:()=>shared.sb}};w.scrollTo=()=>{};w.console.error=(...a)=>errors.push(a.join(' '));w.addEventListener('error',e=>errors.push(e.message))}});
  const w=dom.window,doc=w.document;await wait(100);
  const login=doc.getElementById('lo-login');
  if(login){doc.getElementById('loMail').value=email;doc.getElementById('loPw').value=pw;login.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
  await wait(300);return {w,doc,errors,L:w.__lifeos};
}
(async()=>{
  const rows=new Map();const put=(coll,id,data)=>rows.set(coll+'|'+id,{coll,id,data});
  put('accounts','a',{name:'Revolut',entity:'Privat',type:'Girokonto',balance:12000});
  put('reminders','r1',{title:'Steuerberater anrufen',due:'2026-10-13',status:'offen'});
  put('hh','main',{names:{a:'Jan',b:'Sophie'}});
  put('hh/main/tasks','k1',{title:'Bad putzen',cadence:7,who:'abwechselnd'});
  const users={'jan@x.de':{id:'u1',pw:'geheim123456'},'sophie@x.de':{id:'u2',pw:'sophie123456'},'fremd@x.de':{id:'u3',pw:'fremd1234567'}};
  const members={u1:{role:'owner',name:'Jan'},u2:{role:'partner',name:'Sophie'}};
  const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1};
  // Jan
  let sh={sb:mkSB(users,members,rows)};
  let {w,doc,errors,L}=await boot('jan@x.de','geheim123456',sh);
  ok(!doc.getElementById('lo-login'),'Jan angemeldet');
  ok(L.S.accounts.length===1&&L.S.reminders.length===1&&L.S.hhTasks.length===1,'Daten geladen');
  L.ui.sec='todo';L.ui.tab.todo='alle';L.render();
  doc.getElementById('todoTitle').value='Neues aus der Web-App';doc.getElementById('todoForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(250);
  ok([...rows.values()].some(r=>r.coll==='reminders'&&r.data.title==='Neues aus der Web-App'),'Schreiben');
  ok(L.S.reminders.length===2,'Live-Aktualisierung nach Schreiben');
  doc.querySelector('[data-todo="r1"]').click();await wait(250);
  ok(rows.get('reminders|r1').data.status==='erledigt','Update per doc_merge');
  ok(doc.querySelector('[data-logout]'),'Abmelden-Knopf');
  ok(!doc.querySelector('[data-ask]'),'Kein Assistent ohne Claude');
  L.ui.sec='finanzen';L.ui.tab.fin='rechnungen';L.render();ok(doc.querySelector('[data-receipt]'),'Beleg-Knopf (Texterkennung)');
  ok(errors.length===0,'Keine Fehler Jan '+JSON.stringify(errors));
  // Sophie
  ({w,doc,errors,L}=await boot('sophie@x.de','sophie123456',{sb:mkSB(users,members,rows)}));
  ok(L.ui.sec==='haushalt','Sophie landet im Haushalt');
  ok(L.S.accounts.length===0&&L.S.reminders.length===0,'Sophie sieht keine Finanzen/To-Dos');
  ok(L.S.hhTasks.length===1,'Sophie sieht Haushalt');
  const sb2=mkSB(users,members,rows);await sb2.auth.signInWithPassword({email:'sophie@x.de',password:'sophie123456'});
  const r=await sb2.from('docs').upsert({coll:'accounts',id:'hack',data:{}});ok(r.error,'Sophie kann nicht in Finanzen schreiben');
  ok(errors.length===0,'Keine Fehler Sophie '+JSON.stringify(errors));
  // Unbekannt
  ({w,doc,errors,L}=await boot('fremd@x.de','fremd1234567',{sb:mkSB(users,members,rows)}));
  ok(doc.getElementById('lo-login')&&doc.getElementById('lo-login').textContent.includes('nicht freigeschaltet'),'Fremder Zugang gesperrt');
  ({w,doc,errors,L}=await boot('jan@x.de','falsch',{sb:mkSB(users,members,rows)}));
  ok(doc.querySelector('.login-msg')&&doc.querySelector('.login-msg').textContent.includes('fehlgeschlagen'),'Falsches Passwort');
  process.exit();
})();
