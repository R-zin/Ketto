import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FileBlob,PresentationFile} from 'file:///C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const root='C:/Users/babur/OneDrive/Desktop/Kettoo/ketto_pvt';
const dir=root+'/artifacts/presentation-build';
const skill='C:/Users/babur/.codex/plugins/cache/openai-primary-runtime/presentations/26.1007.11041/skills/presentations';
process.env.RUNTIME_NODE_MODULES='C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const p=await PresentationFile.importPptx(await FileBlob.load(root+'/outputs/presentations/Kettoo-DEFINE-slide-01-v3.pptx'));
for(const [i,s] of p.slides.items.entries()){
 const bytes=await fs.readFile(dir+`/image${i===0?1:2}.png`);
 const im=s.images.items[0], frame=im.frame;
 im.replace({blob:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),contentType:'image/png',alt:'Original DEFINE template artwork'});
 im.frame=frame;
}
const s=p.slides.items[1];
function text(name,value,position,size,bold=false,color='#262626'){
 const sh=s.shapes.add({geometry:'textbox',name,position,fill:'none',line:{fill:'none',width:0}});
 sh.text=value;
 sh.text.style={typeface:'Arial',fontSize:size,bold,color,alignment:'left'};
 sh.text.insets=0;
 return sh;
}
text('Introduction headline','Communication and coordination\nfor event teams',{left:72,top:132,width:790,height:100},42,true);
text('Event context','Event teams work across different floors and zones. They need to reach the right people quickly and know who is handling each reported issue.',{left:72,top:266,width:770,height:108},27);
text('Project introduction','Kettoo is a private platform for organisers and volunteers. It combines walkie-talkie voice and messaging with venue check-ins and issue tracking in an Android app and a browser console.',{left:72,top:399,width:770,height:124},27);
text('Continuity during outages','Local queues and direct Nearby communication help approved Android phones continue during outages.',{left:72,top:564,width:770,height:72},24,false,'#555555');
const bytes=await fs.readFile(root+'/artifacts/ui-review/2026-10-10/cph2613-comms-installed-final.png');
s.images.add({blob:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),contentType:'image/png',alt:'Actual Kettoo Android Live Voice screen showing the stage channel and TALK control',fit:'contain',position:{left:936,top:121,width:236,height:527}});
text('Screenshot caption','Kettoo Android app',{left:936,top:658,width:250,height:28},20,false,'#666666');
s.speakerNotes.text='Kettoo serves event organisers and volunteers working across venue zones. This introduction establishes the operating context before the next slide explains the coordination problem in more detail. Explain that Kettoo connects quick voice communication with persistent messages, zone check-ins and issues that have a confirmed owner and status. The Android app supports direct Nearby communication among approved, permitted phones during outages. Reach depends on direct connectivity, and this is not multi-hop mesh. Issue and check-in operations queue for server recovery. The browser does not implement Nearby.\n\nSources: PROJECT_SUMMARY.md sections 1, 3.3, 3.6, 3.7, 3.8 and 3.9; README.md; docs/nearby-failover.md. The event scenario describes the intended use case, not findings from a user study.\n\nImage: actual installed Android screenshot, artifacts/ui-review/2026-10-10/cph2613-comms-installed-final.png. This historical screenshot shows the app off duty. It is not a generated mockup.';
for(const [i,slide] of p.slides.items.entries()){
 const image=await slide.export({format:'png',scale:1});
 await fs.writeFile(dir+`/intro-deck-${i+1}.png`,new Uint8Array(await image.arrayBuffer()));
}
await fs.writeFile(dir+'/introduction-preview.png',await fs.readFile(dir+'/intro-deck-2.png'));
await fs.writeFile(dir+'/introduction-layout.json',await (await s.export({format:'layout'})).text());
await fs.writeFile(dir+'/introduction-montage.webp',new Uint8Array(await (await p.export({format:'webp',montage:true,scale:0.5})).arrayBuffer()));
const candidatePath=dir+'/introduction-candidate.pptx';
await(await PresentationFile.exportPptx(p)).save(candidatePath);
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({workspaceDir:root,candidatePath,finalPath:root+'/outputs/presentations/Kettoo-DEFINE-slide-02.pptx',pythonExecutable:'C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],explicitTotalSlideCount:9,requiredNativeTableOwnerSlides:[],fontPolicy:{basis:'design',families:['Arial','Clash Display']},verifyArtifactToolImport:true,receiptPath:dir+'/introduction-validation.json'});
console.log(JSON.stringify({finalPath:result.finalPath,findings:result.presentationLayout.findingCount,integrity:result.packageIntegrity.status}));
