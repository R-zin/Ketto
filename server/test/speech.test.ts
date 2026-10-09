import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/db.js';
import { Transcripts, type Transcribe } from '../src/speech.js';

async function fixture(transcribe:Transcribe){
  const data=await mkdtemp(join(tmpdir(),'kettoo-speech-'));
  const db=new Store(join(data,'test.sqlite'));
  db.run("INSERT INTO users VALUES('u','User','user@test','unused','staff',1)");
  db.run("INSERT INTO devices(id,user_id,name,approved) VALUES('d','u','Phone',1)");
  db.run("INSERT INTO conversations VALUES('c','Team','channel',NULL)");
  db.run("INSERT INTO messages(id,conversation_id,sender_id,device_id,kind,attachment_id,created_at,received_at) VALUES('m','c','u','d','voice','audio',1,1)");
  const changes:string[]=[];const speech=new Transcripts(db,data,mid=>changes.push(mid),transcribe);
  return {db,speech,changes,close:async()=>{await speech.close();db.db.close();await rm(data,{recursive:true,force:true})}};
}
test('recording jobs defer to live audio and preserve the message identity',async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;return {text:'security needed at gate b'}});
  try{await f.speech.tick(true);assert.equal(calls,0);await f.speech.tick();assert.equal(calls,1);const result=f.db.get("SELECT * FROM message_transcripts WHERE message_id='m'");assert.equal(result.state,'ready');assert.equal(result.text,'security needed at gate b');assert.equal(f.db.get('SELECT COUNT(*) AS n FROM messages').n,1);await f.speech.tick();assert.equal(calls,1)}finally{await f.close()}
});
test('late recognition cannot overwrite a replacement recording or a sender transcript',async()=>{
  let finish!:(value:{text:string})=>void;const f=await fixture(()=>new Promise(resolve=>{finish=resolve}));
  try{const running=f.speech.tick();f.speech.attach('m','replacement',{text:'correct replacement',state:'ready',language:'en-US',engine:'device',error:''});finish({text:'stale audio'});await running;assert.equal(f.db.get("SELECT text FROM message_transcripts WHERE message_id='m'").text,'correct replacement')}finally{await f.close()}
});
test('recognition failure and silence remain explicit and retry can recover',async()=>{
  let attempt=0;const f=await fixture(async()=>{attempt++;if(attempt===1)throw new Error('decoder failed');return {text:attempt===2?'':'recovered words'}});
  try{await f.speech.tick();assert.equal(f.db.get("SELECT state FROM message_transcripts WHERE message_id='m'").state,'failed');f.speech.retry('m','audio');await f.speech.tick();assert.equal(f.db.get("SELECT state FROM message_transcripts WHERE message_id='m'").state,'unavailable');f.speech.retry('m','audio');await f.speech.tick();assert.equal(f.db.get("SELECT state FROM message_transcripts WHERE message_id='m'").state,'ready')}finally{await f.close()}
});
