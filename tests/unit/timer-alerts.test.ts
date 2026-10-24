import{describe,expect,it}from'vitest';import type{MatchSnapshot,MatchState,TimerState}from'@tkd/contracts';import{TimerAlertTracker}from'../../apps/web/lib/timer-alerts';

function snapshot(kind:TimerState['kind']='ROUND',state:MatchState='IN_PROGRESS',authoritativeAt=1000):MatchSnapshot{return{matchId:'match-1',currentRound:1,state,timer:{kind,running:true,authoritativeAt,remainingMs:0}}as MatchSnapshot;}

describe('timer alert tracking',()=>{
  it('emits five countdown warnings and exactly one round-end alert',()=>{
    const tracker=new TimerAlertTracker();const round=snapshot();expect(tracker.observe(round,6000)).toEqual([]);expect(tracker.observe(round,5900)).toEqual([]);
    for(const second of[5,4,3,2,1]){expect(tracker.observe(round,second*1000)).toEqual([{type:'WARNING',second}]);expect(tracker.observe(round,second*1000-100)).toEqual([]);}
    expect(tracker.observe(round,0)).toEqual([{type:'END',timerKind:'ROUND'}]);expect(tracker.observe(round,0)).toEqual([]);
  });
  it('tracks rest expiry independently and labels the break buzzer',()=>{
    const tracker=new TimerAlertTracker();const rest=snapshot('BREAK','ROUND_BREAK',2000);expect(tracker.observe(rest,2000)).toEqual([]);expect(tracker.observe(rest,1000)).toEqual([{type:'WARNING',second:1}]);expect(tracker.observe(rest,0)).toEqual([{type:'END',timerKind:'BREAK'}]);
  });
  it('does not replay an expired timer on initial load or after a paused update',()=>{
    const tracker=new TimerAlertTracker();const round=snapshot();expect(tracker.observe(round,0)).toEqual([]);expect(tracker.observe(round,0)).toEqual([]);
    const resumed=snapshot('ROUND','IN_PROGRESS',3000);expect(tracker.observe(resumed,1000)).toEqual([]);const paused={...resumed,timer:{...resumed.timer,running:false}};expect(tracker.observe(paused,0)).toEqual([]);
  });
  it('excludes medical and golden-point timers from round/rest alerts',()=>{
    const tracker=new TimerAlertTracker();for(const [kind,state]of[['MEDICAL','PAUSED'],['GOLDEN_POINT','GOLDEN_POINT']]as const){const timer=snapshot(kind,state,4000);expect(tracker.observe(timer,1000)).toEqual([]);expect(tracker.observe(timer,0)).toEqual([]);}
  });
  it('suppresses duplicate warnings during repeated or upward snapshot reconciliation',()=>{
    const tracker=new TimerAlertTracker();const round=snapshot();expect(tracker.observe(round,5000)).toEqual([]);expect(tracker.observe(round,4000)).toEqual([{type:'WARNING',second:4}]);expect(tracker.observe(round,4000)).toEqual([]);expect(tracker.observe(round,4100)).toEqual([]);expect(tracker.observe(round,4000)).toEqual([]);expect(tracker.observe(round,3000)).toEqual([{type:'WARNING',second:3}]);
  });
});
