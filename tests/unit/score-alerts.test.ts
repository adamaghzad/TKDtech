import{describe,expect,it}from'vitest';import type{MatchSnapshot}from'@tkd/contracts';import{ScoreAlertTracker}from'../../apps/web/lib/score-alerts';

function snapshot(blueScore:number,redScore:number,matchId='match-1'):MatchSnapshot{return{matchId,blueScore,redScore}as MatchSnapshot;}

describe('score alert tracking',()=>{
 it('emits once for an accepted blue score and suppresses duplicate snapshots',()=>{
  const tracker=new ScoreAlertTracker();expect(tracker.observe(snapshot(12,8))).toBe(false);expect(tracker.observe(snapshot(13,8))).toBe(true);expect(tracker.observe(snapshot(13,8))).toBe(false);
 });
 it('emits once for red and multi-point score increases',()=>{
  const tracker=new ScoreAlertTracker();tracker.observe(snapshot(12,8));expect(tracker.observe(snapshot(12,11))).toBe(true);expect(tracker.observe(snapshot(16,11))).toBe(true);expect(tracker.observe(snapshot(16,11))).toBe(false);
 });
 it('does not sound for an undo but sounds for a subsequent new score',()=>{
  const tracker=new ScoreAlertTracker();tracker.observe(snapshot(13,8));expect(tracker.observe(snapshot(12,8))).toBe(false);expect(tracker.observe(snapshot(13,8))).toBe(true);
 });
 it('does not replay the initial score when changing matches',()=>{
  const tracker=new ScoreAlertTracker();tracker.observe(snapshot(12,8));expect(tracker.observe(snapshot(30,20,'match-2'))).toBe(false);expect(tracker.observe(snapshot(31,20,'match-2'))).toBe(true);
 });
 it('does not replay a score after a disconnected null snapshot resets tracking',()=>{
  const tracker=new ScoreAlertTracker();tracker.observe(snapshot(12,8));expect(tracker.observe(null)).toBe(false);expect(tracker.observe(snapshot(12,8))).toBe(false);
 });
});
