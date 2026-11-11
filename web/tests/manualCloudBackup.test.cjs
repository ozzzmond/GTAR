const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8').replaceAll('import.meta.env','({DEV:false})'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)

test('each successful file handoff records BackupSaved once without account data', async () => {
 const {appLogger}=require('../src/utils/logger.ts');appLogger.resume()
 const {downloadBackup,shareOrDownloadBackup,copyBackup}=require('../src/utils/backupExport.ts')
 const backup={json:'{}',fileName:'private@example.com-token.json',bytes:2,counts:{songs:2,trash:0,setlists:1},fingerprint:'secret',schemaVersion:2}
 for (const handoff of [()=>downloadBackup(backup,{download(){}}),()=>shareOrDownloadBackup(backup,{makeFile:()=>({}),navigator:{canShare:()=>true,share:async()=>{}}}),()=>copyBackup(backup,{navigator:{clipboard:{writeText:async()=>{}}}})]) {
  appLogger.clearLogs();await handoff()
  assert.deepEqual(appLogger.getLogs().filter(e=>e.tag==='BackupSaved').map(e=>e.message),['Backup saved (file): 2 songs, 1 setlists'])
 }
})
