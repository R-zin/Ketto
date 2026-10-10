import fs from 'node:fs/promises';
import { FileBlob, PresentationFile } from 'file:///C:/Users/babur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const dir = 'C:/Users/babur/OneDrive/Desktop/Kettoo/ketto_pvt/artifacts/presentation-build';
const p = await PresentationFile.importPptx(await FileBlob.load('C:/Users/babur/Downloads/Software - DEFINE Template.pptx'));
await fs.writeFile(dir+'/inspect.ndjson',(await p.inspect({select:'$.slides[*]',include:['id','index','layout','elements.id','elements.kind','elements.text','elements.position','elements.style']})).ndjson);
console.log('Slides',p.slides.items.length);
for (const [i,s] of p.slides.items.entries()) {
 await fs.writeFile(dir+`/template-${i+1}.png`,new Uint8Array(await (await s.export({format:'png',scale:1})).arrayBuffer()));
 if(i===0) await fs.writeFile(dir+'/cover-layout.json',await (await s.export({format:'layout'})).text());
}
await fs.writeFile(dir+'/template-montage.webp',new Uint8Array(await (await p.export({format:'webp',montage:true,scale:0.5})).arrayBuffer()));
console.log('Rendered');
