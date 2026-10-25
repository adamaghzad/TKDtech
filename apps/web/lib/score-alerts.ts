import type{MatchSnapshot}from'@tkd/contracts';

/** Emits once for an authoritative score increase, never for the initial snapshot or duplicate updates. */
export class ScoreAlertTracker{
 private matchId:string|null=null;
 private blueScore=0;
 private redScore=0;

 observe(snapshot:MatchSnapshot|null):boolean{
  if(!snapshot){this.matchId=null;return false;}
  if(this.matchId!==snapshot.matchId){this.matchId=snapshot.matchId;this.blueScore=snapshot.blueScore;this.redScore=snapshot.redScore;return false;}
  const scored=snapshot.blueScore>this.blueScore||snapshot.redScore>this.redScore;
  this.blueScore=snapshot.blueScore;this.redScore=snapshot.redScore;
  return scored;
 }
}
