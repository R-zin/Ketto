/** Approve only the disposable preview's pending browser devices. */
import { DatabaseSync } from 'node:sqlite';
import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const names=(await readdir(resolve('data'))).filter(n=>n.startsWith('phase3-preview-'));
if(names.length!==1)throw new Error('Specify the one running preview; refusing an ambiguous selection.');
const db=new DatabaseSync(join(resolve('data'),names[0],'kettoo.sqlite'),{readOnly:true});
const admin=db.prepare("SELECT d.id FROM devices d JOIN users u ON u.id=d.user_id WHERE u.email='admin@kettoo.local' AND d.approved=1").get() as {id:string};
const pending=db.prepare("SELECT d.id FROM devices d JOIN users u ON u.id=d.user_id WHERE d.approved=0 AND u.email IN ('admin@kettoo.local','receiver@phase3.preview','sender@phase3.preview')").all() as {id:string}[];
db.close();
const base='http://127.0.0.1:8793/api';
const login=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@kettoo.local',password:'phase3-demo-password',deviceId:admin.id})});
if(!login.ok)throw new Error('Preview admin login failed');
const {token}=await login.json() as {token:string};
for(const d of pending){const r=await fetch(base+`/admin/devices/${d.id}/approval`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({approved:true})});if(!r.ok)throw new Error('Preview approval failed');}
console.log(`Approved ${pending.length} disposable preview devices.`);
