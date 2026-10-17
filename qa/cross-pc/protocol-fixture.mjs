// PUBLIC QA ONLY. This is a disposable protocol simulator, not the store backend.
// Its generated signing key is trusted only by a temporary extracted test copy.
// No payment, customer, merchant configuration or production secret is used.
import {createHash, generateKeyPairSync, randomUUID, randomBytes, sign, verify} from 'node:crypto';

const DAY = 86400000;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (status, code, error) => {throw Object.assign(new Error(error), {status, code});};

export function createFixture(saved) {
  const pair = saved ? null : generateKeyPairSync('ed25519');
  const state = saved || {
    publicKey: pair.publicKey.export({format:'der',type:'spki'}).toString('base64'),
    privateKey: pair.privateKey.export({format:'pem',type:'pkcs8'}),
    account: 'cross-pc-qa@example.invalid', activatedAt: null, expiresAt: null,
    pendingDays: 7, device: null, sessions: [], nonces: []
  };
  const reply = body => Response.json(body, {headers:{'Cache-Control':'no-store'}});
  const proof = (action, data, token = '') => {
    if (data.applicationId !== 'chengjing-connect' || data.account !== state.account ||
        !Number.isSafeInteger(data.timestamp) || Math.abs(Date.now()-data.timestamp)>300000 ||
        !/^[A-Za-z0-9_-]{20,80}$/.test(data.nonce || '')) fail(403,'QA_PROOF','Invalid synthetic device proof');
    const message = JSON.stringify(['chengjing-license-v1',action,data.account,data.publicKey,
      data.timestamp,data.nonce,sha(['heartbeat','logout','password'].includes(action)?token:data.activationCode||'')]);
    let valid = false;
    try {valid = verify(null,Buffer.from(message),{key:Buffer.from(data.publicKey,'base64'),type:'spki',format:'der'},Buffer.from(data.signature,'base64url'));} catch {}
    if (!valid) fail(403,'QA_PROOF','Invalid synthetic signature');
    const nonce = sha(data.publicKey+'|'+data.nonce);
    if (state.nonces.includes(nonce)) fail(409,'QA_REPLAY','Synthetic proof replay');
    state.nonces.push(nonce);
    return sha(data.publicKey);
  };
  const lease = (deviceId, session, token) => {
    const now = Date.now();
    const payload = Buffer.from(JSON.stringify({version:1,applicationId:'chengjing-connect',
      account:state.account,deviceId,sessionId:session.id,activatedAt:state.activatedAt,
      expiresAt:state.expiresAt,issuedAt:now,leaseExpiresAt:Math.min(now+3600000,state.expiresAt)})).toString('base64url');
    return {serverTime:now,account:{email:state.account},...(token?{token}:{}),
      lease:{payload,signature:sign(null,Buffer.from(payload),state.privateKey).toString('base64url')}};
  };
  return {
    publicKey: state.publicKey,
    account: () => ({activated_at:state.activatedAt,expires_at:state.expiresAt}),
    activeDeviceCount: () => state.device ? 1 : 0,
    activeSessionCount: () => state.sessions.filter(s=>!s.revoked).length,
    resetDevices() {state.device=null;for(const session of state.sessions) session.revoked=true;},
    grantDays(days) {if(state.activatedAt) state.expiresAt=Math.max(Date.now(),state.expiresAt)+days*DAY;else state.pendingDays+=days;},
    expire() {state.expiresAt=Date.now()-1000;},
    exportState: () => structuredClone(state),
    async fetch(request) {
      try {
        const action = new URL(request.url).pathname.replace('/api/licensing/','');
        if (action==='public-key' && request.method==='GET') return reply({publicKey:state.publicKey,serverTime:Date.now()});
        if (!['login','heartbeat','logout'].includes(action)||request.method!=='POST') return new Response('Not found',{status:404});
        const data = await request.json(), token = (request.headers.get('authorization')||'').replace(/^Bearer /,'');
        const device = proof(action,data,token);
        if (action==='login') {
          if(data.password!=='QaPass8x') fail(403,'QA_PASSWORD','Wrong synthetic password');
          if(state.device && state.device!==device) fail(409,'DEVICE_LIMIT','此账号已绑定其他电脑，请联系店主解绑换机');
          if(!state.activatedAt) {state.activatedAt=Date.now();state.expiresAt=state.activatedAt+state.pendingDays*DAY;state.pendingDays=0;}
          if(state.expiresAt<=Date.now()) fail(403,'QA_EXPIRED','Synthetic membership expired');
          state.device=device;
          for(const session of state.sessions) session.revoked=true;
          const value=randomBytes(32).toString('base64url'), session={id:randomUUID(),device,tokenHash:sha(value),revoked:false};
          state.sessions.push(session);
          return reply(lease(device,session,value));
        }
        const session=state.sessions.find(s=>!s.revoked&&s.tokenHash===sha(token)&&s.device===device);
        if(!session || state.device!==device) fail(401,'QA_SESSION','Synthetic session revoked');
        if(action==='logout') {session.revoked=true;return reply({ok:true});}
        if(state.expiresAt<=Date.now()) fail(403,'QA_EXPIRED','Synthetic membership expired');
        return reply(lease(device,session));
      } catch(error) {
        if(!error.status) throw error;
        return Response.json({error:error.message,code:error.code},{status:error.status});
      }
    }
  };
}
