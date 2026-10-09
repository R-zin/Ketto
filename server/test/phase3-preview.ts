/** Disposable UI preview; never touches the phones' organisation or session data. */
import { buildApp } from '../src/app.js';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const speech=resolve('data/speech');
process.env.STT_MODEL_PATH=join(speech,'vosk-model-small-en-us-0.15');
process.env.STT_PYTHON=join(speech,'runtime',process.platform==='win32'?'Scripts/python.exe':'bin/python');
await mkdir(resolve('data'),{recursive:true});
const dataDir=await mkdtemp(resolve('data/phase3-preview-'));
const password='phase3-demo-password';
const app=await buildApp({dataDir,adminPassword:password});
const request=async(method:any,url:string,body?:any,user?:any)=>{
  const r=await app.inject({method,url,payload:body,headers:user?{authorization:'Bearer '+user.token}:{}});
  if(r.statusCode>=400)throw new Error(r.body);return r.json();
};
const admin=await request('POST','/api/login',{email:'admin@kettoo.local',password});
async function member(name:string,email:string){
  const r=await request('POST','/api/register',{name,email,password,deviceName:'Preview browser'});
  await request('POST',`/api/admin/users/${r.userId}/approval`,{approved:true},admin);
  await request('POST',`/api/admin/devices/${r.deviceId}/approval`,{approved:true},admin);
  return request('POST','/api/login',{email,password,deviceId:r.deviceId});
}
const sender=await member('Preview sender','sender@phase3.preview');
const receiver=await member('Preview receiver','receiver@phase3.preview');
const channel=await request('POST','/api/admin/channels',{name:'Phase 3 demo / preview'},admin);
await request('PUT',`/api/admin/channels/${channel.id}/members`,{memberIds:[admin.user.id,sender.user.id,receiver.user.id]},admin);
await request('POST',`/api/conversations/${channel.id}/messages`,{id:randomUUID(),text:'PREVIEW: Please check the main entrance.',createdAt:Date.now()},sender);
const audio=await readFile(resolve('../../outputs/phase3/speech-fixture.wav'));
const boundary='phase3-preview-audio';
const upload=await app.inject({method:'POST',url:`/api/conversations/${channel.id}/files`,headers:{authorization:'Bearer '+sender.token,'content-type':`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="preview.wav"\r\nContent-Type: audio/wav\r\n\r\n`),audio,Buffer.from(`\r\n--${boundary}--\r\n`)])});
if(upload.statusCode!==200)throw new Error(upload.body);
const voice=await request('POST',`/api/conversations/${channel.id}/messages`,{id:randomUUID(),kind:'voice',attachmentId:upload.json().id,createdAt:Date.now()},sender);
await app.listen({host:'127.0.0.1',port:8793});
console.log('Preview: http://127.0.0.1:8793 | receiver@phase3.preview | phase3-demo-password');
console.log('Synthetic audio message: '+voice.id);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close().then(()=>process.exit(0)));
