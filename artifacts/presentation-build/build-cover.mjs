import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import { FileBlob, PresentationFile } from 'file:///C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const workspaceDir='C:/Users/babur/OneDrive/Desktop/Kettoo/ketto_pvt';
const SKILL_DIR='C:/Users/babur/.codex/plugins/cache/openai-primary-runtime/presentations/26.1007.11041/skills/presentations';
const dir=workspaceDir+'/artifacts/presentation-build';
process.env.RUNTIME_NODE_MODULES='C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const source='C:/Users/babur/Downloads/Software - DEFINE Template.pptx';
const referenceSha256=createHash('sha256').update(await fs.readFile(source)).digest('hex');
const p=await PresentationFile.importPptx(await FileBlob.load(source));
const s=p.slides.items[0];
for(const [i,slide] of p.slides.items.entries()){
 const bytes=await fs.readFile(dir+`/image${i===0?1:2}.png`);
 const im=slide.images.items[0];
 const frame=im.frame;
 im.replace({blob:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),contentType:'image/png',alt:i===0?'Original DEFINE cover background':'Original DEFINE template background'});
 im.frame=frame;
}
const records=(await p.inspect({select:'$.slides[0].elements[*]',include:['id','text']})).records;
const teamRecord=records.find(r=>r.text==='Team Name & Team Number');
const team=p.resolve(teamRecord.id);
team.text.replace('Team Name & Team Number','Team Codio');
team.position={left:272.52,top:310.31,width:761.81,height:67.86};
team.text.style={typeface:'Arial',fontSize:48,bold:true,color:'#FFFFFF',alignment:'center'};
function text(name,value,position,size,bold=false){
 const x=s.shapes.add({geometry:'textbox',name,position,fill:'none',line:{fill:'none',width:0}});
 x.text=value;
 x.text.style={typeface:'Arial',fontSize:size,bold,color:'#FFFFFF',alignment:'center'};
 return x;
}
text('Project name','Kettoo',{left:260,top:175,width:760,height:110},88,true);
text('Project description','Private communication and coordination for event teams',{left:240,top:477,width:800,height:54},26);
s.speakerNotes.text='Kettoo is a native Android app, browser console and organisation-hosted backend for event communication and coordination. The implementation includes live push-to-talk, messages, venue check-ins and issue workflows. Source: PROJECT_SUMMARY.md and README.md in the Kettoo project, reviewed 10 October 2026. Team name: Codio, as supplied by the presenter. Team number omitted at the presenter\'s request.';
await fs.writeFile(dir+'/cover-preview.png',new Uint8Array(await (await s.export({format:'png',scale:1})).arrayBuffer()));
await fs.writeFile(dir+'/cover-after-layout.json',await (await s.export({format:'layout'})).text());
for(const [i,slide] of p.slides.items.entries()){
 await fs.writeFile(dir+`/draft-${i+1}.png`,new Uint8Array(await (await slide.export({format:'png',scale:1})).arrayBuffer()));
}
const candidatePath=dir+'/cover-candidate.pptx';
await (await PresentationFile.exportPptx(p)).save(candidatePath);
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL_DIR,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({workspaceDir,candidatePath,finalPath:workspaceDir+'/outputs/presentations/Kettoo-DEFINE-slide-01-v3.pptx',pythonExecutable:'C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],explicitTotalSlideCount:9,requiredNativeTableOwnerSlides:[],fontPolicy:{basis:'design',families:['Arial','Clash Display']},verifyArtifactToolImport:true,receiptPath:dir+'/cover-validation-v3.json'});
console.log(JSON.stringify(result));

