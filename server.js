const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=Number(process.env.PORT||8080);
const ROOT=path.join(__dirname,'..'),DATA=path.join(ROOT,'data','store.json'),PUBLIC=path.join(ROOT,'public');
const ADMIN_TOKEN=process.env.RAJA_ADMIN_TOKEN||'CHANGE-ME-DEMO';
const RATE=new Map();

function load(){try{return JSON.parse(fs.readFileSync(DATA,'utf8'))}catch{return {players:{},sessions:{},ledger:[]}}}
function save(db){const tmp=DATA+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,DATA)}
function headers(res,code,type='application/json'){
 res.writeHead(code,{
  'Content-Type':type,
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self' 'unsafe-inline' data:; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
 });
}
function json(res,code,obj){headers(res,code);res.end(JSON.stringify(obj))}
function body(req){return new Promise((ok,bad)=>{let b='';req.on('data',c=>{b+=c;if(b.length>1e6){bad(new Error('too_large'));req.destroy()}});req.on('end',()=>{try{ok(b?JSON.parse(b):{})}catch(e){bad(e)}})})}
function hash(p,s){return crypto.scryptSync(p,s,32).toString('hex')}
function token(){return crypto.randomBytes(24).toString('hex')}
function auth(req,db){const t=(req.headers.authorization||'').replace(/^Bearer\s+/,'');const s=db.sessions[t];return s&&db.players[s.playerId]?db.players[s.playerId]:null}
function addLedger(db,playerId,delta,reason){const p=db.players[playerId];p.coins=Math.max(0,p.coins+delta);db.ledger.unshift({id:crypto.randomUUID(),playerId,delta,reason,balance:p.coins,at:new Date().toISOString()});db.ledger=db.ledger.slice(0,5000);return p.coins}
function limited(req,windowMs=10000,max=30){const ip=req.socket.remoteAddress||'x',now=Date.now();let a=RATE.get(ip)||[];a=a.filter(t=>now-t<windowMs);if(a.length>=max)return true;a.push(now);RATE.set(ip,a);return false}
function cleanSessions(db){const cutoff=Date.now()-1000*60*60*24*7;for(const [k,v] of Object.entries(db.sessions))if(v.createdAt<cutoff)delete db.sessions[k]}

async function api(req,res){
 const db=load(); cleanSessions(db);
 if(limited(req))return json(res,429,{ok:false,error:'rate_limited'});
 if(req.method==='GET'&&req.url==='/api/health')return json(res,200,{ok:true,mode:'demo-server-v51',virtualCoinsOnly:true,cashoutEnabled:false});
 if(req.method==='POST'&&req.url==='/api/register'){
  const b=await body(req),name=String(b.name||'').trim(),pass=String(b.password||'');
  if(name.length<3||name.length>24||pass.length<6||pass.length>64)return json(res,400,{ok:false,error:'invalid_input'});
  const id='RS-'+crypto.randomBytes(4).toString('hex').toUpperCase(),salt=crypto.randomBytes(16).toString('hex');
  db.players[id]={id,name,salt,passHash:hash(pass,salt),coins:5000,createdAt:new Date().toISOString()};
  const t=token();db.sessions[t]={playerId:id,createdAt:Date.now()};save(db);
  return json(res,201,{ok:true,token:t,profile:{id,name},coins:5000});
 }
 if(req.method==='POST'&&req.url==='/api/login'){
  const b=await body(req),id=String(b.id||''),pass=String(b.password||''),p=db.players[id];
  if(!p||hash(pass,p.salt)!==p.passHash)return json(res,401,{ok:false,error:'invalid_credentials'});
  const t=token();db.sessions[t]={playerId:id,createdAt:Date.now()};save(db);
  return json(res,200,{ok:true,token:t,profile:{id:p.id,name:p.name},coins:p.coins});
 }
 if(req.method==='POST'&&req.url==='/api/logout'){
  const t=(req.headers.authorization||'').replace(/^Bearer\s+/,'');delete db.sessions[t];save(db);return json(res,200,{ok:true});
 }
 if(req.method==='GET'&&req.url==='/api/me'){const p=auth(req,db);if(!p)return json(res,401,{ok:false,error:'unauthorized'});return json(res,200,{ok:true,profile:{id:p.id,name:p.name},coins:p.coins})}
 if(req.method==='GET'&&req.url==='/api/ledger'){const p=auth(req,db);if(!p)return json(res,401,{ok:false,error:'unauthorized'});return json(res,200,{ok:true,items:db.ledger.filter(x=>x.playerId===p.id).slice(0,100)})}
 if(req.method==='POST'&&req.url==='/api/admin/add-coins'){
  if((req.headers['x-admin-token']||'')!==ADMIN_TOKEN)return json(res,403,{ok:false,error:'forbidden'});
  const b=await body(req),id=String(b.playerId||''),n=Math.max(0,Math.min(100000,Number(b.amount||0)));
  if(!db.players[id]||!n)return json(res,400,{ok:false,error:'invalid_request'});
  const balance=addLedger(db,id,n,'admin-virtual-credit');save(db);return json(res,200,{ok:true,balance});
 }
 return json(res,404,{ok:false,error:'not_found'});
}

const server=http.createServer(async(req,res)=>{
 try{
  if(req.url.startsWith('/api/'))return await api(req,res);
  const rel=req.url==='/'?'index.html':req.url.slice(1),p=path.join(PUBLIC,rel);
  if(!p.startsWith(PUBLIC)||!fs.existsSync(p))return json(res,404,{ok:false,error:'not_found'});
  const ext=path.extname(p),type=ext==='.html'?'text/html; charset=utf-8':'text/plain';
  headers(res,200,type);fs.createReadStream(p).pipe(res);
 }catch(e){json(res,500,{ok:false,error:'server_error'})}
});
server.listen(PORT,()=>console.log('RAJA SLOT WEB18 V51 demo server on http://localhost:'+PORT));
