const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const ADMIN_TOKEN = process.env.RAJA_ADMIN_TOKEN || 'CHANGE-ME-DEMO';
const INDEX = path.join(__dirname, 'index.html');

let db = { players: {}, sessions: {}, ledger: [] };
const rate = new Map();

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'X-Frame-Options':'DENY'
  });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => {
      b += c;
      if (b.length > 1e6) { reject(new Error('too_large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); }
    });
  });
}
function hash(p,s){ return crypto.scryptSync(p,s,32).toString('hex'); }
function token(){ return crypto.randomBytes(24).toString('hex'); }
function auth(req){
  const t=(req.headers.authorization||'').replace(/^Bearer\s+/,'');
  const s=db.sessions[t];
  return s && db.players[s.playerId] ? db.players[s.playerId] : null;
}
function limited(req, windowMs=10000, max=30){
  const ip=req.socket.remoteAddress||'x', now=Date.now();
  let a=rate.get(ip)||[];
  a=a.filter(t=>now-t<windowMs);
  if(a.length>=max) return true;
  a.push(now); rate.set(ip,a); return false;
}
function addLedger(playerId, delta, reason){
  const p=db.players[playerId];
  p.coins=Math.max(0,p.coins+delta);
  db.ledger.unshift({
    id:crypto.randomUUID(), playerId, delta, reason,
    balance:p.coins, at:new Date().toISOString()
  });
  db.ledger=db.ledger.slice(0,1000);
  return p.coins;
}

async function api(req,res){
  if(limited(req)) return json(res,429,{ok:false,error:'rate_limited'});

  if(req.method==='GET' && req.url==='/api/health')
    return json(res,200,{ok:true,mode:'mobile-simple-public-test',virtualCoinsOnly:true,cashoutEnabled:false});

  if(req.method==='POST' && req.url==='/api/register'){
    const b=await body(req), name=String(b.name||'').trim(), pass=String(b.password||'');
    if(name.length<3 || pass.length<6) return json(res,400,{ok:false,error:'invalid_input'});
    const id='RS-'+crypto.randomBytes(4).toString('hex').toUpperCase();
    const salt=crypto.randomBytes(16).toString('hex');
    db.players[id]={id,name,salt,passHash:hash(pass,salt),coins:5000,createdAt:new Date().toISOString()};
    const t=token(); db.sessions[t]={playerId:id,createdAt:Date.now()};
    return json(res,201,{ok:true,token:t,profile:{id,name},coins:5000});
  }

  if(req.method==='POST' && req.url==='/api/login'){
    const b=await body(req), id=String(b.id||''), pass=String(b.password||''), p=db.players[id];
    if(!p || hash(pass,p.salt)!==p.passHash) return json(res,401,{ok:false,error:'invalid_credentials'});
    const t=token(); db.sessions[t]={playerId:id,createdAt:Date.now()};
    return json(res,200,{ok:true,token:t,profile:{id:p.id,name:p.name},coins:p.coins});
  }

  if(req.method==='POST' && req.url==='/api/logout'){
    const t=(req.headers.authorization||'').replace(/^Bearer\s+/,'');
    delete db.sessions[t];
    return json(res,200,{ok:true});
  }

  if(req.method==='GET' && req.url==='/api/me'){
    const p=auth(req);
    if(!p) return json(res,401,{ok:false,error:'unauthorized'});
    return json(res,200,{ok:true,profile:{id:p.id,name:p.name},coins:p.coins});
  }

  if(req.method==='GET' && req.url==='/api/ledger'){
    const p=auth(req);
    if(!p) return json(res,401,{ok:false,error:'unauthorized'});
    return json(res,200,{ok:true,items:db.ledger.filter(x=>x.playerId===p.id).slice(0,100)});
  }

  if(req.method==='POST' && req.url==='/api/admin/add-coins'){
    if((req.headers['x-admin-token']||'')!==ADMIN_TOKEN) return json(res,403,{ok:false,error:'forbidden'});
    const b=await body(req), id=String(b.playerId||''), amount=Math.max(0,Math.min(100000,Number(b.amount||0)));
    if(!db.players[id] || !amount) return json(res,400,{ok:false,error:'invalid_request'});
    const balance=addLedger(id,amount,'admin-virtual-credit');
    return json(res,200,{ok:true,balance});
  }

  return json(res,404,{ok:false,error:'not_found'});
}

const server=http.createServer(async(req,res)=>{
  try{
    if(req.url.startsWith('/api/')) return await api(req,res);
    if(req.method==='GET' && (req.url==='/' || req.url==='/index.html')){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return fs.createReadStream(INDEX).pipe(res);
    }
    return json(res,404,{ok:false,error:'not_found'});
  } catch(e) {
    return json(res,500,{ok:false,error:'server_error'});
  }
});

server.listen(PORT,()=>console.log('RAJA SLOT mobile-simple server on port '+PORT));
