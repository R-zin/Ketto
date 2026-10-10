import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FileBlob,PresentationFile} from 'file:///C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const root='C:/Users/babur/OneDrive/Desktop/Kettoo/ketto_pvt';
const dir=root+'/artifacts/presentation-build';
const skill='C:/Users/babur/.codex/plugins/cache/openai-primary-runtime/presentations/26.1007.11041/skills/presentations';
process.env.RUNTIME_NODE_MODULES='C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const p=await PresentationFile.importPptx(await FileBlob.load(root+'/outputs/presentations/Kettoo-DEFINE-slide-02.pptx'));
const raw=async f=>{const b=await fs.readFile(f);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
const sourceSlides=(await p.inspect({select:'$.slides[*]',include:['index','elements.id','elements.kind','elements.position']})).records;
for(const slide of sourceSlides)for(const e of slide.elements.filter(e=>e.kind==='image')){
 const im=p.resolve(e.id), frame=im.frame;
 const isBackground=e.position.width>1000;
 const file=isBackground?dir+`/image${slide.index===0?1:2}.png`:root+'/artifacts/ui-review/2026-10-10/cph2613-comms-installed-final.png';
 im.replace({blob:await raw(file),contentType:'image/png',alt:isBackground?'Original DEFINE template artwork':'Actual installed Kettoo Android Comms screen'});im.frame=frame;
}
function text(s,name,value,x,y,w,h,size=27,bold=false,color='#262626'){
 const sh=s.shapes.add({geometry:'textbox',name,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 sh.text=value;sh.text.style={typeface:'Arial',fontSize:size,bold,color,alignment:'left'};sh.text.insets=0;return sh;
}
function heading(s,value){text(s,'Content headline',value,72,128,1130,108,40,true)}
function notes(s,body,sources){s.speakerNotes.text=body+'\n\nSources: '+sources+'. Project records reviewed 10 October 2026.'}
async function screen(s,file,alt,x=942,y=128,w=232,h=518){s.images.add({blob:await raw(root+'/artifacts/ui-review/2026-10-10/'+file),contentType:'image/png',alt,fit:'contain',position:{left:x,top:y,width:w,height:h}})}

// 3. Problem statement: an operating scenario, not invented survey findings.
{
 const s=p.slides.items[2];heading(s,'A spoken request still needs\na location, an owner and a record');
 text(s,'Operating scenario','During an event, volunteers work in different zones. A request for help needs to reach the right team and remain visible until someone resolves it.',72,263,1100,92,28);
 const items=[['Reaching the right people','Separate conversations can make urgent updates difficult to route.'],['Keeping track of responsibility','A voice exchange alone does not show who owns an issue or whether it is resolved.'],['Working through an outage','Loss of the server connection can interrupt communication and delay updates.']];
 items.forEach(([a,b],i)=>{const y=384+i*96;text(s,'Problem '+(i+1),a,72,y,375,36,27,true);text(s,'Problem detail '+(i+1),b,483,y,695,72,26)});
 notes(s,'Frame these as the coordination challenges Kettoo is designed to address. We have not conducted a user survey or measured response-time savings. Example: a volunteer reports a power issue in a hall. An organiser needs the location, an accountable owner and a later resolution update. The next slide maps these needs to the implemented workflow.','PROJECT_SUMMARY.md sections 1, 3.8 and 3.9; overview_till_phase2.md');
}

// 4. Proposed solution, backed by an actual message-log screenshot.
{
 const s=p.slides.items[3];text(s,'Solution headline','One workspace for communication\nand follow-through',72,128,820,104,40,true);
 text(s,'Solution introduction','Kettoo connects volunteers in the Android app with organisers in the browser console, using an organisation-hosted server.',72,264,780,96,28);
 const rows=[['Talk to the right team','Use channel PTT, duty-admin exchanges and targeted broadcasts.'],['Keep each report actionable','Add a zone and photo, confirm an owner, then track replies and resolution.'],['Retain the communication record','Replay saved voice, read local English transcripts and acknowledge your own copy.']];
 rows.forEach(([a,b],i)=>{const y=360+i*110;text(s,'Solution label '+i,a,72,y,780,32,26,true);text(s,'Solution detail '+i,b,72,y+37,780,65,25)});
 await screen(s,'cph2613-message-log-keyboard-final.png','Actual Kettoo Message Log screen with the keyboard and composer visible');
 text(s,'Solution screenshot caption','Android Message Log',942,658,260,28,20,false,'#666666');
 notes(s,'The workflow links immediate communication to a durable operational record. Private calls, attachments, messages and archive complement PTT. Ownership changes and acknowledgements need server confirmation. Vosk provides recorded-message English transcription, not live captions. Screenshot is an actual historical installed-app capture and shows the message composer above the keyboard.','PROJECT_SUMMARY.md sections 3.2–3.5, 3.9 and 3.10; docs/ui-ux-review-comms.md; image: artifacts/ui-review/2026-10-10/cph2613-message-log-keyboard-final.png');
}

// 5. Editable native architecture/stack table.
{
 const s=p.slides.items[4];heading(s,'Organisation-hosted services\nwith local recovery on each client');
 const rows=[['Layer','Technology','Responsibility'],['Android app','Kotlin, Compose, Room','Field controls, local cache and queued work'],['Browser console','React, TypeScript, IndexedDB','Communication, operations and administration'],['API and storage','Fastify, WebSocket, SQLite','Approval, permissions, issue state and history'],['Live audio / video','Self-hosted LiveKit','PTT, broadcasts and private calls'],['Speech and failover','Vosk, FFmpeg, Nearby Connections','Local English recognition and direct Android links']];
 const table=s.tables.add({rows:6,columns:3,left:72,top:259,width:1134,height:350,columnWidths:[230,345,559],values:rows});
 table.borders.assign({fill:'#DDDDDD',width:1,style:'solid'});
 for(let r=0;r<6;r++)for(let c=0;c<3;c++){const cell=table.getCell(r,c);cell.fill=r===0?'#A80000':'#FFFFFF';cell.text.style={typeface:'Arial',fontSize:23,bold:r===0,color:r===0?'#FFFFFF':'#262626'};}
 text(s,'Architecture transport detail','HTTP and WebSocket carry application state. LiveKit carries online media.\nNearby connects permitted Android peers directly during outages.',72,636,1125,56,23,false,'#555555');
 notes(s,'The API derives media room grants and manages speaking leases. SQLite and private files store server state. Android Room and browser IndexedDB preserve pending operations. Nearby is an Android-only direct transport, not a replicated venue database or multi-hop mesh. Vosk runs on-device and in a local server worker, with FFmpeg handling uploaded audio formats. Deployment uses a Node application service, LiveKit and Caddy HTTPS.','PROJECT_SUMMARY.md section 5; README.md; server/package.json; web/package.json; docs/nearby-failover.md; server/speech/README.md');
}

// 6. Six concise parallel feature groups, without decorative cards.
{
 const s=p.slides.items[5];text(s,'Feature headline','Implemented features through version 0.3.0',72,129,1120,66,40,true);
 const groups=[
 ['Live communication','Hold-to-talk with a 30-second limit, duty-admin exchanges, targeted broadcasts and private voice/video calls.'],
 ['Durable message history','Text and attachments, saved PTT replay, delivery states and personal acknowledgement/archive.'],
 ['Venue operations','Floor plans, named zones, staff check-ins and issue claims, replies, reassignment and resolution.'],
 ['Offline continuity','Local queues and direct Nearby TALK/media on approved Android phones, with later server sync.'],
 ['Local speech tools','English transcripts of saved audio and editable offline dictation, without a cloud speech API.'],
 ['Access and field controls','Account/device approval, channel permissions, optional Volume Down PTT and Pocket Mode.']
 ];
 groups.forEach(([a,b],i)=>{const x=i<3?72:669,y=245+(i%3)*142;text(s,'Feature heading '+i,a,x,y,527,36,28,true);text(s,'Feature description '+i,b,x,y+44,527,83,25)});
 text(s,'Feature scope','The backend and browser also support volunteers in multiple operational channels.',72,675,1120,24,21,false,'#666666');
 notes(s,'All groups describe implemented capabilities. Acknowledgement, calls and issue ownership need the server. Nearby requires approved phones, permissions and unexpired credentials. Locked-screen key behaviour remains device dependent. The current backend/browser multi-channel model supersedes the original single-team rule; full Android multi-channel acceptance remains open.','PROJECT_SUMMARY.md sections 3.1–3.11; README.md; docs/nearby-failover.md; docs/ui-ux-review-settings.md; server/src/phase2.ts; server/src/db.ts');
}

// 7. Demonstration plan rather than claims that a new live demonstration ran.
{
 const s=p.slides.items[6];text(s,'Demo headline','Demo scenario: a volunteer reports\na power issue in a hall',72,128,830,106,40,true);
 const steps=[['01  Prepare the team','Approve two phones, select a channel and start duty.'],['02  Report and record','Hold TALK, then inspect the saved replay and transcript.'],['03  Coordinate the response','Check in, create an issue, claim it, reply and resolve it.'],['04  Demonstrate recovery','With Nearby enabled, pause the API, exchange direct TALK/text, restore it and verify sync.']];
 steps.forEach(([a,b],i)=>{const y=261+i*105;text(s,'Demo step '+i,a,72,y,790,34,27,true);text(s,'Demo action '+i,b,72,y+38,790,58,25)});
 await screen(s,'cph2613-settings-installed-final-middle.png','Actual Settings screen with hardware PTT and Nearby failover controls');
 text(s,'Demo screenshot caption','Hardware PTT and Nearby',920,658,294,28,20,false,'#666666');
 notes(s,'This is a proposed live demonstration sequence using implemented features, not a claim that this presentation session performed it. Before presenting, approve all devices, configure a real floor/zone, connect the media service and confirm the English model. Use a designated duty admin if demonstrating private exchanges. Enable Nearby on both approved phones and keep credentials valid. Controlled API-outage testing must keep the access point and radios available. Restore the API after the demonstration. The selected screenshot shows the feature controls with Nearby off and the phone off duty, so enable these before a real demo. The power issue and hall are illustrative.','PROJECT_SUMMARY.md sections 3 and 6; overview_phase3.md demo sequence; docs/nearby-failover.md; image: artifacts/ui-review/2026-10-10/cph2613-settings-installed-final-middle.png');
}

// 8. Separate intended benefit from actual verification and untested scale.
{
 const s=p.slides.items[7];heading(s,'A working prototype with evidence\nand a clear path to venue acceptance');
 text(s,'Impact section','Intended operational impact',72,268,515,36,29,true);
 text(s,'Impact content','Route requests to permitted teams.\n\nGive each issue a visible owner and status.\n\nKeep voice reports available for replay and acknowledgement.\n\nLet organisations host their data and services.',72,328,518,279,27);
 text(s,'Feasibility section','Feasibility and scalability',675,268,521,36,29,true);
 text(s,'Feasibility content','34/34 backend tests passed in the recorded verification run.\n\nTwo physical Android phones completed direct Nearby outage/recovery tests.\n\nAndroid, browser and server components have build and device evidence.',675,328,521,264,27);
 text(s,'Scalability qualification','Venue-scale load, radio range, longer duty sessions and deployment acceptance remain to be tested. No staff-capacity or response-time claim yet.',72,630,1122,61,23,false,'#555555');
 notes(s,'Impact statements are expected benefits, not measured improvements. The 34/34 result comes from the backend suite run while preparing PROJECT_SUMMARY.md on 10 October 2026, not a fresh run for this deck. Earlier verification counts belong to separate snapshots and must not be summed. Nearby physical tests involved OnePlus CPH2613 and Samsung SM-A356E with the local API paused while the Wi-Fi access point remained available. Playback counters confirm audio output delivery, not subjective intelligibility. Historical builds/lint and specific phone checks do not prove production acceptance. No deployment cost estimate, performance benchmark or maximum volunteer count is established.','PROJECT_SUMMARY.md sections 4, 6 and 7; VERIFICATION.md; overview_till_phase2.md; docs/nearby-failover.md; docs/ui-ux-review-settings.md');
}

// 9. Conclusion with concrete current state and next milestone.
{
 const s=p.slides.items[8];heading(s,'Kettoo connects event communication\nwith accountable issue handling');
 text(s,'Conclusion statement','We have built an Android app, a browser console and a private backend for event teams to communicate, report their zone and manage issues through resolution.',72,280,1118,114,32);
 text(s,'Conclusion strengths label','Core strengths',72,428,1100,40,29,true);
 text(s,'Conclusion strengths','Immediate voice with a durable history.\nPermission-controlled access and local speech.\nQueued recovery and direct Android Nearby fallback.',72,480,1110,120,29);
 text(s,'Conclusion next milestone','Next milestone: complete acceptance testing under realistic venue conditions, then prepare a signed release and organisation deployment.',72,629,1115,63,24,false,'#555555');
 notes(s,'Close with the complete workflow: reach a team, retain the report, associate it with a place, confirm responsibility and record resolution. The current project is a development/demo implementation through Phase 3 with selected real-device evidence. Future work is broader device, venue load/range, noise/accent, long-session and deployment acceptance. Nearby remains direct peer-to-peer, and no venue-wide mesh guarantee is claimed.','PROJECT_SUMMARY.md sections 1, 4, 7 and 8; README.md');
}

for(const [i,s] of p.slides.items.entries()){
 const stem=`complete-slide-${String(i+1).padStart(2,'0')}`;
 await fs.writeFile(dir+'/'+stem+'.png',new Uint8Array(await(await s.export({format:'png',scale:1})).arrayBuffer()));
 await fs.writeFile(dir+'/'+stem+'.layout.json',await(await s.export({format:'layout'})).text());
}
await fs.writeFile(dir+'/complete-montage.webp',new Uint8Array(await(await p.export({format:'webp',montage:true,scale:0.5})).arrayBuffer()));
const candidatePath=dir+'/complete-candidate.pptx';await(await PresentationFile.exportPptx(p)).save(candidatePath);
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({workspaceDir:root,candidatePath,finalPath:root+'/outputs/presentations/Kettoo-DEFINE-complete-v2.pptx',pythonExecutable:'C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit','--require-native-table-slide','5'],explicitTotalSlideCount:9,requiredNativeTableOwnerSlides:[5],fontPolicy:{basis:'design',families:['Arial','Clash Display']},verifyArtifactToolImport:true,receiptPath:dir+'/complete-validation-v2.json'});
console.log(JSON.stringify({finalPath:result.finalPath,integrity:result.packageIntegrity.status,findings:result.presentationLayout.findingCount}));
