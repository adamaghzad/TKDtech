import type{MatchSnapshot,Side}from'@tkd/contracts';

export function endedRoundWins(snapshot:MatchSnapshot,side:Side):number{
 return snapshot.rounds.filter(round=>round.endedAt!==null&&round.winner===side).length;
}

/** Uses the same deciding policy as the persisted result instead of always displaying cumulative points. */
export function matchResultScores(snapshot:MatchSnapshot):{blue:number;red:number;label:'ROUND WINS'|'TOTAL POINTS'}{
 if(snapshot.decisionMethod==='TOTAL_POINTS')return{blue:snapshot.blueScore,red:snapshot.redScore,label:'TOTAL POINTS'};
 return{blue:endedRoundWins(snapshot,'BLUE'),red:endedRoundWins(snapshot,'RED'),label:'ROUND WINS'};
}
