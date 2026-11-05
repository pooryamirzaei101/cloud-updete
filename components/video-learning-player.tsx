"use client";
import {loadPlaybackBlob} from "@/lib/video-playback";
import {LearningTranslation} from "@/components/learning-translation";
import {translationLanguages,translationDirection,type TranslationLanguage} from "@/lib/languages";

import { useEffect, useRef, useState } from "react";
import { BookmarkCheck, BookmarkPlus, Repeat2 } from "lucide-react";
import type { TranscriptSegment } from "@/lib/video";
import { InteractiveEnglish } from "@/components/interactive-english";
import { SpeakingRecorder } from "@/components/speaking-recorder";

export function VideoLearningPlayer({id,lines,src,signedIn,initiallySaved=[],startAt=0,speakingMode=false,canRecord=false,vertical=false,thumbnail,initialLanguage="fa"}:{initialLanguage?:TranslationLanguage;id:string;lines:TranscriptSegment[];src?:string;signedIn:boolean;initiallySaved?:number[];startAt?:number;speakingMode?:boolean;canRecord?:boolean;vertical?:boolean;thumbnail?:string}){
  const video=useRef<HTMLVideoElement>(null),list=useRef<HTMLDivElement>(null),rows=useRef<(HTMLDivElement|null)[]>([]),prompt=useRef<HTMLDivElement>(null),promptRows=useRef<(HTMLDivElement|null)[]>([]);
  const [translations,setTranslations]=useState<Record<number,string>>({}),[language,setLanguage]=useState<TranslationLanguage>(initialLanguage),[time,setTime]=useState(0),[playbackError,setPlaybackError]=useState(""),[mediaRetry,setMediaRetry]=useState(0),[localVideo,setLocalVideo]=useState<string|null>(null),[loadingVideo,setLoadingVideo]=useState(false),[loop,setLoop]=useState<[number,number]|null>(null),[speed,setSpeed]=useState(1),[showEnglish,setShowEnglish]=useState(true),[showTranslation,setShowTranslation]=useState(true),[saved,setSaved]=useState<number[]>(initiallySaved),[saving,setSaving]=useState<number|null>(null),[message,setMessage]=useState(""),[promptSize,setPromptSize]=useState(25);
  const blobUrl=useRef<string|null>(null),fallbackAttempted=useRef(false),loadController=useRef<AbortController|null>(null);
  useEffect(()=>()=>{loadController.current?.abort();if(blobUrl.current)URL.revokeObjectURL(blobUrl.current)},[]);
  const active=lines.findIndex(line=>time>=line.start&&time<line.end),line=lines[active];

  useEffect(()=>{setTranslations({});if(!signedIn)return;fetch(`/api/learning-translations?section=video&id=${id}&language=${language}`).then(r=>r.json() as Promise<any>).then(d=>{if(d.fields)setTranslations(Object.fromEntries(d.fields.filter((f:any)=>f.key.startsWith("segment-")).map((f:any)=>[Number(f.key.slice(8)),f.translation])))}).catch(()=>{})},[id,language,signedIn]);
  useEffect(()=>{if(video.current)video.current.playbackRate=speed},[speed]);
  useEffect(()=>{
    if(active<0)return;
    for(const [container,target] of [[list.current,rows.current[active]],[prompt.current,promptRows.current[active]]] as const){
      if(!container||!target)continue;
      const top=target.getBoundingClientRect().top-container.getBoundingClientRect().top+container.scrollTop-container.clientHeight/2+target.clientHeight/2;
      container.scrollTo({top,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
    }
  },[active]);

  function tick(){const current=video.current;if(!current)return;if(loop&&current.currentTime>=loop[1])current.currentTime=loop[0];setTime(current.currentTime)}
  function seek(start:number){if(video.current){video.current.currentTime=start;setTime(start);video.current.play().catch(()=>{})}}
  function repeat(index:number){const selected=lines[index],same=loop?.[0]===selected.start&&loop?.[1]===selected.end;if(same){setLoop(null);setMessage("Sentence loop stopped.")}else{setLoop([selected.start,selected.end]);seek(selected.start);setMessage("Repeating this sentence.")}}
  async function save(index:number){
    if(!signedIn){setMessage("Sign in to save sentences to My Collection.");return}
    const start=Math.round(lines[index].start*1000);
    if(saved.includes(start)){setMessage("This sentence is already in My Collection.");return}
    setSaving(start);setMessage("");
    try{const response=await fetch("/api/my-collection",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lessonId:id,start,language})}),data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||"Could not save sentence.");setSaved(current=>current.includes(start)?current:[...current,start]);setMessage("Sentence saved to My Collection.")}
    catch(error){setMessage(error instanceof Error?error.message:"Could not save sentence.")}
    finally{setSaving(null)}
  }
  function stamp(seconds:number){return `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,"0")}`}

  const mediaSrc=src??`/api/video-lessons/${id}/media`;
  async function startCompatibilityPlayback(){
    if(loadingVideo)return;
    fallbackAttempted.current=true;setLoadingVideo(true);setPlaybackError("");
    loadController.current?.abort();const controller=new AbortController();loadController.current=controller;
    try{const blob=await loadPlaybackBlob(mediaSrc,controller.signal);if(controller.signal.aborted)return;if(blobUrl.current)URL.revokeObjectURL(blobUrl.current);const url=URL.createObjectURL(blob);blobUrl.current=url;setLocalVideo(url);setMediaRetry(n=>n+1)}catch(error){if(!controller.signal.aborted)setPlaybackError(error instanceof Error?error.message:"Video could not load. Please retry.")}finally{if(!controller.signal.aborted)setLoadingVideo(false)}
  }
  async function mediaFailed(){
    if(!fallbackAttempted.current&&!src){await startCompatibilityPlayback();return}
    const code=video.current?.error?.code;
    setPlaybackError(code===3||code===4?"The video loaded, but could not be decoded (playback error "+code+"). The administrator needs to check the original file and its video/audio format.":"Video playback was interrupted. Please retry.");
  }
  const playbackNotice=<>{loadingVideo&&<p role="status">Preparing video for this browser… Please keep this page open.</p>}{playbackError&&<div role="alert"><p>{playbackError}</p><button type="button" className="button secondary" disabled={loadingVideo} onClick={startCompatibilityPlayback}>Retry video</button></div>}</>;

  if(speakingMode)return <div className={`speaking-video-minimal ${vertical?"vertical-video":""}`}><video key={mediaRetry} onError={mediaFailed} onLoadedMetadata={()=>setPlaybackError("")} ref={video} controls controlsList="nodownload" onContextMenu={event=>event.preventDefault()} playsInline preload="auto" poster={thumbnail} src={localVideo||mediaSrc} aria-label="Speaking practice video"/>{playbackNotice}{canRecord&&<SpeakingRecorder lessonId={id} signedIn={signedIn} video={video} onStart={()=>{video.current?.play().catch(()=>{})}}/>}</div>;

  return <div className="video-learning-layout">
    <div className={`video-stage ${vertical?"vertical-video":""}`}><video key={mediaRetry} onError={mediaFailed} ref={video} controls controlsList="nodownload" onContextMenu={event=>event.preventDefault()} playsInline preload="metadata" poster={thumbnail} src={localVideo||mediaSrc} onLoadedMetadata={()=>{setPlaybackError("");if(startAt>0&&video.current){video.current.currentTime=Math.min(startAt/1000,video.current.duration||startAt/1000);setTime(video.current.currentTime)}}} onTimeUpdate={tick} onSeeked={tick} aria-label="English lesson video"/>{playbackNotice}<div className="video-subtitles">{line&&<>{showEnglish&&<p>{line.english}</p>}{showTranslation&&(translations[active]||line.translations[language])&&<p lang={language} dir={translationDirection(language)}>{translations[active]||line.translations[language]}</p>}</>}</div></div>
    <div className="player-options"><label>Speed <select value={speed} onChange={event=>setSpeed(Number(event.target.value))}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></label><label><input type="checkbox" checked={showEnglish} onChange={event=>setShowEnglish(event.target.checked)}/> English</label><label><input type="checkbox" checked={showTranslation} onChange={event=>setShowTranslation(event.target.checked)}/> {translationLanguages[language]}</label><label>Translation language<select value={language} onChange={e=>setLanguage(e.target.value as TranslationLanguage)}>{Object.entries(translationLanguages).map(([code,name])=><option value={code} key={code}>{name}</option>)}</select></label></div>
    {speakingMode&&<section className="speaking-teleprompter" aria-label="Speaking teleprompter"><div className="teleprompter-heading"><div><span className="section-eyebrow">READ ALOUD</span><h2>Teleprompter</h2></div><div className="teleprompter-size"><button type="button" aria-label="Make script text smaller" disabled={promptSize<=20} onClick={()=>setPromptSize(size=>Math.max(20,size-2))}>A−</button><button type="button" aria-label="Make script text larger" disabled={promptSize>=37} onClick={()=>setPromptSize(size=>Math.min(37,size+2))}>A+</button></div></div><p>Follow the highlighted line as the video plays. Tap a time to replay a line.</p><div className="teleprompter-lines" ref={prompt} style={{fontSize:promptSize}}>{lines.length?lines.map((segment,index)=><div className={`teleprompter-line ${index===active?"current":""}`} ref={element=>{promptRows.current[index]=element}} key={`${segment.start}-${index}`} aria-current={index===active?"true":undefined}><button type="button" onClick={()=>seek(segment.start)} aria-label={`Play line ${index+1} from ${stamp(segment.start)}`}>{stamp(segment.start)}</button>{showEnglish&&<p><InteractiveEnglish text={segment.english} translation={segment.translations[language]}/></p>}{showTranslation&&<LearningTranslation section="video" id={id} field={`segment-${index}`} language={language} manual={segment.translations.fa} onTranslated={value=>setTranslations(old=>old[index]===value?old:{...old,[index]:value})}/>}</div>):<p>The administrator has not added a teleprompter script yet.</p>}</div></section>}
    {speakingMode&&canRecord&&<SpeakingRecorder lessonId={id} signedIn={signedIn} onStart={()=>{video.current?.play().catch(()=>{})}}/>}
    {showTranslation&&lines.length>0&&!lines.some(s=>s.translations[language])&&!Object.values(translations).some(Boolean)&&<p role="status">You can generate a missing {translationLanguages[language]} translation using the sentence translation buttons below. English remains available.</p>}
    {message&&<p role="status" className="transcript-status">{message} {message.includes("Sign in")&&<a href="/login">Open sign-in</a>}</p>}
    <div className="detail-panel video-transcript"><div className="transcript-heading"><h2>Interactive transcript</h2></div><div className="transcript-scroll" ref={list} aria-label="Synchronized transcript">{lines.map((segment,index)=>{const start=Math.round(segment.start*1000),isSaved=saved.includes(start),isLoop=loop?.[0]===segment.start&&loop?.[1]===segment.end;return <div ref={element=>{rows.current[index]=element}} className={`transcript-entry ${index===active?"selected":""} ${isLoop?"looping":""}`} key={`${segment.start}-${index}`} aria-current={index===active?"true":undefined}><div className="transcript-actions"><button className={isLoop?"active":""} aria-label={`${isLoop?"Stop looping":"Loop"} sentence ${index+1}`} aria-pressed={isLoop} title={isLoop?"Stop loop":"Loop this sentence"} onClick={()=>repeat(index)}><Repeat2 size={19}/></button><button className={isSaved?"saved":""} aria-label={`${isSaved?"Saved":"Save"} sentence ${index+1} to My Collection`} title={isSaved?"Saved to My Collection":"Save sentence"} disabled={saving===start} onClick={()=>save(index)}>{isSaved?<BookmarkCheck size={19}/>:<BookmarkPlus size={19}/>}</button></div><div className="transcript-content"><button className="transcript-seek" onClick={()=>seek(segment.start)} aria-label={`Play sentence ${index+1} from ${stamp(segment.start)}`}>{stamp(segment.start)} · Play from here</button>{showEnglish&&<p><InteractiveEnglish text={segment.english} translation={segment.translations[language]}/></p>}{showTranslation&&<LearningTranslation section="video" id={id} field={`segment-${index}`} language={language} manual={segment.translations.fa} onTranslated={value=>setTranslations(old=>old[index]===value?old:{...old,[index]:value})}/>}</div></div>})}</div></div>
  </div>
}
