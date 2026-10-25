'use client';
import{useCallback,useEffect,useRef,useState}from'react';import type{MatchSnapshot}from'@tkd/contracts';import{TimerAlertTracker}from'./timer-alerts';import{ScoreAlertTracker}from'./score-alerts';

const STORAGE_KEY='tkd_timer_sound_enabled';
type ToneType='sine'|'square';

export function useTimerAudio(snapshot:MatchSnapshot|null,remainingMs:number){
 const[enabled,setEnabled]=useState(false);const[ready,setReady]=useState(false);const contextRef=useRef<AudioContext|null>(null);const trackerRef=useRef(new TimerAlertTracker());const scoreTrackerRef=useRef(new ScoreAlertTracker());const enabledRef=useRef(false);const readyRef=useRef(false);
 const playTone=useCallback((frequency:number,durationSeconds:number,volume:number,type:ToneType)=>{
  const context=contextRef.current;if(!context||context.state!=='running')return;const start=context.currentTime;const oscillator=context.createOscillator();const gain=context.createGain();oscillator.type=type;oscillator.frequency.setValueAtTime(frequency,start);gain.gain.setValueAtTime(0.0001,start);gain.gain.exponentialRampToValueAtTime(volume,start+0.01);gain.gain.exponentialRampToValueAtTime(0.0001,start+durationSeconds);oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(start+durationSeconds+0.02);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
 },[]);
 const unlock=useCallback(async()=>{
  try{if(!contextRef.current)contextRef.current=new AudioContext();await contextRef.current.resume();enabledRef.current=true;readyRef.current=true;setEnabled(true);setReady(true);localStorage.setItem(STORAGE_KEY,'1');playTone(660,0.06,0.035,'sine');}catch{readyRef.current=false;setReady(false);}
 },[playTone]);
 const toggle=useCallback(async()=>{
  const context=contextRef.current;
  if(enabledRef.current&&readyRef.current&&context?.state==='running'){enabledRef.current=false;readyRef.current=false;setEnabled(false);setReady(false);localStorage.setItem(STORAGE_KEY,'0');await context.suspend();}
  else await unlock();
 },[unlock]);
 useEffect(()=>{const frame=requestAnimationFrame(()=>{if(localStorage.getItem(STORAGE_KEY)==='1'){enabledRef.current=true;setEnabled(true);}});return()=>cancelAnimationFrame(frame);},[]);
 useEffect(()=>()=>{if(contextRef.current)void contextRef.current.close();},[]);
 useEffect(()=>{
  const alerts=trackerRef.current.observe(snapshot,remainingMs);const scored=scoreTrackerRef.current.observe(snapshot);if(!enabled||!ready)return;
  if(scored)playTone(1320,0.12,0.08,'sine');
  for(const alert of alerts){
   if(alert.type==='WARNING')playTone(880,0.09,0.07,'sine');
   else{playTone(180,1.1,0.09,'square');playTone(240,1.1,0.055,'square');}
  }
 },[snapshot,remainingMs,enabled,ready,playTone]);
 return{enabled,ready,toggle};
}
