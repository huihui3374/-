import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const phase=process.argv[2], root=process.env.QA_ROOT;
try {
  const report=JSON.parse(await fs.readFile(path.join(root,'reports',phase+'.json'),'utf8'));
  try {report.screenshotSha256=createHash('sha256').update(await fs.readFile(path.join(root,'reports',phase+'.png'))).digest('hex');} catch {}
  const text=JSON.stringify(report,null,2);
  console.log(text);
  if(process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,'### '+phase+' Windows test\n\n```json\n'+text+'\n```\n');
} catch(error) {
  console.log('No completed test report: '+error.message);
}
