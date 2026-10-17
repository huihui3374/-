// Only synthetic simulator state and an encrypted synthetic profile are transferred.
import fs from 'node:fs/promises';
import path from 'node:path';
const names=['protocol-state.json','license-v1.json','first-machine.json'];
if(process.argv[2]==='export') {
  const root=path.join(process.env.QA_ROOT,'handoff'), data={};
  for(const name of names) data[name]=await fs.readFile(path.join(root,name),'utf8');
  const text=Buffer.from(JSON.stringify(data)).toString('base64');
  if(text.length>100000) throw Error('Synthetic handoff exceeded expected bound');
  await fs.appendFile(process.env.GITHUB_OUTPUT,'data='+text+'\n');
} else if(process.argv[2]==='import') {
  const text=process.env.QA_HANDOFF_DATA;
  if(!text || text.length>100000) throw Error('Synthetic handoff missing or oversized');
  const data=JSON.parse(Buffer.from(text,'base64').toString()), root=path.join(process.env.QA_ROOT,'imported-handoff');
  await fs.mkdir(root,{recursive:true});
  for(const name of names) {if(typeof data[name]!=='string') throw Error('Incomplete handoff');await fs.writeFile(path.join(root,name),data[name]);}
  await fs.appendFile(process.env.GITHUB_ENV,'QA_HANDOFF='+root+'\n');
} else throw Error('Specify export or import');
