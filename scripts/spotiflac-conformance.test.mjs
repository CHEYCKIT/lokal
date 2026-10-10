// Point SPOTIFLAC_EXTENSION_DIR at an upstream SpotiFLAC-Extension checkout to
// verify its real registry packages without contacting provider services.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const Database=require('better-sqlite3')
const {PackageService,readArchive}=require('../electron/spotiflac/packages')
const reference=process.env.SPOTIFLAC_EXTENSION_DIR

for(const file of ['amzn.sflx','soundcloud.sflx','ytmusic-spotiflac.sflx','deezer.sflx','qobuz-web.sflx','tidal-web.sflx']){
  test(`real upstream ${file} registers and initializes in the isolated runtime`,{skip:!reference},async t=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'lokal-conformance-')),db=new Database(':memory:')
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT)')
    const service=new PackageService(db,{root,tools:()=>({})})
    t.after(async()=>{for(const runtime of service.runtimes.values())runtime.close();db.close();await fs.rm(root,{recursive:true,force:true})})
    const buffer=await fs.readFile(path.join(reference,'extensions',file)),{manifest}=readArchive(buffer)
    const installed=await service.install({buffer})
    const runtime=await service.runtime(installed.key)
    assert.ok(runtime.methods.includes('download'))
    assert.ok(runtime.methods.includes('customSearch'))
    assert.equal(installed.name,manifest.displayName)
    await runtime.invoke('cleanup')
  })
}
