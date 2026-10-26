import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import path from'node:path';import{afterEach,describe,expect,it,vi}from'vitest';import{openDatabase,type SqliteDatabase}from'../../apps/local-server/src/persistence/database';import{seedDevelopment}from'../../apps/local-server/src/persistence/seed';import{TournamentRepository}from'../../apps/local-server/src/persistence/repository';import{MatchService}from'../../apps/local-server/src/domain/match-service';import type{Actor}from'../../apps/local-server/src/types';

const databases:SqliteDatabase[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const db of databases.splice(0))if(db.open)db.close();});
function system(filename=':memory:'){const db=openDatabase(filename);databases.push(db);const seeded=seedDevelopment(db)!;const repository=new TournamentRepository(db);const profile=db.prepare('SELECT id FROM profiles LIMIT 1').get() as{id:string};const actor:Actor={id:profile.id,role:'SUPER_ADMIN',tournamentIds:[seeded.tournamentId]};return{db,repository,actor,service:new MatchService(db,repository),...seeded};}
function setRound(db:SqliteDatabase,matchId:string,round:number,state:'IN_PROGRESS'|'PAUSED',remainingMs=1000){db.prepare('UPDATE matches SET current_round=?,state=?,timer_json=? WHERE id=?').run(round,state,JSON.stringify({remainingMs,running:state==='IN_PROGRESS',authoritativeAt:100000,kind:'ROUND'}),matchId);}

describe('authoritative round breaks',()=>{
  it('starts the configured break at round expiry, preserves the result, and never auto-starts scoring',()=>{
    const{db,service,actor,matchId}=system();setRound(db,matchId,1,'IN_PROGRESS');const clock=vi.spyOn(Date,'now').mockReturnValue(100000);
    expect(service.expireTimers(100000)).toEqual([]);clock.mockReturnValue(101000);expect(service.expireTimers(101000)).toEqual([matchId]);
    const resting=service.snapshot(matchId);expect(resting).toMatchObject({state:'ROUND_BREAK',currentRound:2});expect(resting.timer).toMatchObject({kind:'BREAK',remainingMs:60000,running:true,authoritativeAt:101000});
    expect(resting.rounds.find(round=>round.number===1)).toMatchObject({blueScore:5,redScore:2,winner:'BLUE'});expect(resting.rounds[0]!.endedAt).not.toBeNull();
    expect(()=>service.execute(actor,matchId,{type:'SCORE',side:'BLUE',pointType:'BODY_PUNCH'})).toThrow(/scoring is closed/i);
    clock.mockReturnValue(102000);expect(service.snapshot(matchId).timer.remainingMs).toBe(59000);
    clock.mockReturnValue(161000);expect(service.expireTimers(161000)).toEqual([matchId]);expect(service.expireTimers(161000)).toEqual([]);
    const expired=service.snapshot(matchId);expect(expired).toMatchObject({state:'ROUND_BREAK',currentRound:2});expect(expired.timer).toMatchObject({kind:'BREAK',remainingMs:0,running:false});
    const event=db.prepare(`SELECT payload_json FROM match_events WHERE match_id=? AND event_type='match.round_changed' ORDER BY sequence DESC LIMIT 1`).get(matchId) as{payload_json:string};expect(JSON.parse(event.payload_json)).toMatchObject({automatic:true,previousRound:1,round:2,roundResult:{number:1,blueScore:5,redScore:2,winner:'BLUE'}});
    const next=service.execute(actor,matchId,{type:'RESUME'});expect(next).toMatchObject({state:'IN_PROGRESS',currentRound:2});expect(next.timer).toMatchObject({kind:'ROUND',remainingMs:120000,running:true});expect(next.rounds[1]!.startedAt).not.toBeNull();
    clock.mockReturnValue(161500);expect(service.snapshot(matchId).timer.remainingMs).toBe(119500);
  });

  it('records an audited superiority winner for a tied round before allowing the next round',()=>{
    const{db,service,actor,matchId,tournamentId}=system();setRound(db,matchId,1,'IN_PROGRESS');db.prepare("UPDATE match_rounds SET blue_score=7,red_score=7,winner_side=NULL,decision_method=NULL WHERE match_id=? AND number=1").run(matchId);db.prepare('UPDATE matches SET blue_score=7,red_score=7 WHERE id=?').run(matchId);db.prepare('UPDATE match_rounds SET blue_score=0,red_score=0,blue_penalties=0,red_penalties=0,winner_side=NULL,decision_method=NULL,started_at=NULL,ended_at=NULL WHERE match_id=? AND number>1').run(matchId);const clock=vi.spyOn(Date,'now').mockReturnValue(101000);service.expireTimers(101000);
    const held=service.snapshot(matchId);expect(held.rounds[0]).toMatchObject({blueScore:7,redScore:7,winner:null,decisionMethod:null});expect(held.timer).toMatchObject({kind:'BREAK',remainingMs:60000,running:false,holdReason:'SUPERIORITY'});clock.mockReturnValue(106000);expect(service.expireTimers(106000)).toEqual([]);expect(service.snapshot(matchId).timer.remainingMs).toBe(60000);expect(()=>service.execute(actor,matchId,{type:'RESUME'})).toThrow(/superiority decision/i);expect(service.execute(actor,matchId,{type:'RESET_TIMER',reason:'Verify that reset preserves the superiority hold'}).timer).toMatchObject({remainingMs:60000,running:false,holdReason:'SUPERIORITY'});service.execute(actor,matchId,{type:'VIDEO_REVIEW'});expect(service.execute(actor,matchId,{type:'END_REVIEW'})).toMatchObject({state:'PAUSED',timer:{kind:'BREAK',running:false,holdReason:'SUPERIORITY'}});expect(()=>service.execute(actor,matchId,{type:'RESUME'})).toThrow(/superiority decision/i);
    const referee:Actor={id:'referee-integration',role:'REFEREE',tournamentIds:[tournamentId]};const decided=service.execute(referee,matchId,{type:'ROUND_SUPERIORITY',side:'RED',reason:'Officials selected Red after the superiority procedure'});
    expect(decided).toMatchObject({state:'ROUND_BREAK',currentRound:2,blueScore:7,redScore:7});expect(decided.timer).toMatchObject({kind:'BREAK',remainingMs:60000,running:true,authoritativeAt:106000});expect(decided.timer.holdReason).toBeUndefined();expect(decided.rounds[0]).toMatchObject({blueScore:7,redScore:7,winner:'RED',decisionMethod:'SUPERIORITY'});
    expect(()=>service.execute(referee,matchId,{type:'ROUND_SUPERIORITY',side:'BLUE',reason:'Attempt to overwrite the decision'})).toThrow(/already has an authoritative winner/i);
    const event=db.prepare("SELECT payload_json FROM match_events WHERE match_id=? AND event_type='round.superiority_decided'").get(matchId) as{payload_json:string};expect(JSON.parse(event.payload_json)).toMatchObject({round:1,side:'RED',blueScore:7,redScore:7,decisionMethod:'SUPERIORITY',restStarted:true,restRemainingMs:60000});
    const audit=db.prepare("SELECT actor_id,reason FROM audit_logs WHERE entity_id=? AND action='MATCH_ROUND_SUPERIORITY'").get(matchId) as{actor_id:string;reason:string};expect(audit).toMatchObject({actor_id:'referee-integration',reason:'Officials selected Red after the superiority procedure'});
    expect(service.execute(actor,matchId,{type:'RESUME'})).toMatchObject({state:'IN_PROGRESS',currentRound:2});const completed=service.execute(actor,matchId,{type:'COMPLETE'});expect(completed).toMatchObject({state:'COMPLETED',winner:'RED',decisionMethod:'ROUND_WINS'});expect(completed.rounds[0]).toMatchObject({blueScore:7,redScore:7,winner:'RED',decisionMethod:'SUPERIORITY'});
  });

  it('pauses a legacy running tied break until superiority is recorded',()=>{
    const{db,service,actor,matchId,tournamentId}=system();db.prepare("UPDATE match_rounds SET blue_score=7,red_score=7,winner_side=NULL,decision_method=NULL,ended_at=? WHERE match_id=? AND number=1").run(new Date(100000).toISOString(),matchId);db.prepare("UPDATE matches SET current_round=2,state='ROUND_BREAK',blue_score=7,red_score=7,timer_json=? WHERE id=?").run(JSON.stringify({remainingMs:30000,running:true,authoritativeAt:100000,kind:'BREAK'}),matchId);vi.spyOn(Date,'now').mockReturnValue(105000);
    expect(service.expireTimers(105000)).toEqual([matchId]);const held=service.snapshot(matchId);expect(held.timer).toMatchObject({kind:'BREAK',remainingMs:25000,running:false,holdReason:'SUPERIORITY'});expect(service.expireTimers(105000)).toEqual([]);expect(()=>service.execute(actor,matchId,{type:'RESUME'})).toThrow(/superiority decision/i);
    const referee:Actor={id:'referee-legacy-hold',role:'REFEREE',tournamentIds:[tournamentId]};const decided=service.execute(referee,matchId,{type:'ROUND_SUPERIORITY',side:'BLUE',reason:'Officials resolved the legacy tied break'});expect(decided.timer).toMatchObject({kind:'BREAK',remainingMs:25000,running:true});expect(decided.timer.holdReason).toBeUndefined();expect(db.prepare("SELECT COUNT(*) AS count FROM match_events WHERE match_id=? AND event_type='timer.superiority_hold'").get(matchId)).toMatchObject({count:1});
  });

  it('automatically recovers a paused zero non-final round into a running rest',()=>{
    const{db,service,matchId}=system();setRound(db,matchId,1,'PAUSED',0);vi.spyOn(Date,'now').mockReturnValue(101000);
    expect(service.expireTimers(101000)).toEqual([matchId]);
    const resting=service.snapshot(matchId);expect(resting).toMatchObject({state:'ROUND_BREAK',currentRound:2});expect(resting.timer).toMatchObject({kind:'BREAK',remainingMs:60000,running:true,authoritativeAt:101000});
    const event=db.prepare(`SELECT payload_json FROM match_events WHERE match_id=? AND event_type='match.round_changed' ORDER BY sequence DESC LIMIT 1`).get(matchId) as{payload_json:string};expect(JSON.parse(event.payload_json)).toMatchObject({automatic:true,recoveredPaused:true,previousRound:1,round:2});
    expect(service.expireTimers(101000)).toEqual([]);
  });

  it('uses category timing for manual breaks, break resets, and the next round',()=>{
    const{db,service,actor,matchId}=system();setRound(db,matchId,1,'PAUSED',0);db.prepare('UPDATE categories SET round_duration_ms=90000,break_duration_ms=45000 WHERE id=(SELECT category_id FROM matches WHERE id=?)').run(matchId);vi.spyOn(Date,'now').mockReturnValue(100000);
    const resting=service.execute(actor,matchId,{type:'NEXT_ROUND'});expect(resting).toMatchObject({state:'ROUND_BREAK',currentRound:2});expect(resting.timer).toMatchObject({kind:'BREAK',remainingMs:45000,running:true});
    const reset=service.execute(actor,matchId,{type:'RESET_TIMER',reason:'Verify configured break duration'});expect(reset.timer).toMatchObject({kind:'BREAK',remainingMs:45000,running:false});
    const next=service.execute(actor,matchId,{type:'NEXT_ROUND'});expect(next).toMatchObject({state:'IN_PROGRESS',currentRound:2});expect(next.timer).toMatchObject({kind:'ROUND',remainingMs:90000,running:true});
  });

  it('pauses at final-round expiry without inventing another break or round',()=>{
    const{db,service,actor,matchId}=system();setRound(db,matchId,3,'IN_PROGRESS');vi.spyOn(Date,'now').mockReturnValue(101000);expect(service.expireTimers(101000)).toEqual([matchId]);
    const snapshot=service.snapshot(matchId);expect(snapshot).toMatchObject({state:'PAUSED',currentRound:3});expect(snapshot.timer).toMatchObject({kind:'ROUND',remainingMs:0,running:false});expect(snapshot.rounds[2]!.endedAt).not.toBeNull();
    expect(service.expireTimers(101000)).toEqual([]);expect(service.snapshot(matchId)).toMatchObject({state:'PAUSED',currentRound:3});
    expect(service.execute(actor,matchId,{type:'COMPLETE'})).toMatchObject({state:'COMPLETED',winner:'BLUE'});
  });

  it('recovers a running break as paused and resumes the remaining rest before the next round',()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'tkd-break-recovery-'));const filename=path.join(directory,'test.db');
    try{
      const first=system(filename);setRound(first.db,first.matchId,1,'IN_PROGRESS');const clock=vi.spyOn(Date,'now').mockReturnValue(101000);first.service.expireTimers(101000);first.db.close();databases.splice(databases.indexOf(first.db),1);
      const db=openDatabase(filename);databases.push(db);const repository=new TournamentRepository(db);const service=new MatchService(db,repository);clock.mockReturnValue(111000);expect(service.recoverTimers()).toContain(first.matchId);
      const recovered=service.snapshot(first.matchId);expect(recovered).toMatchObject({state:'ROUND_BREAK',currentRound:2});expect(recovered.timer).toMatchObject({kind:'BREAK',remainingMs:50000,running:false});
      const resumed=service.execute(first.actor,first.matchId,{type:'RESUME'});expect(resumed).toMatchObject({state:'ROUND_BREAK',currentRound:2});expect(resumed.timer).toMatchObject({kind:'BREAK',remainingMs:50000,running:true});
      clock.mockReturnValue(112000);expect(service.snapshot(first.matchId).timer.remainingMs).toBe(49000);
      expect(service.execute(first.actor,first.matchId,{type:'NEXT_ROUND'})).toMatchObject({state:'IN_PROGRESS',currentRound:2});
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});
