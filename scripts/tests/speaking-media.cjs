const ts=require('typescript'),vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
function load(file,stubs={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:n=>n in stubs?stubs[n]:require(n),fetch,File:require('node:buffer').File,Blob,Response,URLSearchParams,setTimeout});return module.exports}

const recording=load('lib/speaking-recording.ts');
assert.equal(recording.preferredRecordingMime(false,type=>type==='audio/mp4;codecs=mp4a.40.2'),'audio/mp4;codecs=mp4a.40.2');
assert.equal(recording.preferredRecordingMime(false,()=>false),undefined);
assert.equal(recording.baseRecordingMime('audio/webm;codecs=opus',false),'audio/webm');
assert.equal(recording.baseRecordingMime('',false),'audio/webm');
assert.equal(recording.recordingExtension('audio/mp4'),'m4a');

let active=0,maxActive=0,completedParts;
const originalFetch=global.fetch;
global.fetch=async(url,options={})=>{
  const value=String(url);
  if(options.method==='POST'&&!value.includes('?'))return Response.json({key:'staged/video/00000000-0000-0000-0000-000000000000',uploadId:'00000000-0000-0000-0000-000000000001',partSize:8});
  if(options.method==='PUT'){
    active++;maxActive=Math.max(maxActive,active);
    const part=Number(new URL(value,'https://test').searchParams.get('partNumber'));
    await new Promise(resolve=>setTimeout(resolve,(5-part)*5));active--;
    return Response.json({partNumber:part,etag:`etag-${part}`});
  }
  if(options.method==='POST'&&value.includes('action=complete')){completedParts=JSON.parse(options.body).parts;return Response.json({key:'staged/video/00000000-0000-0000-0000-000000000000'});}
  return Response.json({ok:true});
};

const uploads=load('lib/admin-upload-client.ts',{'@/lib/podcast-media':{audioUploadMime:file=>file.type,podcastMime:file=>file.type}});
(async()=>{const file=new (require('node:buffer').File)([new Uint8Array(32)],'lesson.mp4',{type:'video/mp4'});await uploads.uploadAdminMedia(file,'video',()=>{});assert.equal(maxActive,3);assert.deepEqual(completedParts.map(part=>part.partNumber),[1,2,3,4]);console.log('PASS: parallel admin video upload and cross-browser speaking recording formats.');})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{global.fetch=originalFetch});
