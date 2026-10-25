import{describe,expect,it}from'vitest';import type{MatchSnapshot}from'@tkd/contracts';import{endedRoundWins,matchResultScores}from'../../apps/web/lib/match-result';

function snapshot(decisionMethod:string):MatchSnapshot{return{decisionMethod,blueScore:12,redScore:9,rounds:[
 {id:'r1',number:1,blueScore:5,redScore:2,winner:'BLUE',endedAt:'2026-10-25T00:00:00Z'},
 {id:'r2',number:2,blueScore:3,redScore:5,winner:'RED',endedAt:'2026-10-25T00:01:00Z'},
 {id:'r3',number:3,blueScore:4,redScore:2,winner:'BLUE',endedAt:'2026-10-25T00:02:00Z'},
 {id:'r4',number:4,blueScore:0,redScore:9,winner:'RED',endedAt:null},
]}as unknown as MatchSnapshot;}

describe('match result display scores',()=>{
 it('shows ended round wins for a round-win result, not cumulative points or future rounds',()=>{
  const match=snapshot('ROUND_WINS');expect(endedRoundWins(match,'BLUE')).toBe(2);expect(endedRoundWins(match,'RED')).toBe(1);expect(matchResultScores(match)).toEqual({blue:2,red:1,label:'ROUND WINS'});
 });
 it('shows authoritative total points when total points decide the result',()=>{
  expect(matchResultScores(snapshot('TOTAL_POINTS'))).toEqual({blue:12,red:9,label:'TOTAL POINTS'});
 });
 it('keeps the round-win score visible for a Golden Point decision',()=>{
  expect(matchResultScores(snapshot('GOLDEN_POINT'))).toEqual({blue:2,red:1,label:'ROUND WINS'});
 });
});
