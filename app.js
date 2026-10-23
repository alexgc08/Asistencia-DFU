(function(){
'use strict';

/* ========== Utilidades ========== */
const $=(s,el=document)=>el.querySelector(s);
const $$=(s,el=document)=>Array.from(el.querySelectorAll(s));
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const pad=n=>String(n).padStart(2,'0');
const dstr=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const todayStr=()=>dstr(new Date());
const monthStart=()=>{const d=new Date();d.setDate(1);return dstr(d);};
const fmtLong=s=>{try{return new Date(s+'T00:00:00').toLocaleDateString('es',{weekday:'long',day:'numeric',month:'long',year:'numeric'});}catch(e){return s;}};
const fmtWd=s=>{try{return new Date(s+'T00:00:00').toLocaleDateString('es',{weekday:'short'});}catch(e){return s;}};
const normUser=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,'');
const collator=new Intl.Collator('es',{sensitivity:'base'});
const initials=n=>String(n||'').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'A';
const normEmail=s=>String(s||'').trim().toLowerCase();
const normPhone=s=>String(s||'').replace(/\D+/g,'');
const okEmail=s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const okPhone=s=>{const d=normPhone(s);return d.length>=6&&d.length<=15;};
const normCode=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function genCode(){
  const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',b=new Uint8Array(12);
  try{crypto.getRandomValues(b);}catch(e){for(let i=0;i<12;i++)b[i]=Math.floor(Math.random()*256);}
  let s='';for(let i=0;i<12;i++)s+=A[b[i]%A.length];
  return s.match(/.{4}/g).join('-');
}
const contactText=u=>[u.email,u.phone].filter(Boolean).map(esc).join('<br>')||'—';
const statusPill=u=>u.pending?'<span class="pill warn">Pendiente</span>':'<span class="pill '+(u.active?'ok':'bad')+'">'+(u.active?'Activo':'Desactivado')+'</span>';

const KEY='asistencias_v1',SKEY='asistencias_sesion',TKEY='asistencias_tema';
const lget=k=>{try{return localStorage.getItem(k);}catch(e){return null;}};
const lset=(k,v)=>{try{localStorage.setItem(k,v);return true;}catch(e){return false;}};
const sget=k=>{try{return sessionStorage.getItem(k);}catch(e){return null;}};
const setSession=v=>{try{v==null?sessionStorage.removeItem(SKEY):sessionStorage.setItem(SKEY,v);}catch(e){}};

async function hash(s){
  try{
    const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('asist::'+s));
    return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
  }catch(e){
    return 'plain:'+btoa(unescape(encodeURIComponent(s)));
  }
}

/* ========== Datos ========== */
const STATUS={P:{l:'Presente',c:'ok'},T:{l:'Tarde',c:'warn'},J:{l:'Justificada',c:'info'},F:{l:'Falta',c:'bad'}};
const PERMS={
  panel:'Ver el panel de resumen',
  tomar:'Tomar y editar asistencia manualmente',
  escanear:'Usar el escáner QR para registrar entradas',
  reportes:'Ver y exportar reportes',
  personas_ver:'Ver la lista de personas',
  personas_edit:'Agregar, editar y eliminar personas, y ver sus QR'
};
const ADMIN_ONLY=['usuarios','roles','ajustes'];
const ACCENTS={marino:{n:'Marino',c:'#0e2046'},esmeralda:{n:'Esmeralda',c:'#0a3b31'},granate:{n:'Granate',c:'#47101f'},grafito:{n:'Grafito',c:'#1d222e'}};

function normalizeDb(o){
  o.brand=Object.assign({name:'Sistema de Asistencias',tagline:'Control de asistencia con código QR',logo:'',accent:'marino'},o.brand||{});
  if(!ACCENTS[o.brand.accent])o.brand.accent='marino';
  if(typeof o.brand.logo!=='string'||o.brand.logo.indexOf('data:image/')!==0)o.brand.logo='';
  o.settings=Object.assign({lateTime:'',allowSignup:true},o.settings||{});
  o.times=(o.times&&typeof o.times==='object')?o.times:{};
  o.locks=(o.locks&&typeof o.locks==='object')?o.locks:{};
  o.users.forEach(u=>{u.email=u.email||'';u.phone=u.phone||'';u.rec=u.rec||'';u.pending=!!u.pending;});
  if(!o.v||o.v<2){
    const r=o.roles.registrador;
    if(r&&r.perms.indexOf('escanear')<0)r.perms.push('escanear');
    o.v=2;
  }
  o.roles.admin.perms=Object.keys(PERMS);
  return o;
}
function freshDb(){
  return normalizeDb({v:2,users:[],people:[],att:{},times:{},roles:{
    admin:{name:'Administrador',system:true,perms:Object.keys(PERMS)},
    director:{name:'Director',system:true,perms:['panel','reportes','personas_ver']},
    registrador:{name:'Registrador',system:true,perms:['panel','tomar','escanear','personas_ver']}
  }});
}
function load(){
  try{
    const r=lget(KEY);
    if(r){
      const o=JSON.parse(r);
      if(o&&Array.isArray(o.users)&&Array.isArray(o.people)&&o.att&&o.roles&&o.roles.admin)return normalizeDb(o);
    }
  }catch(e){}
  return freshDb();
}
let db=load();
let me=null,cur='panel';
let app,view;
// Sincronización segura con Supabase: solo se activa después de autenticar y cargar la nube.
const sbConfig=window.ASISTENCIA_SUPABASE_CONFIG||{};
const sb=(window.supabase&&sbConfig.url&&sbConfig.publishableKey)?window.supabase.createClient(sbConfig.url,sbConfig.publishableKey):null;
let cloudUser=null,cloudBaseline=null,cloudSyncPromise=Promise.resolve(),cloudLoading=false;
const cloneData=x=>JSON.parse(JSON.stringify(x));
const sameData=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function save(){
  if(!lset(KEY,JSON.stringify(db)))toast('No se pudo guardar en este navegador');
  if(cloudUser&&!cloudLoading)queueCloudSync();
}
function queueCloudSync(){
  cloudSyncPromise=cloudSyncPromise.then(()=>syncCloudChanges()).catch(err=>{console.error('Supabase sync:',err);toast('No se pudo sincronizar con la nube. Revisa tu conexión e inténtalo de nuevo.');});
}
function attendanceRows(source){
  const out=[];
  Object.keys(source.att||{}).forEach(date=>Object.keys(source.att[date]||{}).forEach(pid=>{
    const status=source.att[date][pid]; if(['P','T','J','F'].includes(status))out.push({attendance_date:date,person_id:pid,status,marked_time:(source.times[date]||{})[pid]||null,updated_by:cloudUser?cloudUser.id:null});
  }));
  return out;
}
async function syncCloudChanges(){
  if(!sb||!cloudUser||!cloudBaseline)return;
  const before=cloudBaseline,now=cloneData(db);let changed=false;
  const oldPeople=new Map(before.people.map(x=>[x.id,x])),newPeople=new Map(now.people.map(x=>[x.id,x]));
  const peopleUp=[...newPeople.values()].filter(x=>!oldPeople.has(x.id)||!sameData(x,oldPeople.get(x.id))).map(x=>({id:String(x.id),name:x.name,code:x.code||'',group_name:x.group||''}));
  if(peopleUp.length){const {error}=await sb.from('people').upsert(peopleUp);if(error)throw error;changed=true;}
  const peopleDel=[...oldPeople.keys()].filter(id=>!newPeople.has(id));
  if(peopleDel.length){const {error}=await sb.from('people').delete().in('id',peopleDel);if(error)throw error;changed=true;}
  const oldAtt=new Map(attendanceRows(before).map(x=>[x.attendance_date+'|'+x.person_id,x]));
  const newAtt=new Map(attendanceRows(now).map(x=>[x.attendance_date+'|'+x.person_id,x]));
  const attUp=[...newAtt.values()].filter(x=>{const o=oldAtt.get(x.attendance_date+'|'+x.person_id);return !o||o.status!==x.status||o.marked_time!==x.marked_time;}).map(x=>({...x,updated_at:new Date().toISOString()}));
  if(attUp.length){const {error}=await sb.from('attendance').upsert(attUp,{onConflict:'attendance_date,person_id'});if(error)throw error;changed=true;}
  const attDel=[...oldAtt.values()].filter(x=>!newAtt.has(x.attendance_date+'|'+x.person_id));
  if(attDel.length){for(const x of attDel){const {error}=await sb.from('attendance').delete().eq('attendance_date',x.attendance_date).eq('person_id',x.person_id);if(error)throw error;}changed=true;}
  const oldRoles=before.roles||{},newRoles=now.roles||{};
  const roleUp=Object.keys(newRoles).filter(id=>!oldRoles[id]||!sameData(newRoles[id],oldRoles[id])).map(id=>({role_id:id,name:newRoles[id].name,system_role:!!newRoles[id].system,permissions:newRoles[id].perms||[]}));
  if(roleUp.length){const {error}=await sb.from('app_roles').upsert(roleUp);if(error)throw error;changed=true;}
  const roleDel=Object.keys(oldRoles).filter(id=>!newRoles[id]);
  if(roleDel.length){const {error}=await sb.from('app_roles').delete().in('role_id',roleDel);if(error)throw error;changed=true;}
  if(!sameData(before.brand,now.brand)||!sameData(before.settings,now.settings)||!sameData(before.times,now.times)){
    const {error}=await sb.from('app_settings').upsert({id:1,brand:now.brand,settings:now.settings,times:now.times,updated_at:new Date().toISOString()},{onConflict:'id'});
    if(error)throw error;changed=true;
  }
  cloudBaseline=now;
  if(changed)console.info('Cambios sincronizados con Supabase.');
}
async function loadCloudData(profile){
  cloudLoading=true;
  try{
    const [pr,pe,at,st,ro]=await Promise.all([
      sb.from('profiles').select('*'),sb.from('people').select('*'),sb.from('attendance').select('*'),
      sb.from('app_settings').select('*').eq('id',1).maybeSingle(),sb.from('app_roles').select('*')
    ]);
    for(const r of [pr,pe,at,st,ro])if(r.error)throw r.error;
    const profiles=pr.data||[];
    db.users=profiles.map(u=>({id:u.id,name:u.display_name,username:u.username,role:u.app_role||'',active:!!u.active,pending:!!u.pending,email:u.email||'',phone:u.phone||'',rec:''}));
    me=db.users.find(u=>u.id===profile.id)||{id:profile.id,name:profile.display_name,username:profile.username,role:profile.app_role,active:profile.active,pending:profile.pending,email:profile.email||'',phone:profile.phone||'',rec:''};
    db.people=(pe.data||[]).map(p=>({id:String(p.id),name:p.name,code:p.code||'',group:p.group_name||''}));
    db.att={};db.times={};
    (at.data||[]).forEach(a=>{(db.att[a.attendance_date]||(db.att[a.attendance_date]={}))[a.person_id]=a.status;if(a.marked_time)(db.times[a.attendance_date]||(db.times[a.attendance_date]={}))[a.person_id]=a.marked_time;});
    const settings=st.data;
    db.brand=Object.assign({name:'Sistema de Asistencias',tagline:'Control de asistencia con código QR',logo:'',accent:'marino'},settings&&settings.brand||{});
    db.settings=Object.assign({lateTime:'',allowSignup:false},settings&&settings.settings||{});
    if(settings&&settings.times&&typeof settings.times==='object')db.times=Object.assign(db.times,settings.times);
    db.roles={};(ro.data||[]).forEach(r=>{db.roles[r.role_id]={name:r.name,system:!!r.system_role,perms:Array.isArray(r.permissions)?r.permissions:[]};});
    if(!db.roles.admin)db.roles.admin={name:'Administrador',system:true,perms:Object.keys(PERMS)};
    if(!db.roles.director)db.roles.director={name:'Director',system:true,perms:['panel','reportes','personas_ver']};
    if(!db.roles.registrador)db.roles.registrador={name:'Registrador',system:true,perms:['panel','tomar','escanear','personas_ver']};
    db=normalizeDb(Object.assign({v:2,locks:{}},db));
    cloudBaseline=cloneData(db);lset(KEY,JSON.stringify(db));applyAccent();
  }finally{cloudLoading=false;}
}
function applyAccent(){document.documentElement.dataset.accent=db.brand.accent;}
const LOCK_MAX=5,LOCK_MIN=5;
function lockLeft(key){const l=db.locks[key];return (l&&l.until&&l.until>Date.now())?Math.ceil((l.until-Date.now())/60000):0;}
function addFail(key){
  const ks=Object.keys(db.locks);
  if(ks.length>200)ks.forEach(k=>{if(!(db.locks[k].until>Date.now()))delete db.locks[k];});
  const l=db.locks[key]||(db.locks[key]={n:0,until:0});
  if(l.until&&l.until<=Date.now()){l.n=0;l.until=0;}
  l.n++;
  if(l.n>=LOCK_MAX){l.until=Date.now()+LOCK_MIN*60000;l.n=0;}
  save();
}
function clearFails(key){if(db.locks[key]){delete db.locks[key];save();}}

const S={
  asis:{date:todayStr(),group:'',q:'',page:1},
  pers:{group:'',q:'',page:1},
  car:{group:'',q:'',page:1},
  rep:{from:monthStart(),to:todayStr(),group:'',q:'',page:1},
  usr:{q:'',page:1}
};
function dropTime(d,id){
  if(db.times[d]){delete db.times[d][id];if(!Object.keys(db.times[d]).length)delete db.times[d];}
}

/* ========== Permisos ========== */
function can(p){
  if(!me)return false;
  if(me.role==='admin')return true;
  if(ADMIN_ONLY.indexOf(p)>=0)return false;
  const r=db.roles[me.role];
  return !!r&&r.perms.indexOf(p)>=0;
}
const VIEWS=[
  {id:'panel',label:'Panel',perm:['panel']},
  {id:'escaner',label:'Escáner QR',perm:['escanear']},
  {id:'asistencia',label:'Asistencia',perm:['tomar']},
  {id:'personas',label:'Personas',perm:['personas_ver','personas_edit']},
  {id:'carnets',label:'Carnets QR',perm:['personas_edit']},
  {id:'reportes',label:'Reportes',perm:['reportes']},
  {id:'usuarios',label:'Usuarios',perm:['usuarios']},
  {id:'roles',label:'Roles',perm:['roles']},
  {id:'ajustes',label:'Ajustes',perm:['ajustes']}
];
const allowed=v=>v.perm.some(can);
const roleName=id=>(db.roles[id]&&db.roles[id].name)||'Sin rol';
const activeAdmins=()=>db.users.filter(u=>u.role==='admin'&&u.active).length;
const groups=()=>Array.from(new Set(db.people.map(p=>p.group).filter(Boolean))).sort(collator.compare);
function filterPeople(q,g){
  q=String(q||'').trim().toLowerCase();
  return db.people.filter(p=>{
    if(g&&p.group!==g)return false;
    if(q&&(p.name+' '+(p.code||'')).toLowerCase().indexOf(q)<0)return false;
    return true;
  }).sort((a,b)=>collator.compare(a.name,b.name));
}

/* ========== Marca y logo ========== */
function logoHtml(size,cls){
  const b=db.brand;
  if(b.logo)return '<img class="lg '+(cls||'')+'" src="'+esc(b.logo)+'" alt="Logo" style="width:'+size+'px;height:'+size+'px">';
  return '<span class="lg mono '+(cls||'')+'" style="width:'+size+'px;height:'+size+'px;font-size:'+Math.round(size*.42)+'px" aria-hidden="true">'+esc(initials(b.name))+'</span>';
}
function readLogo(file){
  return new Promise((res,rej)=>{
    if(!file||!/^image\//.test(file.type)){rej(new Error('Selecciona una imagen (PNG, JPG, SVG o WebP).'));return;}
    const fr=new FileReader();
    fr.onerror=()=>rej(new Error('No se pudo leer el archivo.'));
    fr.onload=()=>{
      const img=new Image();
      img.onerror=()=>rej(new Error('No se pudo abrir la imagen.'));
      img.onload=()=>{
        const w0=img.naturalWidth||256,h0=img.naturalHeight||256,k=Math.min(1,256/Math.max(w0,h0));
        const c=document.createElement('canvas');
        c.width=Math.max(1,Math.round(w0*k));c.height=Math.max(1,Math.round(h0*k));
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        try{res(c.toDataURL('image/png'));}catch(e){rej(new Error('No se pudo procesar la imagen.'));}
      };
      img.src=fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ========== Código QR ========== */
const qrCache={};
const qrText=p=>'ASIST|'+p.id;
function qrUrl(p){
  const t=qrText(p);
  if(qrCache[t])return qrCache[t];
  if(typeof qrcode!=='function')return null;
  try{
    const q=qrcode(0,'M');q.addData(t);q.make();
    return (qrCache[t]=q.createDataURL(6,2));
  }catch(e){return null;}
}
function carnetHtml(p){
  const u=qrUrl(p);
  return '<article class="carnet"><div class="cb">'+logoHtml(34)+'<b>'+esc(db.brand.name)+'</b></div><div class="cn"><h3>'+esc(p.name)+'</h3><div class="sub">'+esc([p.group,p.code].filter(Boolean).join(' · ')||'—')+'</div></div>'+
  (u?'<img class="qr" src="'+u+'" alt="Código QR de '+esc(p.name)+'">':'<div class="qr noqr">QR no disponible</div>')+
  '<div class="cf">Presenta este código al ingresar</div></article>';
}
function printNow(modal){
  document.body.classList.toggle('pm',!!modal);
  try{window.print();}catch(e){toast('Usa Ctrl+P para imprimir');}
  setTimeout(()=>document.body.classList.remove('pm'),600);
}
function qrModal(p){
  openModal('Código QR de la persona',carnetHtml(p)+'<p class="sub" style="text-align:center;margin-top:10px">Mantén presionada la imagen del QR para guardarla, o imprime el carnet.</p><div class="row end modal-actions"><button class="btn" data-close>Cerrar</button><button class="btn primary" id="pq">Imprimir</button></div>',r=>{
    $('#pq',r).onclick=()=>printNow(true);
  });
}

/* ========== Interfaz común ========== */
let toastT;
function toast(msg){
  const t=$('#toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2800);
}
function openModal(title,body,mount){
  const root=$('#modal');
  root.innerHTML='<div class="ov" role="dialog" aria-modal="true"><div class="dlg"><div class="dh"><h2>'+esc(title)+'</h2><button class="x" data-close aria-label="Cerrar">✕</button></div><div class="db">'+body+'</div></div></div>';
  const close=()=>{root.innerHTML='';};
  root.onclick=e=>{if(e.target.classList.contains('ov')||e.target.closest('[data-close]'))close();};
  if(mount)mount(root,close);
  const f=root.querySelector('input:not([type=checkbox]),textarea,select');
  if(f)f.focus();
  return close;
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#modal').innerHTML='';});

function confirmDlg(msg,ok,danger){
  ok=ok||'Eliminar';
  return new Promise(res=>{
    openModal('Confirmar','<p>'+esc(msg)+'</p><div class="row end"><button class="btn" data-close>Cancelar</button><button class="btn '+(danger===false?'primary':'danger')+'" id="cok">'+esc(ok)+'</button></div>',(r,cl)=>{
      $('#cok',r).onclick=()=>{cl();res(true);};
      r.addEventListener('click',e=>{if(e.target.classList.contains('ov')||e.target.closest('[data-close]'))res(false);});
    });
  });
}
function copyModal(title,text,hint){
  openModal(title,'<p class="muted">'+esc(hint)+'</p><textarea id="ct" rows="12" readonly>'+esc(text)+'</textarea><div class="row end"><button class="btn" data-close>Cerrar</button><button class="btn primary" id="cp">Copiar</button></div>',r=>{
    const ta=$('#ct',r);ta.onfocus=()=>ta.select();
    $('#cp',r).onclick=async()=>{
      ta.select();let ok=false;
      try{await navigator.clipboard.writeText(text);ok=true;}catch(e){}
      if(!ok){try{ok=document.execCommand('copy');}catch(e){}}
      toast(ok?'Copiado al portapapeles':'Selecciona el texto y copia con Ctrl+C');
    };
  });
}
const tsv=rows=>rows.map(r=>r.map(c=>String(c==null?'':c).replace(/[\t\r\n]+/g,' ')).join('\t')).join('\n');

function paginate(list,page,size){
  size=size||50;
  const pages=Math.max(1,Math.ceil(list.length/size));
  page=Math.min(Math.max(1,page),pages);
  const a=(page-1)*size;
  const items=list.slice(a,a+size);
  const html=list.length>size?'<div class="pager"><span>Mostrando '+(a+1)+'–'+(a+items.length)+' de '+list.length+'</span><span class="row"><button class="btn sm" data-pg="'+(page-1)+'" '+(page<=1?'disabled':'')+'>← Anterior</button><span>Página '+page+' de '+pages+'</span><button class="btn sm" data-pg="'+(page+1)+'" '+(page>=pages?'disabled':'')+'>Siguiente →</button></span></div>':(list.length?'<div class="pager"><span>'+list.length+' registro'+(list.length===1?'':'s')+'</span></div>':'');
  return {items:items,page:page,html:html};
}
function groupOptions(sel,all){
  return (all?'<option value="">Todos los grupos</option>':'')+groups().map(g=>'<option value="'+esc(g)+'"'+(g===sel?' selected':'')+'>'+esc(g)+'</option>').join('');
}

/* ========== Acceso ========== */
function authShell(inner){
  const b=db.brand;
  app.innerHTML='<div class="authwrap"><aside class="hero"><div class="hc">'+logoHtml(84)+'<h1>'+esc(b.name)+'</h1><p>'+esc(b.tagline)+'</p><ul><li>Registro de entradas con código QR</li><li>Roles y permisos por cada usuario</li><li>Reportes claros de asistencia</li></ul></div></aside><section class="authform"><div class="card">'+inner+'</div></section></div>';
}
let nagged=false;
function renderWelcome(){
  if(sb){renderLogin();return;}
  document.title=db.brand.name;
  const first=!db.users.length,open=first||db.settings.allowSignup!==false,b=db.brand;
  const field=(label,name,type,extra)=>'<label>'+label+'<input name="'+name+'" type="'+type+'" required '+(extra||'')+'></label>';
  let form='';
  if(first){
    form='<form id="f" class="stack" style="margin-top:14px">'+field('Nombre de la institución','org','text','placeholder="Ej: Colegio San Martín"')+field('Tu nombre completo','name','text','autocomplete="name"')+field('Usuario','username','text','autocomplete="username"')+field('Correo de recuperación','email','email','autocomplete="email"')+field('Teléfono de recuperación','phone','tel','autocomplete="tel"')+field('Contraseña (mínimo 6 caracteres)','p1','password','minlength="6" autocomplete="new-password"')+field('Repite la contraseña','p2','password','minlength="6" autocomplete="new-password"')+'<div id="err" class="err" role="alert"></div><button class="btn primary">Registrarme como administrador</button></form>';
  }else if(open){
    form='<form id="f" class="stack" style="margin-top:14px">'+field('Nombre completo','name','text','autocomplete="name"')+field('Usuario','username','text','autocomplete="username"')+field('Correo de recuperación','email','email','autocomplete="email"')+field('Teléfono de recuperación','phone','tel','autocomplete="tel"')+field('Contraseña (mínimo 6 caracteres)','p1','password','minlength="6" autocomplete="new-password"')+field('Repite la contraseña','p2','password','minlength="6" autocomplete="new-password"')+'<div id="err" class="err" role="alert"></div><button class="btn primary">Registrarme</button></form><p class="sub" style="margin-top:8px">Tu cuenta quedará pendiente hasta que un administrador la apruebe y te asigne un rol.</p>';
  }else{
    form='<p class="muted" style="margin-top:14px">El registro de cuentas nuevas está cerrado. Pide a un administrador que cree tu cuenta y luego accede.</p>';
  }
  app.innerHTML='<div class="wpage"><div class="wcard"><div class="wbrand">'+logoHtml(56)+'<div class="bname" style="color:var(--text)">'+esc(b.name)+'</div></div><h1>Bienvenido</h1><p class="muted">'+(open?'Regístrate para poder continuar.':'Accede con tu cuenta para continuar.')+'</p>'+form+'<div class="wsep"><span>¿Ya tienes una cuenta?</span></div><button class="btn primary wbtn" id="ac">Acceder</button></div></div>';
  $('#ac').onclick=renderLogin;
  const f=$('#f');
  if(!f)return;
  f.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target),err=$('#err');
    const name=String(fd.get('name')).trim(),username=normUser(fd.get('username')),p1=String(fd.get('p1')),p2=String(fd.get('p2'));
    const email=normEmail(fd.get('email')),phone=String(fd.get('phone')||'').trim();
    const org=first?String(fd.get('org')).trim():'';
    if(!name||!username||(first&&!org)){err.textContent='Completa todos los campos.';return;}
    if(db.users.some(u=>u.username===username)){err.textContent='Ese usuario ya existe. Elige otro.';return;}
    if(!email||!okEmail(email)){err.textContent='Ingresa un correo de recuperación válido.';return;}
    if(!phone||!okPhone(phone)){err.textContent='Ingresa un teléfono de recuperación válido (de 6 a 15 dígitos).';return;}
    if(p1.length<6){err.textContent='La contraseña debe tener al menos 6 caracteres.';return;}
    if(p1!==p2){err.textContent='Las contraseñas no coinciden.';return;}
    const code=genCode(),rec=await hash('rec:'+normCode(code)),pass=await hash(p1);
    if(first){
      db.brand.name=org;
      const u={id:uid(),name:name,username:username,pass:pass,role:'admin',active:true,pending:false,email:email,phone:phone,rec:rec};
      db.users.push(u);save();
      me=u;setSession(u.id);renderApp();
      showCodeModal(code,u.name,true);
    }else{
      db.users.push({id:uid(),name:name,username:username,pass:pass,role:'',active:false,pending:true,email:email,phone:phone,rec:rec});
      save();renderLogin();
      toast('Solicitud enviada. Un administrador debe aprobar tu cuenta.');
      showCodeModal(code,name,true);
    }
  };
}
function renderReset(){
  document.title=db.brand.name;
  authShell('<h2>Restablecer el sistema</h2><p class="muted">Úsalo solo si olvidaste tu contraseña y no puedes entrar. <b>Se borrarán todos los usuarios, personas, asistencias y ajustes guardados en este navegador.</b> No se puede deshacer.</p><form id="f" class="stack" style="margin-top:10px"><label>Escribe BORRAR TODO para confirmar<input name="c" required autocomplete="off"></label><div id="err" class="err" role="alert"></div><button class="btn danger">Borrar todo y empezar de nuevo</button><button type="button" class="link" id="bk">← Cancelar</button></form>');
  const clearHash=()=>{try{history.replaceState(null,'',location.pathname+location.search);}catch(e){}};
  $('#bk').onclick=()=>{clearHash();boot();};
  $('#f').onsubmit=e=>{
    e.preventDefault();
    if(String(new FormData(e.target).get('c')).trim().toUpperCase()!=='BORRAR TODO'){$('#err').textContent='Escribe exactamente BORRAR TODO.';return;}
    db=freshDb();save();applyAccent();
    me=null;nagged=false;setSession(null);clearHash();
    renderWelcome();
    toast('Sistema restablecido. Registra la nueva cuenta de administrador.');
  };
}
function renderLogin(){
  document.title=db.brand.name;
  if(!sb){authShell('<h2>No se pudo conectar</h2><p class="muted">No se cargó la biblioteca de Supabase. Comprueba tu conexión a internet y vuelve a cargar la página.</p>');return;}
  authShell('<h2>Iniciar sesión</h2><p class="muted">Ingresa con el correo y la contraseña de tu cuenta de Supabase.</p><form id="f" class="stack" style="margin-top:10px"><label>Correo electrónico<input name="email" type="email" required autocomplete="username" value=""></label><label>Contraseña<input name="pass" type="password" required autocomplete="current-password"></label><div id="err" class="err" role="alert"></div><button class="btn primary">Entrar</button><button type="button" class="link" id="fg">Enviar enlace para restablecer contraseña</button></form>');
  $('#fg').onclick=async()=>{const email=normEmail($('#f [name=email]').value);if(!okEmail(email)){$('#err').textContent='Escribe primero tu correo electrónico.';return;}const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});$('#err').textContent=error?'No se pudo enviar el enlace: '+error.message:'Si el correo está registrado, recibirás un enlace para restablecer la contraseña.';};
  $('#f').onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(e.target),email=normEmail(fd.get('email')),password=String(fd.get('pass'));const btn=$('#f button[type=submit]')||$('#f .primary');btn.disabled=true;$('#err').textContent='Conectando con Supabase…';
    try{
      const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;
      const {data:profile,error:pe}=await sb.from('profiles').select('*').eq('id',data.user.id).single();if(pe)throw pe;
      if(!profile.active||profile.pending){await sb.auth.signOut();throw new Error(profile.pending?'La cuenta está pendiente de aprobación.':'La cuenta está desactivada.');}
      cloudUser=data.user;await loadCloudData(profile);me=db.users.find(u=>u.id===profile.id)||me;setSession(me.id);renderApp();
    }catch(err){console.error(err);$('#err').textContent=err.message==='Invalid login credentials'?'Correo o contraseña incorrectos.':(err.message||'No se pudo iniciar sesión.');}
    finally{const b=$('#f .primary');if(b)b.disabled=false;}
  };
}
function renderRecover(){
  if(sb){renderLogin();return;}
  document.title=db.brand.name;
  authShell('<h2>Recuperar contraseña</h2><p class="muted">Ingresa tu usuario, el correo o teléfono vinculado y tu código de recuperación.</p><form id="f" class="stack" style="margin-top:10px"><label>Usuario<input name="username" required autocomplete="username"></label><label>Correo o teléfono vinculado<input name="contact" autocomplete="off"></label><label>Código de recuperación<input name="code" required autocomplete="off" placeholder="XXXX-XXXX-XXXX"></label><label>Nueva contraseña (mín. 6)<input name="p1" type="password" required minlength="6" autocomplete="new-password"></label><label>Repite la nueva contraseña<input name="p2" type="password" required minlength="6" autocomplete="new-password"></label><div id="err" class="err" role="alert"></div><button class="btn primary">Restablecer contraseña</button><button type="button" class="link" id="bk">← Volver a iniciar sesión</button></form><p class="sub" style="margin-top:12px">Este sistema no envía correos ni mensajes: el correo o teléfono se usan para verificar tu identidad junto con el código. Si perdiste el código, pide a un administrador que genere uno nuevo.</p>');
  $('#bk').onclick=renderLogin;
  $('#f').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target),un=normUser(fd.get('username')),key='rec:'+un;
    const w=lockLeft(key);
    if(w){$('#err').textContent='Demasiados intentos. Vuelve a intentarlo en '+w+' min.';return;}
    const p1=String(fd.get('p1')),p2=String(fd.get('p2'));
    if(p1.length<6){$('#err').textContent='La contraseña debe tener al menos 6 caracteres.';return;}
    if(p1!==p2){$('#err').textContent='Las contraseñas no coinciden.';return;}
    const u=db.users.find(x=>x.username===un&&x.active);
    let ok=false;
    if(u&&u.rec){
      const codeOk=(await hash('rec:'+normCode(fd.get('code'))))===u.rec;
      const c=String(fd.get('contact')||'').trim(),has=!!(u.email||u.phone);
      const contactOk=!has||(u.email&&normEmail(c)===u.email)||(u.phone&&normPhone(c)&&normPhone(c)===normPhone(u.phone));
      ok=codeOk&&contactOk;
    }
    if(!ok){addFail(key);$('#err').textContent='Los datos no coinciden. Revisa el usuario, el contacto y el código.';return;}
    clearFails(key);
    u.pass=await hash(p1);
    const nc=genCode();u.rec=await hash('rec:'+normCode(nc));
    save();renderLogin();
    toast('Contraseña restablecida. Ya puedes iniciar sesión.');
    showCodeModal(nc,u.name,true);
  };
}
async function logout(){stopCam();if(sb){try{await sb.auth.signOut();}catch(e){console.error(e);}cloudUser=null;cloudBaseline=null;}me=null;nagged=false;setSession(null);renderLogin();}

function showCodeModal(code,name,own){
  openModal('Código de recuperación','<p>'+(own?'Guarda este código en un lugar seguro. <b>Se muestra una sola vez</b>. Lo necesitarás, junto con tu usuario, para restablecer tu contraseña.':'Entrega este código a <b>'+esc(name)+'</b>. <b>Se muestra una sola vez</b> y le servirá para restablecer su contraseña.')+'</p><div class="codebox" id="cbx">'+esc(code)+'</div><p class="sub" style="margin-top:10px">Si lo pierdes, se puede generar uno nuevo; el anterior dejará de funcionar.</p><div class="row end"><button class="btn" id="cc">Copiar</button><button class="btn primary" data-close>Ya lo guardé</button></div>',r=>{
    $('#cc',r).onclick=async()=>{
      let ok=false;
      try{await navigator.clipboard.writeText(code);ok=true;}catch(e){}
      if(!ok){try{const rg=document.createRange();rg.selectNodeContents($('#cbx',r));const sl=window.getSelection();sl.removeAllRanges();sl.addRange(rg);ok=document.execCommand('copy');}catch(e){}}
      toast(ok?'Código copiado':'Selecciona el código y copia con Ctrl+C');
    };
  });
}
function askPass(cb){
  openModal('Confirma tu contraseña','<form id="f" class="stack"><label>Contraseña actual<input name="p" type="password" required autocomplete="current-password"></label><div id="err" class="err"></div><div class="row end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Continuar</button></div></form>',(r,close)=>{
    $('#f',r).onsubmit=async e=>{
      e.preventDefault();
      if(await hash(String(new FormData(e.target).get('p')))!==me.pass){$('#err',r).textContent='La contraseña no es correcta.';return;}
      close();cb();
    };
  });
}
async function issueCode(u,self){
  const code=genCode();
  u.rec=await hash('rec:'+normCode(code));
  save();
  showCodeModal(code,u.name,self);
  if(cur==='usuarios'&&$('#tbl'))usrDraw();
}
function recoveryModal(u,self){
  openModal(self?'Mi cuenta':'Recuperación de '+u.name,
  '<form id="f" class="stack"><p class="muted">'+(self?'Vincula un correo y un teléfono para poder recuperar tu contraseña si la olvidas.':'Datos de verificación de este usuario.')+'</p><label>Correo de recuperación<input name="email" type="email" required value="'+esc(u.email)+'"></label><label>Teléfono de recuperación<input name="phone" type="tel" required value="'+esc(u.phone)+'"></label><div id="err" class="err"></div><div class="row"><button class="btn primary">Guardar contacto</button></div></form>'+
  '<hr style="border:0;border-top:1px solid var(--border);margin:16px 0"><div class="stack"><div>Código de recuperación: <span class="pill '+(u.rec?'ok':'warn')+'">'+(u.rec?'Activo':'No generado')+'</span></div><div class="row"><button class="btn" id="nc">Generar nuevo código</button>'+(self?'<button class="btn" id="cp">Cambiar contraseña</button>':'')+'</div><p class="sub">Esta versión no envía correos ni SMS. El correo o teléfono se piden como verificación junto con el código de recuperación.</p></div>',
  (r,close)=>{
    $('#f',r).onsubmit=e=>{
      e.preventDefault();const fd=new FormData(e.target);
      const email=normEmail(fd.get('email')),phone=String(fd.get('phone')||'').trim();
      if(!email||!okEmail(email)){$('#err',r).textContent='Ingresa un correo de recuperación válido.';return;}
      if(!phone||!okPhone(phone)){$('#err',r).textContent='Ingresa un teléfono de recuperación válido (de 6 a 15 dígitos).';return;}
      u.email=email;u.phone=phone;save();
      if(cur==='usuarios'&&$('#tbl'))usrDraw();
      if(!u.rec){issueCode(u,self);}else{close();toast('Contacto guardado');}
    };
    $('#nc',r).onclick=()=>{
      if(self)askPass(()=>issueCode(u,true));
      else confirmDlg('¿Generar un nuevo código para '+u.name+'? El anterior dejará de funcionar.','Generar',false).then(ok=>{if(ok)issueCode(u,false);});
    };
    if(self)$('#cp',r).onclick=changeOwnPass;
  });
}
function nagRecovery(){
  if(sb)return;
  if(nagged||!me||(me.rec&&me.email&&me.phone))return;
  nagged=true;
  openModal('Protege tu cuenta','<p>La recuperación de contraseña de tu cuenta no está completa. Vincula un correo y un teléfono, y genera tu código para poder recuperar el acceso si la olvidas.</p><div class="row end"><button class="btn" data-close>Más tarde</button><button class="btn primary" id="go">Configurar ahora</button></div>',r=>{
    $('#go',r).onclick=()=>recoveryModal(me,true);
  });
}

/* ========== Estructura principal ========== */
function renderApp(start){
  document.title=db.brand.name;
  const nav=VIEWS.filter(allowed).map(v=>'<button data-v="'+v.id+'">'+v.label+'</button>').join('');
  app.innerHTML='<header class="top noprint"><div class="brandbox">'+logoHtml(40)+'<div><div class="bname">'+esc(db.brand.name)+'</div><div class="bsub">'+esc(db.brand.tagline)+'</div></div></div><nav class="nav" aria-label="Secciones">'+nav+'</nav><div class="who"><div class="chip"><b>'+esc(me.name)+'</b>'+esc(roleName(me.role))+'</div><button class="btn sm" id="th" title="Cambiar tema claro/oscuro" aria-label="Cambiar tema">🌓</button><button class="btn sm" id="mp">Mi cuenta</button><button class="btn sm" id="lo">Salir</button></div></header><main id="view"></main>';
  $('.nav',app).onclick=e=>{const b=e.target.closest('button[data-v]');if(b)go(b.dataset.v);};
  $('#th').onclick=toggleTheme;
  $('#lo').onclick=logout;
  $('#mp').onclick=()=>{if(sb){openModal('Mi cuenta','<p class="muted">Sesión iniciada con '+esc(me.email||'tu cuenta de Supabase')+'.</p><button class="btn primary" id="cpass">Cambiar contraseña</button>',r=>{$('#cpass',r).onclick=changeCloudPass;});}else recoveryModal(me,true);};
  const ok=start&&VIEWS.some(v=>v.id===start&&allowed(v));
  const first=VIEWS.find(allowed);
  go(ok?start:(first?first.id:'none'));
  if(!start)nagRecovery();
}
const R={};
function go(id){
  stopCam();
  const v=VIEWS.find(x=>x.id===id&&allowed(x))||VIEWS.find(allowed);
  view=$('#view');
  if(!v){view.innerHTML='<div class="card"><h2>Sin permisos</h2><p class="muted">Tu rol todavía no tiene secciones asignadas. Pide a un administrador que lo configure.</p></div>';return;}
  cur=v.id;
  $$('.nav button').forEach(b=>b.classList.toggle('on',b.dataset.v===cur));
  R[cur]();
  window.scrollTo(0,0);
}
function toggleTheme(){
  const root=document.documentElement;
  const dark=root.dataset.theme?root.dataset.theme==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme=dark?'light':'dark';
  lset(TKEY,root.dataset.theme);
}
function changeCloudPass(){
  openModal('Cambiar contraseña','<form id="f" class="stack"><label>Nueva contraseña (mín. 6 caracteres)<input name="p1" type="password" required minlength="6" autocomplete="new-password"></label><label>Repite la contraseña<input name="p2" type="password" required minlength="6" autocomplete="new-password"></label><div id="err" class="err"></div><div class="row end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>',(r,close)=>{
    $('#f',r).onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),p1=String(fd.get('p1')),p2=String(fd.get('p2'));if(p1.length<6){$('#err',r).textContent='La contraseña debe tener al menos 6 caracteres.';return;}if(p1!==p2){$('#err',r).textContent='Las contraseñas no coinciden.';return;}const {error}=await sb.auth.updateUser({password:p1});if(error){$('#err',r).textContent='No se pudo cambiar la contraseña: '+error.message;return;}close();toast('Contraseña de Supabase actualizada.');};
  });
}
function changeOwnPass(){
  openModal('Cambiar mi contraseña','<form id="f" class="stack"><label>Contraseña actual<input name="a" type="password" required autocomplete="current-password"></label><label>Nueva contraseña (mín. 6)<input name="b" type="password" required minlength="6" autocomplete="new-password"></label><div id="err" class="err"></div><div class="row end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>',(r,close)=>{
    $('#f',r).onsubmit=async e=>{
      e.preventDefault();const fd=new FormData(e.target);
      if(await hash(String(fd.get('a')))!==me.pass){$('#err',r).textContent='La contraseña actual no es correcta.';return;}
      me.pass=await hash(String(fd.get('b')));save();close();toast('Contraseña actualizada');
    };
  });
}

/* ========== Panel ========== */
R.panel=function(){
  const t=todayStr(),rec=db.att[t]||{};
  const c={P:0,T:0,J:0,F:0};let marked=0;
  db.people.forEach(p=>{const s=rec[p.id];if(s){c[s]++;marked++;}});
  const total=db.people.length,pct=marked?Math.round((c.P+c.T)/marked*100):0;
  const viaQr=Object.keys(db.times[t]||{}).length;
  const pend=can('usuarios')?db.users.filter(u=>u.pending).length:0;
  const h=new Date().getHours(),sal=h<12?'Buenos días':(h<19?'Buenas tardes':'Buenas noches');
  let bars='';
  for(let i=6;i>=0;i--){
    const d=new Date();d.setDate(d.getDate()-i);const ds=dstr(d),r=db.att[ds];
    let n=0,ok=0;
    if(r){for(const k in r){n++;if(r[k]==='P'||r[k]==='T')ok++;}}
    const p=n?Math.round(ok/n*100):null;
    bars+='<div class="bar" title="'+esc(fmtLong(ds))+(p==null?': sin registro':': '+p+'%')+'"><span>'+(p==null?'—':p+'%')+'</span><i class="'+(p==null?'none':'')+'" style="height:'+(p==null?3:Math.max(3,p))+'%"></i><span>'+esc(fmtWd(ds))+'</span></div>';
  }
  view.innerHTML='<div class="welcome"><h1>'+sal+', '+esc(me.name.split(' ')[0])+'</h1><p>'+esc(fmtLong(t))+' · '+esc(db.brand.name)+'</p></div>'+(pend?'<div class="card" style="margin-bottom:16px;border-left:4px solid var(--warn);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><span><b>'+pend+(pend===1?' solicitud de registro pendiente':' solicitudes de registro pendientes')+'</b><br><span class="sub">Apruébalas y asígnales un rol en la sección Usuarios.</span></span><button class="btn sm primary" id="gp">Revisar</button></div>':'')+
  '<div class="grid" style="margin-bottom:16px">'+
  '<div class="card stat s-gold"><span class="n">'+total+'</span><span class="l">Personas registradas</span></div>'+
  '<div class="card stat s-ok"><span class="n" style="color:var(--ok)">'+c.P+'</span><span class="l">Presentes hoy</span></div>'+
  '<div class="card stat s-warn"><span class="n" style="color:var(--warn)">'+c.T+'</span><span class="l">Tardanzas hoy</span></div>'+
  '<div class="card stat s-bad"><span class="n" style="color:var(--bad)">'+c.F+'</span><span class="l">Faltas hoy</span></div>'+
  '<div class="card stat s-info"><span class="n" style="color:var(--info)">'+c.J+'</span><span class="l">Justificadas hoy</span></div>'+
  '<div class="card stat"><span class="n">'+pct+'%</span><span class="l">Asistencia de hoy · '+(total-marked)+' sin registrar · '+viaQr+' por QR</span></div>'+
  '</div><div class="card"><h2>Asistencia de los últimos 7 días</h2><p class="sub">Porcentaje de presentes y tardanzas sobre las personas registradas ese día.</p><div class="bars">'+bars+'</div></div>';
  const gp=$('#gp');if(gp)gp.onclick=()=>go('usuarios');
};

/* ========== Escáner QR ========== */
let stream=null,scanTimer=0,detector=null,lastCode='',lastAt=0,actx=null;
const recent=[];
function beep(f,d){
  try{
    actx=actx||new (window.AudioContext||window.webkitAudioContext)();
    const o=actx.createOscillator(),g=actx.createGain();
    o.frequency.value=f;g.gain.value=.08;o.connect(g);g.connect(actx.destination);
    o.start();o.stop(actx.currentTime+d);
  }catch(e){}
}
function stopCam(){
  clearTimeout(scanTimer);scanTimer=0;
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  const v=$('#vid');if(v)v.srcObject=null;
}
function findByCode(raw){
  raw=String(raw||'').trim();if(!raw)return null;
  if(raw.indexOf('ASIST|')===0){const id=raw.slice(6);return db.people.find(p=>p.id===id)||null;}
  const l=raw.toLowerCase();
  return db.people.find(p=>p.id===raw||(p.code&&String(p.code).toLowerCase()===l))||null;
}
function markScan(p){
  const date=todayStr(),rec=db.att[date]||(db.att[date]={});
  const prev=rec[p.id];
  if(prev==='P'||prev==='T')return {dup:true,s:prev,time:(db.times[date]||{})[p.id]||''};
  const now=new Date(),hhmm=pad(now.getHours())+':'+pad(now.getMinutes());
  const late=db.settings.lateTime&&hhmm>db.settings.lateTime;
  const s=late?'T':'P';
  rec[p.id]=s;(db.times[date]||(db.times[date]={}))[p.id]=hhmm;
  save();
  return {dup:false,s:s,time:hhmm};
}
function showRes(kind,icon,title,sub){
  const el=$('#res');if(!el)return;
  el.className='res '+kind;
  el.innerHTML='<div class="ri">'+icon+'</div><div><b class="rt">'+esc(title)+'</b><div class="rs">'+esc(sub||'')+'</div></div>';
  el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop');
}
function drawRecent(){
  const el=$('#rec');if(!el)return;
  el.innerHTML=recent.length?recent.map(r=>'<div class="rec"><span>'+esc(r.name)+(r.group?' <span class="sub">· '+esc(r.group)+'</span>':'')+'</span><span><span class="pill '+r.c+'">'+esc(r.label)+'</span> <span class="sub">'+esc(r.time)+'</span></span></div>').join(''):'<p class="muted">Aún no hay lecturas en esta sesión.</p>';
}
function processScan(raw){
  const p=findByCode(raw);
  const now=new Date(),hhmm=pad(now.getHours())+':'+pad(now.getMinutes());
  if(!p){
    showRes('bad','✕','Código no reconocido','Verifica que el QR pertenezca a una persona registrada.');
    beep(220,.35);
    recent.unshift({name:'Código desconocido',group:'',c:'bad',label:'Rechazado',time:hhmm});
  }else{
    const m=markScan(p),g=p.group?p.group+' · ':'';
    if(m.dup){
      showRes('info','•',p.name,g+'Ya registrado hoy'+(m.time?' a las '+m.time:'')+' ('+STATUS[m.s].l+')');
      beep(440,.15);
      recent.unshift({name:p.name,group:p.group,c:'info',label:'Ya registrado',time:hhmm});
    }else if(m.s==='T'){
      showRes('warn','!',p.name,g+'Entrada con tardanza · '+m.time);
      beep(660,.25);
      recent.unshift({name:p.name,group:p.group,c:'warn',label:'Tarde',time:m.time});
    }else{
      showRes('ok','✓',p.name,g+'Entrada registrada · '+m.time);
      beep(880,.18);
      recent.unshift({name:p.name,group:p.group,c:'ok',label:'Presente',time:m.time});
    }
  }
  if(recent.length>12)recent.length=12;
  drawRecent();
}
async function camLoop(){
  if(!stream)return;
  const v=$('#vid');
  if(v&&v.readyState>=2&&v.videoWidth){
    let code=null;
    if(detector){
      try{const r=await detector.detect(v);if(r.length)code=r[0].rawValue;}catch(e){}
    }else if(typeof jsQR==='function'){
      const c=camLoop.cv||(camLoop.cv=document.createElement('canvas'));
      const k=Math.min(1,640/v.videoWidth);
      c.width=Math.round(v.videoWidth*k);c.height=Math.round(v.videoHeight*k);
      const ctx=c.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(v,0,0,c.width,c.height);
      const im=ctx.getImageData(0,0,c.width,c.height);
      const r=jsQR(im.data,c.width,c.height,{inversionAttempts:'dontInvert'});
      if(r)code=r.data;
    }
    if(code){
      const t=Date.now();
      if(code!==lastCode||t-lastAt>3500){lastCode=code;lastAt=t;processScan(code);}
    }
  }
  scanTimer=setTimeout(camLoop,130);
}
async function startCam(){
  const err=$('#cerr');err.textContent='';
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    err.textContent='Este navegador no permite usar la cámara aquí. Usa un lector de códigos o escribe el código manualmente.';return;
  }
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
  }catch(e){
    err.textContent=(e&&e.name==='NotAllowedError')?'Permiso de cámara denegado. Habilítalo en el navegador; si la página está incrustada, ábrela en una pestaña completa.':'No se pudo abrir la cámara ('+((e&&e.name)||'error')+').';
    return;
  }
  const v=$('#vid');v.srcObject=stream;
  try{await v.play();}catch(e){}
  detector=null;
  if('BarcodeDetector' in window){try{detector=new BarcodeDetector({formats:['qr_code']});}catch(e){detector=null;}}
  if(!detector&&typeof jsQR!=='function'){err.textContent='No se pudo cargar el lector de QR. Revisa tu conexión a internet.';stopCam();return;}
  $('#cp').hidden=true;$('#fr').hidden=false;$('#cs').hidden=true;$('#cx').hidden=false;
  beep(1,.01);
  camLoop();
}
R.escaner=function(){
  const late=db.settings.lateTime;
  view.innerHTML='<div class="ph"><div><h1>Escáner de asistencia</h1><p class="muted">Muestra el QR de la persona a la cámara y su entrada se registra al instante.'+(late?' Después de las '+esc(late)+' se marca como tardanza.':'')+'</p></div>'+(can('tomar')?'<button class="btn" id="mn">Registro manual</button>':'')+'</div>'+
  '<div class="grid2"><div class="stack"><div class="cam"><video id="vid" playsinline muted></video><div class="frame" id="fr" hidden></div><div class="campl" id="cp">Cámara apagada.<br>Pulsa “Activar cámara” para comenzar.</div></div>'+
  '<div class="row"><button class="btn primary" id="cs">Activar cámara</button><button class="btn" id="cx" hidden>Detener cámara</button></div><div id="cerr" class="err" role="alert"></div>'+
  '<form id="mf" class="row" style="flex-wrap:nowrap"><input id="code" placeholder="Lector USB o código manual" autocomplete="off" aria-label="Código de la persona"><button class="btn">Registrar</button></form>'+
  '<p class="sub">¿Usas un lector de códigos USB o Bluetooth? Haz clic en el campo y escanea. También puedes escribir el código de la persona.</p></div>'+
  '<div class="stack"><div class="res" id="res"><div class="ri">⌖</div><div><b class="rt">Esperando lectura…</b><div class="rs">El resultado aparecerá aquí.</div></div></div><div class="card"><h3>Últimos registros</h3><div id="rec"></div></div></div></div>';
  $('#cs').onclick=startCam;
  $('#cx').onclick=()=>{stopCam();$('#cp').hidden=false;$('#fr').hidden=true;$('#cs').hidden=false;$('#cx').hidden=true;};
  $('#mf').onsubmit=e=>{e.preventDefault();const i=$('#code'),v=i.value.trim();i.value='';if(v)processScan(v);i.focus();};
  const mn=$('#mn');if(mn)mn.onclick=()=>go('asistencia');
  drawRecent();
};

/* ========== Tomar asistencia (manual) ========== */
R.asistencia=function(){
  const st=S.asis;
  view.innerHTML='<div class="ph"><div><h1>Asistencia manual</h1><p class="muted" id="dl"></p></div><div class="row"><button class="btn" id="ap">Marcar todos presentes</button><button class="btn danger" id="cl">Limpiar</button></div></div>'+
  '<div class="tools"><label>Fecha<input type="date" id="dt" value="'+esc(st.date)+'"></label><label>Grupo<select id="gr">'+groupOptions(st.group,true)+'</select></label><label>Buscar<input id="q" placeholder="Nombre o código" value="'+esc(st.q)+'"></label></div>'+
  '<div class="row" id="sum" style="margin-bottom:12px"></div><div id="tbl"></div>';
  $('#dt').onchange=e=>{if(e.target.value){st.date=e.target.value;st.page=1;asisDraw();}};
  $('#gr').onchange=e=>{st.group=e.target.value;st.page=1;asisDraw();};
  $('#q').oninput=e=>{st.q=e.target.value;st.page=1;asisDraw();};
  $('#ap').onclick=()=>{
    const list=filterPeople(st.q,st.group);if(!list.length)return;
    const rec=db.att[st.date]||(db.att[st.date]={});
    list.forEach(p=>{rec[p.id]='P';dropTime(st.date,p.id);});save();asisDraw();toast(list.length+' marcados como presentes');
  };
  $('#cl').onclick=async()=>{
    const list=filterPeople(st.q,st.group);if(!list.length)return;
    if(!(await confirmDlg('¿Quitar las marcas de '+list.length+' persona(s) en esta fecha?','Limpiar')))return;
    const rec=db.att[st.date];if(rec){list.forEach(p=>{delete rec[p.id];dropTime(st.date,p.id);});if(!Object.keys(rec).length)delete db.att[st.date];}
    save();asisDraw();
  };
  $('#tbl').onclick=e=>{
    const pg=e.target.closest('[data-pg]');
    if(pg){st.page=+pg.dataset.pg;asisDraw();return;}
    const b=e.target.closest('[data-s]');if(!b)return;
    const rec=db.att[st.date]||(db.att[st.date]={});
    if(rec[b.dataset.pid]===b.dataset.s)delete rec[b.dataset.pid];else rec[b.dataset.pid]=b.dataset.s;
    dropTime(st.date,b.dataset.pid);
    if(!Object.keys(rec).length)delete db.att[st.date];
    save();asisDraw();
  };
  asisDraw();
};
function asisDraw(){
  const st=S.asis,rec=db.att[st.date]||{},tm=db.times[st.date]||{};
  $('#dl').textContent=fmtLong(st.date);
  const c={P:0,T:0,J:0,F:0};let m=0;
  db.people.forEach(p=>{const s=rec[p.id];if(s){c[s]++;m++;}});
  $('#sum').innerHTML=Object.keys(STATUS).map(k=>'<span class="pill '+STATUS[k].c+'">'+STATUS[k].l+': '+c[k]+'</span>').join('')+'<span class="pill">Sin marcar: '+(db.people.length-m)+'</span>';
  const list=filterPeople(st.q,st.group),pg=paginate(list,st.page);st.page=pg.page;
  if(!db.people.length){$('#tbl').innerHTML='<div class="card empty">Aún no hay personas. Agrégalas en la sección “Personas”.</div>';return;}
  if(!list.length){$('#tbl').innerHTML='<div class="card empty">Sin resultados para ese filtro.</div>';return;}
  $('#tbl').innerHTML='<div class="tw"><table><thead><tr><th>Nombre</th><th>Grupo</th><th>Hora</th><th>Estado</th></tr></thead><tbody>'+
  pg.items.map(p=>'<tr><td>'+esc(p.name)+(p.code?'<div class="sub">'+esc(p.code)+'</div>':'')+'</td><td>'+esc(p.group||'—')+'</td><td>'+esc(tm[p.id]||'—')+'</td><td class="sts">'+Object.keys(STATUS).map(k=>'<button class="sb '+k+'" data-pid="'+p.id+'" data-s="'+k+'" aria-pressed="'+(rec[p.id]===k)+'">'+STATUS[k].l+'</button>').join('')+'</td></tr>').join('')+
  '</tbody></table></div>'+pg.html;
}

/* ========== Personas ========== */
R.personas=function(){
  const st=S.pers,edit=can('personas_edit');
  view.innerHTML='<div class="ph"><h1>Personas</h1>'+(edit?'<div class="row"><button class="btn" id="bk">Agregar varias</button><button class="btn primary" id="add">Agregar persona</button></div>':'')+'</div>'+
  '<div class="tools"><label>Buscar<input id="q" placeholder="Nombre o código" value="'+esc(st.q)+'"></label><label>Grupo<select id="gr">'+groupOptions(st.group,true)+'</select></label></div><div id="tbl"></div>';
  $('#q').oninput=e=>{st.q=e.target.value;st.page=1;persDraw();};
  $('#gr').onchange=e=>{st.group=e.target.value;st.page=1;persDraw();};
  if(edit){$('#add').onclick=()=>personForm();$('#bk').onclick=bulkForm;}
  $('#tbl').onclick=async e=>{
    const pg=e.target.closest('[data-pg]');if(pg){st.page=+pg.dataset.pg;persDraw();return;}
    const qr=e.target.closest('[data-qr]');if(qr){const p=db.people.find(x=>x.id===qr.dataset.qr);if(p)qrModal(p);return;}
    const ed=e.target.closest('[data-ed]');if(ed){personForm(db.people.find(p=>p.id===ed.dataset.ed));return;}
    const dl=e.target.closest('[data-dl]');
    if(dl){
      const p=db.people.find(x=>x.id===dl.dataset.dl);if(!p)return;
      if(!(await confirmDlg('¿Eliminar a '+p.name+' y todo su historial de asistencia?')))return;
      db.people=db.people.filter(x=>x.id!==p.id);
      Object.keys(db.att).forEach(d=>{delete db.att[d][p.id];if(!Object.keys(db.att[d]).length)delete db.att[d];dropTime(d,p.id);});
      save();persDraw();toast('Persona eliminada');
    }
  };
  persDraw();
};
function persDraw(){
  const st=S.pers,edit=can('personas_edit');
  const list=filterPeople(st.q,st.group),pg=paginate(list,st.page);st.page=pg.page;
  if(!db.people.length){$('#tbl').innerHTML='<div class="card empty">Todavía no hay personas. '+(edit?'Usa “Agregar persona” o “Agregar varias”: cada una tendrá su código QR.':'')+'</div>';return;}
  if(!list.length){$('#tbl').innerHTML='<div class="card empty">Sin resultados.</div>';return;}
  $('#tbl').innerHTML='<div class="tw"><table><thead><tr><th>Nombre</th><th>Código</th><th>Grupo</th>'+(edit?'<th></th>':'')+'</tr></thead><tbody>'+
  pg.items.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+esc(p.code||'—')+'</td><td>'+esc(p.group||'—')+'</td>'+(edit?'<td class="act"><button class="btn sm" data-qr="'+p.id+'">Ver QR</button><button class="btn sm" data-ed="'+p.id+'">Editar</button><button class="btn sm danger" data-dl="'+p.id+'">Eliminar</button></td>':'')+'</tr>').join('')+
  '</tbody></table></div>'+pg.html;
}
function personForm(p){
  const dl='<datalist id="gl">'+groups().map(g=>'<option value="'+esc(g)+'">').join('')+'</datalist>';
  openModal(p?'Editar persona':'Agregar persona','<form id="f" class="stack"><label>Nombre completo<input name="name" required value="'+esc(p?p.name:'')+'"></label><label>Código o documento (opcional)<input name="code" value="'+esc(p?p.code:'')+'"></label><label>Grupo, curso o área (opcional)<input name="group" list="gl" value="'+esc(p?p.group:'')+'"></label>'+dl+(p?'':'<p class="sub">Al guardar se generará su código QR automáticamente.</p>')+'<div class="row end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>',(r,close)=>{
    $('#f',r).onsubmit=e=>{
      e.preventDefault();const fd=new FormData(e.target);
      const name=String(fd.get('name')).trim();if(!name)return;
      const code=String(fd.get('code')).trim(),group=String(fd.get('group')).trim();
      let np=null;
      if(p){p.name=name;p.code=code;p.group=group;}else{np={id:uid(),name:name,code:code,group:group};db.people.push(np);}
      save();persDraw();
      if(np){qrModal(np);toast('Persona agregada y QR generado');}else{close();toast('Guardado');}
    };
  });
}
function bulkForm(){
  openModal('Agregar varias personas','<form id="f" class="stack"><p class="muted">Una persona por línea con el formato <b>Nombre; Código; Grupo</b> (código y grupo son opcionales). Puedes pegar desde Excel. No hay límite. Cada persona recibe su QR automáticamente.</p><textarea name="t" rows="10" required placeholder="Ana Pérez; 1001; 5to A&#10;Luis Gómez; 1002; 5to A&#10;María Ruiz"></textarea><div class="row end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Agregar</button></div></form>',(r,close)=>{
    $('#f',r).onsubmit=e=>{
      e.preventDefault();let n=0;
      String(new FormData(e.target).get('t')).split(/\r?\n/).forEach(line=>{
        const parts=line.split(/[;\t,]/).map(x=>x.trim());
        if(!parts[0])return;
        db.people.push({id:uid(),name:parts[0],code:parts[1]||'',group:parts[2]||''});n++;
      });
      if(!n){toast('No se encontró ninguna línea válida');return;}
      save();close();persDraw();toast(n+' persona(s) agregadas. Sus QR están en “Carnets QR”.');
    };
  });
}

/* ========== Carnets QR ========== */
R.carnets=function(){
  const st=S.car;
  view.innerHTML='<div class="ph noprint"><div><h1>Carnets con código QR</h1><p class="muted">Cada persona tiene un QR único. Imprime los carnets para que escaneen al ingresar.</p></div><button class="btn primary" id="pr">Imprimir esta página</button></div>'+
  '<div class="tools noprint"><label>Buscar<input id="q" placeholder="Nombre o código" value="'+esc(st.q)+'"></label><label>Grupo<select id="gr">'+groupOptions(st.group,true)+'</select></label></div>'+
  (typeof qrcode==='function'?'':'<div class="card err" style="margin-bottom:12px">No se pudo cargar el generador de QR. Revisa tu conexión a internet y recarga la página.</div>')+
  '<div id="tbl"></div>';
  $('#q').oninput=e=>{st.q=e.target.value;st.page=1;carDraw();};
  $('#gr').onchange=e=>{st.group=e.target.value;st.page=1;carDraw();};
  $('#pr').onclick=()=>printNow(false);
  $('#tbl').onclick=e=>{const pg=e.target.closest('[data-pg]');if(pg){st.page=+pg.dataset.pg;carDraw();}};
  carDraw();
};
function carDraw(){
  const st=S.car,list=filterPeople(st.q,st.group),pg=paginate(list,st.page,12);st.page=pg.page;
  if(!db.people.length){$('#tbl').innerHTML='<div class="card empty">Aún no hay personas. Agrégalas en la sección “Personas”.</div>';return;}
  if(!list.length){$('#tbl').innerHTML='<div class="card empty">Sin resultados.</div>';return;}
  $('#tbl').innerHTML='<div class="carnets">'+pg.items.map(carnetHtml).join('')+'</div>'+pg.html;
}

/* ========== Reportes ========== */
function repData(){
  const st=S.rep;
  const dates=Object.keys(db.att).filter(d=>d>=st.from&&d<=st.to);
  const rows=filterPeople(st.q,st.group).map(p=>{
    const c={P:0,T:0,J:0,F:0};
    dates.forEach(d=>{const s=db.att[d][p.id];if(s)c[s]++;});
    const n=c.P+c.T+c.J+c.F;
    return {p:p,c:c,n:n,pct:n?Math.round((c.P+c.T)/n*100):null};
  });
  return {dates:dates,rows:rows};
}
R.reportes=function(){
  const st=S.rep;
  view.innerHTML='<div class="ph"><div><h1>Reportes</h1><p class="muted" id="rs"></p></div><div class="row"><button class="btn" id="e1">Copiar resumen</button><button class="btn" id="e2">Copiar detalle por día</button></div></div>'+
  '<div class="tools"><label>Desde<input type="date" id="fr" value="'+esc(st.from)+'"></label><label>Hasta<input type="date" id="to" value="'+esc(st.to)+'"></label><label>Grupo<select id="gr">'+groupOptions(st.group,true)+'</select></label><label>Buscar<input id="q" placeholder="Nombre o código" value="'+esc(st.q)+'"></label></div><div id="tbl"></div>';
  $('#fr').onchange=e=>{st.from=e.target.value||st.from;st.page=1;repDraw();};
  $('#to').onchange=e=>{st.to=e.target.value||st.to;st.page=1;repDraw();};
  $('#gr').onchange=e=>{st.group=e.target.value;st.page=1;repDraw();};
  $('#q').oninput=e=>{st.q=e.target.value;st.page=1;repDraw();};
  $('#tbl').onclick=e=>{const pg=e.target.closest('[data-pg]');if(pg){st.page=+pg.dataset.pg;repDraw();}};
  $('#e1').onclick=()=>{
    const d=repData();
    copyModal('Resumen para Excel / Google Sheets',tsv([['Nombre','Código','Grupo','Presentes','Tardanzas','Justificadas','Faltas','% asistencia']].concat(d.rows.map(r=>[r.p.name,r.p.code,r.p.group,r.c.P,r.c.T,r.c.J,r.c.F,r.pct==null?'':r.pct]))),'Copia y pega en una hoja de cálculo; cada dato quedará en su propia columna.');
  };
  $('#e2').onclick=()=>{
    const d=repData(),out=[['Fecha','Nombre','Código','Grupo','Estado','Hora de entrada']];
    d.dates.sort().forEach(date=>d.rows.forEach(r=>{const s=db.att[date][r.p.id];if(s)out.push([date,r.p.name,r.p.code,r.p.group,STATUS[s].l,(db.times[date]||{})[r.p.id]||'']);}));
    copyModal('Detalle por día para Excel / Google Sheets',tsv(out),'Una fila por persona y día registrado. Pégalo en una hoja de cálculo.');
  };
  repDraw();
};
function repDraw(){
  const st=S.rep,d=repData(),pg=paginate(d.rows,st.page);st.page=pg.page;
  $('#rs').textContent=d.dates.length+' día(s) con asistencia registrada en el rango seleccionado';
  if(!d.rows.length){$('#tbl').innerHTML='<div class="card empty">No hay personas para mostrar.</div>';return;}
  $('#tbl').innerHTML='<div class="tw"><table><thead><tr><th>Nombre</th><th>Grupo</th><th>Presentes</th><th>Tardes</th><th>Justif.</th><th>Faltas</th><th>% asist.</th></tr></thead><tbody>'+
  pg.items.map(r=>{
    const cl=r.pct==null?'':(r.pct>=90?'ok':(r.pct>=75?'warn':'bad'));
    return '<tr><td>'+esc(r.p.name)+(r.p.code?'<div class="sub">'+esc(r.p.code)+'</div>':'')+'</td><td>'+esc(r.p.group||'—')+'</td><td>'+r.c.P+'</td><td>'+r.c.T+'</td><td>'+r.c.J+'</td><td>'+r.c.F+'</td><td><span class="pill '+cl+'">'+(r.pct==null?'—':r.pct+'%')+'</span></td></tr>';
  }).join('')+'</tbody></table></div>'+pg.html;
}

/* ========== Usuarios del sistema (solo administrador) ========== */

R.usuarios = async function () {
  if (!sb) {
    view.innerHTML =
      '<div class="card"><h1>Usuarios del sistema</h1>' +
      '<p class="muted">Supabase no está conectado.</p></div>';
    return;
  }

  if (!me || me.role !== 'admin') {
    view.innerHTML =
      '<div class="card"><h1>Acceso denegado</h1>' +
      '<p class="muted">Solo el administrador puede gestionar usuarios.</p></div>';
    return;
  }

  view.innerHTML =
    '<div class="ph"><div><h1>Usuarios del sistema</h1>' +
    '<p class="muted">Cuentas registradas en Supabase.</p></div>' +
    '<button class="btn primary" id="add">Nuevo usuario</button></div>' +
    '<div class="tools"><label>Buscar' +
    '<input id="q" placeholder="Nombre o usuario"></label></div>' +
    '<div id="msg" class="muted">Cargando usuarios...</div>' +
    '<div id="tbl"></div>';

  let users = [];
  const table = $('#tbl');
  const msg = $('#msg');
  const search = $('#q');

  async function callAdmin(action, data = {}) {
    const { data: sessionData, error: sessionError } =
      await sb.auth.getSession();

    if (sessionError) throw sessionError;

    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.');

    const { data: result, error } = await sb.functions.invoke(
      'admin-users',
      { body: { action, ...data } }
    );

    if (error) throw error;
    if (result?.error) throw new Error(result.error);

    return result;
  }

  function drawUsers() {
    const q = search.value.trim().toLowerCase();

    const filtered = users.filter(u =>
      [u.username, u.display_name, u.email, u.app_role]
        .some(v => String(v || '').toLowerCase().includes(q))
    );

    if (!filtered.length) {
      table.innerHTML =
        '<div class="card"><p class="muted">No se encontraron usuarios.</p></div>';
      return;
    }

    table.innerHTML =
      '<div class="card"><div class="table-wrap"><table>' +
      '<thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th>' +
      '<th>Estado</th></tr></thead><tbody>' +
      filtered.map(u =>
        '<tr><td>' + esc(u.display_name || '') + '</td>' +
        '<td>' + esc(u.username || '') + '</td>' +
        '<td>' + esc(u.app_role || '') + '</td>' +
        '<td>' + (u.active ? 'Activo' : 'Inactivo') +
        (u.pending ? ' · Pendiente' : '') + '</td></tr>'
      ).join('') +
      '</tbody></table></div></div>';
  }

  async function loadUsers() {
    msg.textContent = 'Cargando usuarios...';
    table.innerHTML = '';

    try {
      const result = await callAdmin('list');
      users = result.users || [];
      msg.textContent = 'Usuarios encontrados: ' + users.length;
      drawUsers();
    } catch (error) {
      msg.textContent =
        'No se pudieron cargar los usuarios: ' +
        (error.message || 'Error desconocido');
    }
  }

  search.oninput = drawUsers;

  $('#add').onclick = () => {
    openModal(
      'Nuevo usuario',
      '<form id="newUser" class="stack">' +
      '<label>Nombre completo<input name="display_name" required></label>' +
      '<label>Nombre de usuario<input name="username" required pattern="[a-z0-9_]{3,30}" minlength="3" maxlength="30"></label>' +
      '<label>Correo electrónico<input name="email" type="email" required></label>' +
      '<label>Teléfono<input name="phone"></label>' +
      '<label>Contraseña<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>' +
      '<label>Rol<select name="app_role" required>' +
      '<option value="director">Director</option>' +
      '<option value="registrador">Registrador</option>' +
      '<option value="admin">Administrador</option>' +
      '</select></label>' +
      '<div class="row end"><button type="button" class="btn" data-close>Cancelar</button>' +
      '<button class="btn primary" type="submit">Crear usuario</button></div>' +
      '</form>',
      (root, close) => {
        const form = $('#newUser', root);

        form.onsubmit = async event => {
          event.preventDefault();

          const button = form.querySelector('button[type="submit"]');
          button.disabled = true;
          button.textContent = 'Creando...';

          const fd = new FormData(form);

          try {
            await callAdmin('create', {
              username: String(fd.get('username') || '').trim().toLowerCase(),
              display_name: String(fd.get('display_name') || '').trim(),
              email: String(fd.get('email') || '').trim(),
              phone: String(fd.get('phone') || '').trim(),
              password: String(fd.get('password') || ''),
              app_role: String(fd.get('app_role') || '')
            });

            close();
            toast('Usuario creado correctamente');
            await loadUsers();
          } catch (error) {
            toast('No se pudo crear: ' + (error.message || 'Error desconocido'));
            button.disabled = false;
            button.textContent = 'Crear usuario';
          }
        };
      }
    );
  };

  await loadUsers();
};

function usrDraw(){
  const st=S.usr,q=st.q.trim().toLowerCase();
  const list=db.users.filter(u=>!q||(u.name+' '+u.username).toLowerCase().indexOf(q)>=0).sort((a,b)=>collator.compare(a.name,b.name));
  const pg=paginate(list,st.page);st.page=pg.page;
  if(!list.length){$('#tbl').innerHTML='<div class="card empty">Sin resultados.</div>';return;}
  const opts=sel=>(sel===''?'<option value="" selected>— Elegir rol —</option>':'')+Object.keys(db.roles).map(id=>'<option value="'+id+'"'+(id===sel?' selected':'')+'>'+esc(db.roles[id].name)+'</option>').join('');
  $('#tbl').innerHTML='<div class="tw"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Contacto</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>'+
  pg.items.map(u=>'<tr><td>'+esc(u.name)+(u.id===me.id?' <span class="pill info">tú</span>':'')+'</td><td>'+esc(u.username)+'</td><td class="sub">'+contactText(u)+'</td><td><select data-u="'+u.id+'" aria-label="Rol de '+esc(u.name)+'">'+opts(u.role)+'</select></td><td>'+statusPill(u)+'</td><td class="act">'+(u.pending?'<button class="btn sm primary" data-act="ap" data-u="'+u.id+'">Aprobar</button>':'<button class="btn sm" data-act="tog" data-u="'+u.id+'">'+(u.active?'Desactivar':'Activar')+'</button>')+'<button class="btn sm" data-act="rv" data-u="'+u.id+'">Recuperación</button><button class="btn sm" data-act="pw" data-u="'+u.id+'">Clave</button><button class="btn sm danger" data-act="del" data-u="'+u.id+'">Eliminar</button></td></tr>').join('')+
  '</tbody></table></div>'+pg.html;
}
function userForm(){
  const opts=Object.keys(db.roles).map(id=>'<option value="'+id+'"'+(id==='director'?' selected':'')+'>'+esc(db.roles[id].name)+'</option>').join('');
  openModal('Nuevo usuario','<form id="f" class="stack"><label>Nombre completo<input name="name" required></label><label>Usuario (para iniciar sesión)<input name="username" required autocomplete="off"></label><label>Contraseña (mín. 6)<input name="pass" type="password" required minlength="6" autocomplete="new-password"></label><label>Correo de recuperación<input name="email" type="email" required></label><label>Teléfono de recuperación<input name="phone" type="tel" required></label><label>Rol<select name="role">'+opts+'</select></label><div id="err" class="err"></div><div class="row end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Crear usuario</button></div></form>',(r,close)=>{
    $('#f',r).onsubmit=async e=>{
      e.preventDefault();const fd=new FormData(e.target);
      const name=String(fd.get('name')).trim(),un=normUser(fd.get('username')),pw=String(fd.get('pass'));
      if(!name||!un){$('#err',r).textContent='Completa nombre y usuario.';return;}
      if(db.users.some(u=>u.username===un)){$('#err',r).textContent='Ese usuario ya existe.';return;}
      if(pw.length<6){$('#err',r).textContent='La contraseña debe tener al menos 6 caracteres.';return;}
      const email=normEmail(fd.get('email')),phone=String(fd.get('phone')||'').trim();
      if(!email||!okEmail(email)){$('#err',r).textContent='Ingresa un correo de recuperación válido.';return;}
      if(!phone||!okPhone(phone)){$('#err',r).textContent='Ingresa un teléfono de recuperación válido (de 6 a 15 dígitos).';return;}
      const code=genCode();
      db.users.push({id:uid(),name:name,username:un,pass:await hash(pw),role:String(fd.get('role')),active:true,email:email,phone:phone,rec:await hash('rec:'+normCode(code))});
      save();close();usrDraw();showCodeModal(code,name,false);
    };
  });
}



/* ========== Roles y permisos (solo administrador) ========== */
R.roles = function () {
  // Solo el administrador puede gestionar roles y permisos
  if (!me || me.role !== 'admin') {
    view.innerHTML =
      '<div class="card">' +
      '<h2>Acceso denegado</h2>' +
      '<p class="muted">Solo el administrador puede gestionar los roles y permisos.</p>' +
      '</div>';
    return;
  }

  view.innerHTML =
    '<div class="ph">' +
      '<div>' +
        '<h1>Roles y permisos</h1>' +
        '<p class="muted">Define qué puede ver y hacer cada rol. Las secciones de usuarios, roles y ajustes son exclusivas del administrador.</p>' +
      '</div>' +
      '<button class="btn primary" id="nr">Nuevo rol</button>' +
    '</div>' +
    '<div class="grid" id="rl"></div>';

  $('#nr').onclick = roleForm;

  const rl = $('#rl');

  rl.onchange = e => {
    const c = e.target.closest('input[data-role]');
    if (!c) return;

    const r = db.roles[c.dataset.role];
    if (!r || c.dataset.role === 'admin') return;

    const i = r.perms.indexOf(c.dataset.perm);

    if (c.checked && i < 0) {
      r.perms.push(c.dataset.perm);
    }

    if (!c.checked && i >= 0) {
      r.perms.splice(i, 1);
    }

    save();
    toast('Permisos actualizados');
  };

  rl.onclick = async e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;

    const id = b.dataset.del;

    if (db.users.some(u => u.role === id)) {
      toast('Hay usuarios con este rol. Cámbialos primero.');
      return;
    }

    if (!(await confirmDlg('¿Eliminar el rol "' + roleName(id) + '"?'))) {
      return;
    }

    delete db.roles[id];
    save();
    rolesDraw();
  };

  rolesDraw();
};

function roleForm() {
  // Protección adicional
  if (!me || me.role !== 'admin') {
    toast('Solo el administrador puede crear roles.');
    return;
  }

  openModal(
    'Nuevo rol',
    '<form id="f" class="stack">' +
      '<label>Nombre del rol' +
        '<input name="name" required placeholder="Ej: Subdirector">' +
      '</label>' +
      '<div>' +
        Object.keys(PERMS).map(k =>
          '<label class="chk">' +
            '<input type="checkbox" name="p" value="' + k + '"> ' +
            esc(PERMS[k]) +
          '</label>'
        ).join('') +
      '</div>' +
      '<div class="row end">' +
        '<button type="button" class="btn" data-close>Cancelar</button>' +
        '<button class="btn primary">Crear rol</button>' +
      '</div>' +
    '</form>',
    (r, close) => {
      $('#f', r).onsubmit = e => {
        e.preventDefault();

        const fd = new FormData(e.target);
        const name = String(fd.get('name')).trim();

        if (!name) return;

        db.roles['r_' + uid()] = {
          name: name,
          system: false,
          perms: fd.getAll('p').map(String)
        };

        save();
        close();
        rolesDraw();
        toast('Rol creado');
      };
    }
  );
}

function rolesDraw(){
  $('#rl').innerHTML=Object.keys(db.roles).map(id=>{
    const r=db.roles[id],n=db.users.filter(u=>u.role===id).length,locked=id==='admin';
    return '<section class="card"><div class="rh"><h3>'+esc(r.name)+'</h3><span class="pill">'+n+' usuario'+(n===1?'':'s')+'</span></div>'+
    Object.keys(PERMS).map(k=>'<label class="chk"><input type="checkbox" data-role="'+id+'" data-perm="'+k+'" '+((locked||r.perms.indexOf(k)>=0)?'checked':'')+' '+(locked?'disabled':'')+'> '+esc(PERMS[k])+'</label>').join('')+
    '<div class="lock">🔒 '+(locked?'Incluye además la gestión de usuarios, roles y ajustes.':'Sin acceso a usuarios, roles ni ajustes.')+'</div>'+
    (r.system?'':'<button class="btn sm danger" data-del="'+id+'">Eliminar rol</button>')+'</section>';
  }).join('');
}
function roleForm(){
  openModal('Nuevo rol','<form id="f" class="stack"><label>Nombre del rol<input name="name" required placeholder="Ej: Subdirector"></label><div>'+Object.keys(PERMS).map(k=>'<label class="chk"><input type="checkbox" name="p" value="'+k+'"> '+esc(PERMS[k])+'</label>').join('')+'</div><div class="row end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Crear rol</button></div></form>',(r,close)=>{
    $('#f',r).onsubmit=e=>{
      e.preventDefault();const fd=new FormData(e.target),name=String(fd.get('name')).trim();if(!name)return;
      db.roles['r_'+uid()]={name:name,system:false,perms:fd.getAll('p').map(String)};
      save();close();rolesDraw();toast('Rol creado');
    };
  });
}

/* ========== Ajustes (solo administrador) ========== */
R.ajustes=function(){
  const b=db.brand,dias=Object.keys(db.att).length;
  view.innerHTML='<div class="ph"><h1>Ajustes</h1></div>'+
  '<div class="card stack" style="margin-bottom:14px"><div><h3>Identidad de la institución</h3><p class="muted">Cambia el logo, el nombre y el color. Se verá en el sistema y en los carnets QR.</p></div>'+
  '<div class="logoedit"><div id="lp">'+logoHtml(80)+'</div><div class="row"><button class="btn" id="lc">Cambiar logo</button><button class="btn danger" id="lr"'+(b.logo?'':' hidden')+'>Quitar logo</button></div><input type="file" id="lf" accept="image/*" hidden></div><div id="lerr" class="err" role="alert"></div>'+
  '<form id="bf" class="stack"><label>Nombre de la institución<input name="name" required value="'+esc(b.name)+'"></label><label>Lema o descripción corta<input name="tag" value="'+esc(b.tagline)+'"></label>'+
  '<div class="stack" style="gap:8px"><span style="font-size:.82rem;font-weight:700">Color del sistema</span><div class="sws">'+Object.keys(ACCENTS).map(k=>'<label class="sw"><input type="radio" name="ac" value="'+k+'"'+(b.accent===k?' checked':'')+'><i style="background:'+ACCENTS[k].c+'"></i>'+ACCENTS[k].n+'</label>').join('')+'</div></div>'+
  '<label>Hora límite de entrada (opcional)<input type="time" name="late" value="'+esc(db.settings.lateTime)+'"></label><p class="sub" style="margin-top:-8px">Al escanear un QR después de esta hora, la entrada se marca como “Tarde”. Déjalo vacío para marcar siempre “Presente”.</p>'+
  '<label class="chk"><input type="checkbox" name="su"'+(db.settings.allowSignup!==false?' checked':'')+'> Permitir que nuevas personas se registren (un administrador debe aprobarlas)</label>'+
  '<div class="row"><button class="btn primary">Guardar cambios</button></div></form></div>'+
  '<div class="grid" style="margin-bottom:14px"><div class="card stat s-gold"><span class="n">'+db.people.length+'</span><span class="l">Personas</span></div><div class="card stat s-gold"><span class="n">'+db.users.length+'</span><span class="l">Usuarios del sistema</span></div><div class="card stat s-gold"><span class="n">'+dias+'</span><span class="l">Días con asistencia</span></div></div>'+
  '<div class="card stack"><div><h3>Copia de seguridad</h3><p class="muted">Los datos se guardan en este navegador. Exporta una copia con regularidad y pégala para restaurarla en otro dispositivo.</p></div><div class="row"><button class="btn" id="ex">Exportar copia</button><button class="btn" id="im">Importar copia</button></div></div>'+
  '<div class="card stack" style="margin-top:14px"><div><h3>Zona de peligro</h3><p class="muted">Estas acciones no se pueden deshacer.</p></div><div class="row"><button class="btn danger" id="da">Borrar todas las asistencias</button><button class="btn danger" id="rs">Restablecer todo el sistema</button></div></div>';

  $('#lc').onclick=()=>$('#lf').click();
  $('#lf').onchange=async e=>{
    const f=e.target.files&&e.target.files[0];if(!f)return;
    try{db.brand.logo=await readLogo(f);save();renderApp('ajustes');toast('Logo actualizado');}
    catch(x){$('#lerr').textContent=x.message||'No se pudo cargar el logo.';}
  };
  $('#lr').onclick=()=>{db.brand.logo='';save();renderApp('ajustes');toast('Logo eliminado');};
  $('#bf').onsubmit=e=>{
    e.preventDefault();const fd=new FormData(e.target);
    db.brand.name=String(fd.get('name')).trim()||'Sistema de Asistencias';
    db.brand.tagline=String(fd.get('tag')).trim();
    const ac=String(fd.get('ac'));if(ACCENTS[ac])db.brand.accent=ac;
    db.settings.lateTime=String(fd.get('late')||'');
    db.settings.allowSignup=fd.get('su')==='on';
    save();applyAccent();renderApp('ajustes');toast('Cambios guardados');
  };
  $('#ex').onclick=()=>copyModal('Copia de seguridad',JSON.stringify(db),'Copia este texto y guárdalo en un lugar seguro (incluye usuarios, contraseñas cifradas y el logo).');
  $('#im').onclick=()=>{
    openModal('Importar copia','<form id="f" class="stack"><p class="muted">Pega aquí el texto de una copia exportada. <b>Reemplazará todos los datos actuales.</b></p><textarea name="t" rows="10" required></textarea><div id="err" class="err"></div><div class="row end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Importar</button></div></form>',(r,close)=>{
      $('#f',r).onsubmit=async e=>{
        e.preventDefault();
        let o;try{o=JSON.parse(String(new FormData(e.target).get('t')));}catch(x){$('#err',r).textContent='El texto no es una copia válida.';return;}
        if(!o||!Array.isArray(o.users)||!Array.isArray(o.people)||!o.att||!o.roles||!o.roles.admin||!o.users.some(u=>u.role==='admin'&&u.active)){$('#err',r).textContent='La copia está incompleta o no contiene un administrador activo.';return;}
        if(!(await confirmDlg('Se reemplazarán todos los datos actuales. ¿Continuar?','Importar'))){return;}
        db=normalizeDb(o);save();close();applyAccent();
        me=db.users.find(u=>me&&u.id===me.id&&u.active)||null;
        if(me)renderApp();else{setSession(null);boot();}
        toast('Copia importada');
      };
    });
  };
  $('#da').onclick=async()=>{if(!(await confirmDlg('¿Borrar TODAS las asistencias registradas?','Borrar')))return;db.att={};db.times={};save();R.ajustes();toast('Asistencias borradas');};
  $('#rs').onclick=async()=>{
    if(!(await confirmDlg('Se borrarán personas, asistencias, usuarios, roles personalizados y la identidad. ¿Restablecer todo?','Restablecer')))return;
    db=freshDb();save();applyAccent();me=null;setSession(null);boot();
  };
};

/* ========== Arranque ========== */
async function boot(){
  app=$('#app');applyAccent();
  if(location.hash==='#restablecer'&&!sb){renderReset();return;}
  if(!sb){const sid=sget(SKEY);me=db.users.find(u=>u.id===sid&&u.active)||null;if(me)renderApp();else renderWelcome();return;}
  renderLogin();
  try{
    const {data}=await sb.auth.getSession();
    if(data&&data.session&&data.session.user){
      const uid=data.session.user.id;
      const {data:profile,error}=await sb.from('profiles').select('*').eq('id',uid).single();
      if(error)throw error;
      if(!profile.active||profile.pending){await sb.auth.signOut();return;}
      cloudUser=data.session.user;await loadCloudData(profile);setSession(profile.id);renderApp();
    }
  }catch(e){console.error('No se pudo restaurar la sesión de Supabase:',e);$('#err')&&($('#err').textContent='No se pudo cargar la cuenta desde Supabase: '+e.message);}
}
(function(){const t=lget(TKEY);if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;})();
window.addEventListener('hashchange',()=>{if(location.hash==='#restablecer')renderReset();});
boot();
})();
