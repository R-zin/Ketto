import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FileBlob,PresentationFile} from 'file:///C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const root='C:/Users/babur/OneDrive/Desktop/Kettoo/ketto_pvt';
const dir=root+'/artifacts/presentation-build';
const skill='C:/Users/babur/.codex/plugins/cache/openai-primary-runtime/presentations/26.1007.11041/skills/presentations';
process.env.RUNTIME_NODE_MODULES='C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const p=await PresentationFile.importPptx(await FileBlob.load(root+'/outputs/presentations/Kettoo-DEFINE-complete-v2.pptx'));
const raw=async f=>{const b=await fs.readFile(f);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
const slides=(await p.inspect({select:'$.slides[*]',include:['index','elements.id','elements.kind','elements.name','elements.text','elements.position']})).records;
for(const s of slides)for(const e of s.elements.filter(e=>e.kind==='image')){
 const im=p.resolve(e.id),frame=im.frame;
 const file=e.position.width>1000?dir+`/image${s.index===0?1:2}.png`:root+'/artifacts/ui-review/2026-10-10/'+(s.index===3?'cph2613-message-log-keyboard-final.png':s.index===6?'cph2613-settings-installed-final-middle.png':'cph2613-comms-installed-final.png');
 im.replace({blob:await raw(file),contentType:'image/png',alt:e.position.width>1000?'Original DEFINE template artwork':'Actual installed Kettoo Android screenshot'});im.frame=frame;
}
function edit(index,old,value,position,size){
 const e=slides[index].elements.find(e=>e.text===old);if(!e)throw new Error('Missing text: '+old);
 const sh=p.resolve(e.id);sh.text.replace(old,value);if(position)sh.position=position;if(size)sh.text.style={typeface:'Arial',fontSize:size,color:'#262626',alignment:'left'};return sh;
}
edit(1,'Communication and coordination\nfor event teams','A private communicator\non staff members’ phones');
edit(1,'Event teams work across different floors and zones. They need to reach the right people quickly and know who is handling each reported issue.','Teams in conferences, hackathons, malls and hospitals need quick coordination. Staff phones can bring text and media sharing alongside walkie-talkie voice.');
edit(1,'Kettoo is a private platform for organisers and volunteers. It combines walkie-talkie voice and messaging with venue check-ins and issue tracking in an Android app and a browser console.','Kettoo combines push-to-talk, chat, photo/video sharing and private calls in an Android app and browser console. Admins approve access, manage channels and broadcast to everyone.');
edit(1,'Local queues and direct Nearby communication help approved Android phones continue during outages.','The organisation hosts its server, media and history. Local queues and direct Android Nearby links support outage recovery.');
p.slides.items[1].speakerNotes.text='The supplied challenge identifies conferences, hackathons, malls and hospitals as use cases. Kettoo currently has a development/demo implementation with event-oriented venue operations. These sectors are intended applications, not established customers or validated hospital deployments. Core capabilities: PTT, text/media, private voice/video calls, approved organisational membership, admin controls, broadcast and local infrastructure. Direct Nearby is Android-only fallback. Sources: user-supplied problem statement; README.md; PROJECT_SUMMARY.md; docs/nearby-failover.md.';

const brief='Large conferences, hackathons, malls, and hospitals still rely on walkie-talkies for team coordination, which require cost, charging, and maintenance while supporting only voice communication.\n\nBuild a communicator app that runs on staff members’ phones, providing instant push-to-talk for individuals or team channels, along with chat, photo/video sharing, and voice/video calls in a familiar messaging interface.\n\nThe system must operate as a closed organisational network, where only authorised members can join and admins manage teams and channels. Provide an admin view to monitor online users and active channels, with the ability to broadcast to everyone.\n\nPrefer direct device-to-device communication where possible, while handling network congestion, patchy connectivity, and locked phones. All messages and media must remain within the organisation’s own infrastructure.';
for(const e of slides[2].elements.filter(e=>e.text&&e.text!=='Problem Statement'))p.resolve(e.id).text='';
const s=p.slides.items[2];
const quote=s.shapes.add({geometry:'textbox',name:'Supplied problem statement',position:{left:72,top:128,width:1125,height:550},fill:'none',line:{fill:'none',width:0}});
quote.text=brief;quote.text.style={typeface:'Arial',fontSize:26,color:'#262626',alignment:'left'};quote.text.insets=0;
s.speakerNotes.text='Exact problem statement supplied by the user. Paragraph breaks added for readability. The brief sets requirements, not verified findings about current customers or cost savings. Smartphones also need charging. Kettoo online media uses organisation-hosted LiveKit, with direct Nearby fallback on Android. Private PTT has permission restrictions; it is not arbitrary one-to-one PTT for every approved pair. Locked-screen receive has historical device evidence, while guaranteed locked-screen hardware transmission and congestion performance still need acceptance. Source: user-supplied challenge in this conversation.';

edit(3,'One workspace for communication\nand follow-through','A closed organisation network\nwith a familiar messaging interface');
edit(3,'Kettoo connects volunteers in the Android app with organisers in the browser console, using an organisation-hosted server.','Staff communicate through the Android app. Admins manage access, presence and channels in the browser console.');
edit(3,'Talk to the right team','Push-to-talk and private calls');
edit(3,'Use channel PTT, duty-admin exchanges and targeted broadcasts.','Use permitted team/private PTT, voice/video calls and broadcasts to everyone.');
edit(3,'Keep each report actionable','Chat and media sharing');
edit(3,'Add a zone and photo, confirm an owner, then track replies and resolution.','Send text, photos, videos and voice notes. Keep saved PTT bursts available for replay.');
edit(3,'Retain the communication record','Organisation control and recovery');
edit(3,'Replay saved voice, read local English transcripts and acknowledge your own copy.','Approve members and devices, restrict channel access and recover through local queues and Nearby.');
p.slides.items[3].speakerNotes.text+='\n\nAlignment with supplied challenge: authorised membership, admin channel/presence controls, all-staff broadcast and private organisational infrastructure. Private live PTT requires eligible teammate or duty-admin access, while approved private text/calls have separate rights. Device-to-device communication currently acts as outage fallback, rather than the primary online path. No measured congestion or universal locked-phone guarantee.';

edit(4,'HTTP and WebSocket carry application state. LiveKit carries online media.\nNearby connects permitted Android peers directly during outages.','The organisation hosts the API, database, attachments and LiveKit media service.\nNearby provides direct Android fallback. No cloud chat or speech API is required.');
edit(5,'Durable message history','Chat, media and history');
edit(5,'Text and attachments, saved PTT replay, delivery states and personal acknowledgement/archive.','Text, photos, videos and voice notes, with saved PTT replay, delivery states and personal archive.');
edit(5,'Access and field controls','Admin and field controls');
edit(5,'Account/device approval, channel permissions, optional Volume Down PTT and Pocket Mode.','Approve accounts/devices, manage channels and view presence. Optional hardware PTT and Pocket Mode.');
edit(6,'Demo scenario: a volunteer reports\na power issue in a hall','Demo: communicate, share media\nand manage a closed team');
edit(6,'Approve two phones, select a channel and start duty.','Approve two phones, assign channels and inspect online presence.');
edit(6,'02  Report and record','02  Talk, message and share');
edit(6,'Hold TALK, then inspect the saved replay and transcript.','Use PTT, send text and a photo, then inspect the saved replay.');
edit(6,'03  Coordinate the response','03  Call and broadcast');
edit(6,'Check in, create an issue, claim it, reply and resolve it.','Show a private call and an admin broadcast to everyone.');
p.slides.items[6].speakerNotes.text+='\n\nRevised core demo aligns with the supplied challenge. Show message/video attachment and voice/video call eligibility, then admin presence and All Staff broadcast. End any call or reserved exchange before competing audio. For issue operations, use an optional extension after the core communication demo. Locked-phone receive should be checked on the actual phones. Do not imply guaranteed locked-screen PTT.';
edit(7,'Route requests to permitted teams.\n\nGive each issue a visible owner and status.\n\nKeep voice reports available for replay and acknowledgement.\n\nLet organisations host their data and services.','Use staff phones for communication.\n\nShare text, photos and video.\n\nKeep access under administrator control.\n\nStore data on organisation infrastructure.');
edit(7,'Venue-scale load, radio range, longer duty sessions and deployment acceptance remain to be tested. No staff-capacity or response-time claim yet.','Congestion, venue-scale load, radio range and locked-phone behaviour need further acceptance. Direct Nearby is Android fallback, not multi-hop mesh.');
edit(8,'Kettoo connects event communication\nwith accountable issue handling','Kettoo brings private staff\ncommunication onto existing phones');
edit(8,'We have built an Android app, a browser console and a private backend for event teams to communicate, report their zone and manage issues through resolution.','Kettoo combines PTT, chat, media sharing and private calls with administrator-controlled membership and broadcasts, on organisation-owned infrastructure.');
edit(8,'Immediate voice with a durable history.\nPermission-controlled access and local speech.\nQueued recovery and direct Android Nearby fallback.','Voice and messaging in one interface.\nClosed access and organisation-hosted storage.\nLocal queues and direct Android Nearby fallback.');
edit(8,'Next milestone: complete acceptance testing under realistic venue conditions, then prepare a signed release and organisation deployment.','Next milestone: validate congestion, patchy connectivity and locked-phone behaviour, then prepare a signed release and organisation deployment.');

for(const [i,slide] of p.slides.items.entries())await fs.writeFile(dir+`/aligned-slide-${String(i+1).padStart(2,'0')}.png`,new Uint8Array(await(await slide.export({format:'png',scale:1})).arrayBuffer()));
const candidatePath=dir+'/aligned-candidate.pptx';await(await PresentationFile.exportPptx(p)).save(candidatePath);
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({workspaceDir:root,candidatePath,finalPath:root+'/outputs/presentations/Kettoo-DEFINE-aligned-v3.pptx',pythonExecutable:'C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit','--require-native-table-slide','5'],explicitTotalSlideCount:9,requiredNativeTableOwnerSlides:[5],fontPolicy:{basis:'design',families:['Arial','Clash Display']},verifyArtifactToolImport:true,receiptPath:dir+'/aligned-validation-v3.json'});
console.log(JSON.stringify({path:result.finalPath,layoutFindings:result.presentationLayout.findingCount}));


