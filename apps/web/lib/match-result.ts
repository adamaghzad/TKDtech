import type{MatchSnapshot,Side}from'@tkd/contracts';

export function endedRoundWins(snapshot:MatchSnapshot,side:Side):number{
 return snapshot.rounds.filter(round=>round.endedAt!==null&&round.winner===side).length;
}

export function displayedRoundWins(snapshot:MatchSnapshot,side:Side):number{
 const completedThrough=snapshot.timer.kind==='BREAK'?snapshot.currentRound-1:snapshot.currentRound;
 return snapshot.rounds.filter(round=>round.endedAt!==null&&round.number<=completedThrough&&round.winner===side).length;
}

/** Normal match phases show current-round points; only after-round rest shows the round-win summary. */
export function liveScoreboardScores(snapshot:MatchSnapshot):{blue:number;red:number;label:'POINTS'|'ROUND WINS'}{
 if(snapshot.timer.kind!=='BREAK'){const round=snapshot.rounds.find(item=>item.number===snapshot.currentRound);return{blue:round?.blueScore??0,red:round?.redScore??0,label:'POINTS'};}
 return{blue:displayedRoundWins(snapshot,'BLUE'),red:displayedRoundWins(snapshot,'RED'),label:'ROUND WINS'};
}

/** Uses the same deciding policy as the persisted result instead of always displaying cumulative points. */
export function matchResultScores(snapshot:MatchSnapshot):{blue:number;red:number;label:'ROUND WINS'|'TOTAL POINTS'}{
 if(snapshot.decisionMethod==='TOTAL_POINTS')return{blue:snapshot.blueScore,red:snapshot.redScore,label:'TOTAL POINTS'};
 return{blue:endedRoundWins(snapshot,'BLUE'),red:endedRoundWins(snapshot,'RED'),label:'ROUND WINS'};
}
