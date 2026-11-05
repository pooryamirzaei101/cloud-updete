import {audioUploadMime,podcastMime} from "@/lib/podcast-media";
export async function uploadAdminMedia(file:File,kind:"audio"|"video"|"document",progress:(message:string)=>void){
  if(!file.size||file.size>100_000_000)throw new Error("Choose a file up to 100 MB.");
  if(kind==="document"&&(!file.name.toLowerCase().endsWith(".pdf")||(file.type&&file.type!=="application/pdf")))throw new Error("Choose a PDF file up to 100 MB.");
  const start=await fetch("/api/admin/media-uploads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,mimeType:kind==="document"&&file.name.toLowerCase().endsWith(".pdf")?"application/pdf":kind==="audio"?audioUploadMime(file):podcastMime(file)||file.type,size:file.size})});
  const session=await start.json() as {error?:string;key?:string;uploadId?:string;partSize?:number};
  if(!start.ok||!session.key||!session.uploadId||!session.partSize)throw new Error(session.error||"Could not start upload.");
  const params=new URLSearchParams({key:session.key,uploadId:session.uploadId});
  try{
    const parts:{partNumber:number;etag:string}[]=[];
    const total=Math.ceil(file.size/session.partSize);
    let next=0,completed=0;
    async function worker(){while(next<total){
      const index=next++;
      const piece=file.slice(index*session.partSize,Math.min(file.size,(index+1)*session.partSize));
      const result=await fetch(`/api/admin/media-uploads?${params}&partNumber=${index+1}`,{method:"PUT",body:piece});
      const data=await result.json() as {error?:string;partNumber?:number;etag?:string};
      if(!result.ok||!data.etag)throw new Error(data.error||`Part ${index+1} failed.`);
      parts.push({partNumber:index+1,etag:data.etag});
      completed++;
      progress(`Uploaded ${completed} of ${total} parts… Keep this page open.`);
    }}
    await Promise.all(Array.from({length:Math.min(3,total)},()=>worker()));
    parts.sort((a,b)=>a.partNumber-b.partNumber);
    progress("Finishing upload…");
    const complete=await fetch(`/api/admin/media-uploads?${params}&action=complete`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({parts})});
    const done=await complete.json() as {error?:string;key?:string};
    if(!complete.ok||!done.key)throw new Error(done.error||"Could not finish upload.");
    return done.key;
  }catch(error){await fetch(`/api/admin/media-uploads?${params}&action=abort`,{method:"DELETE"}).catch(()=>{});throw error}
}
export async function discardAdminMedia(key:string){await fetch(`/api/admin/media-uploads?${new URLSearchParams({key})}`,{method:"DELETE"}).catch(()=>{})}
export async function prepareAdminMedia(form:HTMLFormElement,field:"video"|"audio",progress:(message:string)=>void){
  const body=new FormData(form),file=body.get(field);
  let key:string|null=null;
  if(file instanceof File&&file.size){key=await uploadAdminMedia(file,field==="video"?"video":"audio",progress);body.set("uploadKey",key)}
  body.delete(field);
  return {body,key};
}
