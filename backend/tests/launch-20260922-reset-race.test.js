import {it,expect,vi,afterEach} from 'vitest';
const {app,db,createUser}=require('./helpers');
const request=require('supertest');
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
afterEach(()=>vi.restoreAllMocks());

it('a reset link consumed by a completed request cannot be reused by an earlier paused request',async()=>{
 const crypto=require('crypto');
 const hashAuthToken=token=>crypto.createHash('sha256').update(token).digest('hex');
 const u=await createUser();
 const token=crypto.randomBytes(32).toString('hex');
 await db.query("UPDATE users SET password_reset_token_hash=$2,password_reset_expires_at=NOW()+INTERVAL '1 hour' WHERE id=$1",[u.id,hashAuthToken(token)]);
 const reached=gate(), resume=gate();
 const original=db.query;
 let held=false;
 vi.spyOn(db,'query').mockImplementation(async(sql,...args)=>{
  const r=await original(sql,...args);
  if(!held && String(sql).includes('SELECT id FROM users') && String(sql).includes('password_reset_token_hash')){
   held=true; reached.resolve(); await resume.promise;
  }
  return r;
 });
 const stale=request(app).post('/auth/reset-password').send({token,password:'StaleRequestPassword123!'}).then(r=>r);
 await reached.promise;
 let completed;
 try {
  completed=await request(app).post('/auth/reset-password').send({token,password:'OwnerFinalPassword123!'});
  expect(completed.status,JSON.stringify(completed.body)).toBe(200);
 } finally {resume.resolve();}
 const result=await stale;
 const login=await request(app).post('/auth/login').send({email:u.email,password:'OwnerFinalPassword123!'});
 const overwritten=await request(app).post('/auth/login').send({email:u.email,password:'StaleRequestPassword123!'});
 expect(result.status,'The already consumed link must be rejected atomically').toBe(400);
 expect(login.status).toBe(200);
 expect(overwritten.status).toBe(401);
 expect((await db.query("SELECT token_version FROM users WHERE id=$1",[u.id])).rows[0].token_version).toBe(1);
});

it.each(['expired', 'replaced'])('a reset a lekérdezés után %s tokennel sem írhat jelszót', async change => {
  const crypto = require('crypto');
  const u = await createUser();
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await db.query("UPDATE users SET password_reset_token_hash=$2,password_reset_expires_at=NOW()+INTERVAL '1 hour' WHERE id=$1", [u.id, hash]);
  const before = (await db.query('SELECT password_hash, token_version FROM users WHERE id=$1', [u.id])).rows[0];
  const query = db.query;
  let changed = false;
  vi.spyOn(db, 'query').mockImplementation(async (sql, ...args) => {
    const result = await query(sql, ...args);
    if (!changed && String(sql).includes('SELECT id FROM users') && String(sql).includes('password_reset_token_hash')) {
      changed = true;
      await query(change === 'expired'
        ? "UPDATE users SET password_reset_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1"
        : "UPDATE users SET password_reset_token_hash='replacement' WHERE id=$1", [u.id]);
    }
    return result;
  });
  const result = await request(app).post('/auth/reset-password').send({ token, password: 'MustNotBecomePassword123!' });
  expect(changed).toBe(true);
  expect(result.status).toBe(400);
  expect((await db.query('SELECT password_hash, token_version FROM users WHERE id=$1', [u.id])).rows[0]).toEqual(before);
});
