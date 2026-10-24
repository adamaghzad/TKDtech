import type{MatchSnapshot}from'@tkd/contracts';

export type TimerAlert={type:'WARNING';second:number}|{type:'END';timerKind:'ROUND'|'BREAK'};

/** Converts the authoritative timer estimate into one alert per second/expiry, without audio or browser APIs. */
export class TimerAlertTracker{
 private key:string|null=null;
 private remainingMs=0;
 private lastWarning='';
 private lastEnd='';

 observe(snapshot:MatchSnapshot|null,remainingMs:number):TimerAlert[]{
  const remaining=Math.max(0,remainingMs);
  if(!snapshot){this.key=null;this.remainingMs=0;return[];}
  const key=`${snapshot.matchId}:${snapshot.currentRound}:${snapshot.timer.kind}:${snapshot.timer.authoritativeAt}`;
  const previousKey=this.key;const previousRemaining=this.remainingMs;this.key=key;this.remainingMs=remaining;
  const supported=(snapshot.timer.kind==='ROUND'&&snapshot.state==='IN_PROGRESS')||(snapshot.timer.kind==='BREAK'&&snapshot.state==='ROUND_BREAK');
  if(!supported||!snapshot.timer.running||previousKey!==key)return[];
  const alerts:TimerAlert[]=[];const second=Math.ceil(remaining/1000);
  if(remaining>0&&remaining<=previousRemaining&&second>=1&&second<=5){
   const warningKey=`${key}:${second}`;
   if(this.lastWarning!==warningKey&&Math.ceil(previousRemaining/1000)!==second){this.lastWarning=warningKey;alerts.push({type:'WARNING',second});}
  }
  if(remaining===0&&previousRemaining>0&&this.lastEnd!==key){this.lastEnd=key;alerts.push({type:'END',timerKind:snapshot.timer.kind as'ROUND'|'BREAK'});}
  return alerts;
 }
}
