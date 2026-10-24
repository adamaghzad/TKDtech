import { randomUUID } from 'node:crypto';
import type { MatchSnapshot, Ruleset, ScoreProposalInput, Side } from '@tkd/contracts';
import { applyGamJeom, assertTransition, determineMatchResult, pauseTimer, remainingAt, resetTimer, startTimer } from '@tkd/domain';
import type { SqliteDatabase } from '../persistence/database';
import { appendMatchEvent, audit, isoNow } from '../persistence/audit';
import { getJoinedMatch, getMatchRow, snapshotFromRow } from '../persistence/rows';
import { TournamentRepository } from '../persistence/repository';
import { HttpError } from '../http';
import { createToken, hashToken } from '../security/auth';
import type { Actor, MatchCommand } from '../types';

interface DeviceSession { id:string;tournament_id:string;match_id:string;role:'J1'|'J2'|'J3'|'REFEREE';device_name:string;status:string;expires_at:number;last_sequence?:number }
interface ProposalResult { status:string;reason:string;decisionId:string|null;points:number;duplicate?:boolean;matchId:string;diagnostics?:{serverReceivedAt:number;consensusWindowMs:number;consensusThreshold:number;matchingJudgeCount:number;expiredPriorCount:number;onlineJudgeCount:number;scoringMode:'ONE_JUDGE'|'TWO_JUDGE'} }

export class MatchService {
  constructor(private readonly db: SqliteDatabase, private readonly repository: TournamentRepository) {}

  snapshot(matchId: string): MatchSnapshot {
    const row = getJoinedMatch(this.db, matchId);
    return snapshotFromRow(this.db, row);
  }

  listEvents(matchId: string, afterSequence = 0): unknown[] {
    return (this.db.prepare('SELECT * FROM match_events WHERE match_id=? AND sequence>? ORDER BY sequence LIMIT 500').all(matchId,afterSequence) as Array<Record<string,unknown>>).map(row=>({...row,payload:JSON.parse(String(row.payload_json))}));
  }

  private ruleset(tournamentId: string): Ruleset {
    const row=this.db.prepare('SELECT config_json FROM tournament_rulesets WHERE tournament_id=? ORDER BY created_at LIMIT 1').get(tournamentId) as {config_json:string};
    return JSON.parse(row.config_json) as Ruleset;
  }

  private timing(categoryId:string):{rounds:number;roundDurationMs:number;breakDurationMs:number} {
    const row=this.db.prepare('SELECT rounds,round_duration_ms,break_duration_ms FROM categories WHERE id=?').get(categoryId) as {rounds:number;round_duration_ms:number;break_duration_ms:number}|undefined;
    if(!row)throw new HttpError(404,'CATEGORY_NOT_FOUND','Match category is missing.');
    return {rounds:row.rounds,roundDurationMs:row.round_duration_ms,breakDurationMs:row.break_duration_ms};
  }

  execute(actor: Actor, matchId: string, command: MatchCommand, idempotencyKey: string = randomUUID()): MatchSnapshot {
    const duplicate=this.db.prepare('SELECT event_id FROM match_events WHERE match_id=? AND idempotency_key=?').get(matchId,idempotencyKey);
    if(duplicate)return this.snapshot(matchId);
    const match=getMatchRow(this.db,matchId);this.repository.authorizeTournament(actor,match.tournament_id);
    if(!['SUPER_ADMIN','TOURNAMENT_ADMIN','MAT_OPERATOR','REFEREE'].includes(actor.role))throw new HttpError(403,'PERMISSION_DENIED','Match control permission required.');
    if(actor.role==='REFEREE'&&!['START','PAUSE','RESUME','GAM_JEOM','MEDICAL_TIMEOUT','VIDEO_REVIEW','END_REVIEW','COMPLETE'].includes(command.type))throw new HttpError(403,'PERMISSION_DENIED','This referee action is not authorized.');
    if(command.expectedVersion!=null&&command.expectedVersion!==match.version)throw new HttpError(409,'VERSION_CONFLICT',`Match version changed. Expected ${command.expectedVersion}, current ${match.version}. Refresh before retrying.`);
    const ruleset=this.ruleset(match.tournament_id);let eventType='timer.updated';let payload:Record<string,unknown>={command:command.type};
    this.db.transaction(()=>{
      const current=getMatchRow(this.db,matchId);const timer=JSON.parse(current.timer_json) as MatchSnapshot['timer'] & {returnTimer?:MatchSnapshot['timer']};const now=Date.now();let state=current.state;let nextTimer=MatchService.cleanTimer(timer);let round=current.current_round;let blueScore=current.blue_score;let redScore=current.red_score;let blueGam=current.blue_gam_jeom;let redGam=current.red_gam_jeom;let winner=current.winner_side;let decision=current.decision_method;let actualEnd=current.actual_end_at;
      const currentRound=this.db.prepare('SELECT * FROM match_rounds WHERE match_id=? AND number=?').get(matchId,round) as {id:string;blue_score:number;red_score:number;blue_penalties:number;red_penalties:number};
      const transition=(to:typeof state)=>{assertTransition(state,to);state=to;};
      switch(command.type){
        case 'START': {
          if(!current.blue_athlete_id||!current.red_athlete_id)throw new HttpError(409,'ENTRANTS_UNKNOWN','Both athletes must be confirmed.');
          if(!current.mat_id)throw new HttpError(409,'MAT_REQUIRED','Assign an available mat before starting.');
          if(!['READY','CALLED'].includes(state))throw new HttpError(409,'INVALID_STATE','Start requires a ready or called match.');
          transition('IN_PROGRESS');nextTimer=startTimer(nextTimer,now);eventType='match.started';
          this.db.prepare('UPDATE match_rounds SET started_at=COALESCE(started_at,?) WHERE match_id=? AND number=?').run(new Date(now).toISOString(),matchId,round);
          this.db.prepare('UPDATE matches SET actual_start_at=COALESCE(actual_start_at,?) WHERE id=?').run(new Date(now).toISOString(),matchId);break;
        }
        case 'PAUSE': {
          if(!['IN_PROGRESS','GOLDEN_POINT'].includes(state))throw new HttpError(409,'INVALID_STATE','Pause requires a running round.');
          transition('PAUSED');nextTimer=pauseTimer(nextTimer,now);eventType='match.paused';break;
        }
        case 'RESUME': {
          if(state==='ROUND_BREAK'){
            if(!timer.running&&nextTimer.remainingMs>0){nextTimer=startTimer(nextTimer,now);eventType='match.resumed';payload={...payload,round,breakResumed:true};break;}
            const timing=this.timing(current.category_id);
            transition('IN_PROGRESS');nextTimer=startTimer(resetTimer({...nextTimer,kind:'ROUND'},timing.roundDurationMs,now),now);eventType='match.resumed';
            this.db.prepare('UPDATE match_rounds SET started_at=COALESCE(started_at,?) WHERE match_id=? AND number=?').run(new Date(now).toISOString(),matchId,round);
            payload={...payload,round,breakSkipped:true};break;
          }
          if(state!=='PAUSED')throw new HttpError(409,'INVALID_STATE','Resume requires a paused match or an active round break.');
          if(nextTimer.kind==='BREAK'){
            transition('ROUND_BREAK');nextTimer=startTimer(nextTimer,now);eventType='match.resumed';payload={...payload,round,breakResumed:true};break;
          }
          if(nextTimer.remainingMs<=0)throw new HttpError(409,'TIMER_EXPIRED','Reset the timer or advance the round before resuming.');
          if(nextTimer.kind==='MEDICAL'){nextTimer=startTimer(nextTimer,now);eventType='timer.medical_started';}
          else{transition('IN_PROGRESS');nextTimer=startTimer(nextTimer,now);eventType='match.resumed';}break;
        }
        case 'RESET_TIMER': {
          if(state==='IN_PROGRESS')throw new HttpError(409,'INVALID_STATE','Pause before resetting the timer.');
          if(!command.reason)throw new HttpError(400,'REASON_REQUIRED','A correction reason is required to reset the timer.');
          const timing=this.timing(current.category_id);
          const durationMs=nextTimer.kind==='BREAK'?timing.breakDurationMs:nextTimer.kind==='MEDICAL'?ruleset.medicalTimeoutMs:nextTimer.kind==='GOLDEN_POINT'?(ruleset.goldenPointDurationMs??timing.roundDurationMs):timing.roundDurationMs;
          nextTimer=resetTimer(nextTimer,durationMs,now);eventType='timer.reset';payload={...payload,reason:command.reason,timerKind:nextTimer.kind};break;
        }
        case 'NEXT_ROUND': {
          if(!['PAUSED','ROUND_BREAK'].includes(state))throw new HttpError(409,'INVALID_STATE','Pause the match before changing rounds.');
          const timing=this.timing(current.category_id);
          if(state==='ROUND_BREAK'||nextTimer.kind==='BREAK'){
            transition('IN_PROGRESS');nextTimer=startTimer(resetTimer({...nextTimer,kind:'ROUND'},timing.roundDurationMs,now),now);eventType='match.round_changed';
            this.db.prepare('UPDATE match_rounds SET started_at=COALESCE(started_at,?) WHERE match_id=? AND number=?').run(new Date(now).toISOString(),matchId,round);
            payload={...payload,round,breakSkipped:true};break;
          }
          if(round>=timing.rounds)throw new HttpError(409,'FINAL_ROUND','The final round is already active. Complete the match after resolving the result.');
          const endedRound=round;const roundWinner=currentRound.blue_score===currentRound.red_score?null:currentRound.blue_score>currentRound.red_score?'BLUE':'RED';
          this.db.prepare('UPDATE match_rounds SET winner_side=?,ended_at=? WHERE id=?').run(roundWinner,new Date(now).toISOString(),currentRound.id);
          round+=1;transition('ROUND_BREAK');nextTimer=startTimer(resetTimer({...nextTimer,kind:'BREAK'},timing.breakDurationMs,now),now);eventType='match.round_changed';
          payload={...payload,previousRound:endedRound,round,automatic:false,roundResult:{number:endedRound,blueScore:currentRound.blue_score,redScore:currentRound.red_score,winner:roundWinner}};break;
        }
        case 'PREVIOUS_ROUND': {
          if(!['SUPER_ADMIN','TOURNAMENT_ADMIN'].includes(actor.role)||!command.reason)throw new HttpError(403,'AUTHORIZED_CORRECTION_REQUIRED','Previous-round correction requires an administrator and a reason.');
          if(state==='IN_PROGRESS'||round<=1)throw new HttpError(409,'INVALID_STATE','Pause and select a valid previous round.');
          round-=1;nextTimer=pauseTimer(nextTimer,now);eventType='match.round_correction';payload={...payload,round,reason:command.reason};break;
        }
        case 'SCORE': {
          if(!['IN_PROGRESS','PAUSED','GOLDEN_POINT'].includes(state))throw new HttpError(409,'INVALID_STATE','Scoring is closed in the current match state.');
          if(!command.side||!command.pointType)throw new HttpError(400,'VALIDATION_ERROR','Side and configured point type are required.');
          const points=ruleset.points[command.pointType];if(!Number.isInteger(points))throw new HttpError(400,'INVALID_POINT_TYPE','Point type is not configured.');
          if(command.side==='BLUE')blueScore+=points;else redScore+=points;
          this.db.prepare(`UPDATE match_rounds SET ${command.side==='BLUE'?'blue_score':'red_score'}=${command.side==='BLUE'?'blue_score':'red_score'}+? WHERE id=?`).run(points,currentRound.id);
          eventType='score.manual';payload={side:command.side,pointType:command.pointType,points,roundId:currentRound.id,round,undoable:true};break;
        }
        case 'GAM_JEOM': {
          if(!['IN_PROGRESS','PAUSED','GOLDEN_POINT'].includes(state))throw new HttpError(409,'INVALID_STATE','Penalties are closed in the current match state.');
          if(!command.side)throw new HttpError(400,'VALIDATION_ERROR','Penalized side is required.');
          const updated=applyGamJeom({number:round,blueScore:currentRound.blue_score,redScore:currentRound.red_score,bluePenalties:currentRound.blue_penalties,redPenalties:currentRound.red_penalties},command.side,ruleset);
          if(command.side==='BLUE'){blueGam+=1;redScore+=ruleset.gamJeomOpponentPoints;}else{redGam+=1;blueScore+=ruleset.gamJeomOpponentPoints;}
          this.db.prepare('UPDATE match_rounds SET blue_score=?,red_score=?,blue_penalties=?,red_penalties=? WHERE id=?').run(updated.blueScore,updated.redScore,updated.bluePenalties,updated.redPenalties,currentRound.id);
          eventType='penalty.accepted';payload={side:command.side,points:ruleset.gamJeomOpponentPoints,roundId:currentRound.id,round,undoable:true};break;
        }
        case 'MEDICAL_TIMEOUT': {
          if(nextTimer.kind==='MEDICAL'&&timer.returnTimer){nextTimer=pauseTimer(timer.returnTimer,now);eventType='timer.medical_ended';}
          else{if(!['IN_PROGRESS','PAUSED'].includes(state))throw new HttpError(409,'INVALID_STATE','Medical timeout is unavailable in this state.');if(state==='IN_PROGRESS')transition('PAUSED');const returnTimer=pauseTimer(nextTimer,now);nextTimer={...resetTimer({...nextTimer,kind:'MEDICAL'},ruleset.medicalTimeoutMs,now),returnTimer};eventType='timer.medical_timeout';}break;
        }
        case 'VIDEO_REVIEW': {
          if(!['IN_PROGRESS','PAUSED','GOLDEN_POINT','ROUND_BREAK'].includes(state))throw new HttpError(409,'INVALID_STATE','Video review is unavailable in this state.');
          transition('UNDER_REVIEW');nextTimer=pauseTimer(nextTimer,now);eventType='match.under_review';break;
        }
        case 'END_REVIEW': {
          if(state!=='UNDER_REVIEW')throw new HttpError(409,'INVALID_STATE','No active video review.');
          transition('PAUSED');eventType='match.review_completed';payload={...payload,reason:command.reason||'Review closed by authorized operator'};break;
        }
        case 'TIMER_EXPIRED': {
          const timing=this.timing(current.category_id);const expiredRunning=timer.running&&remainingAt(timer,now)===0;
          const pausedRoundRecovery=state==='PAUSED'&&nextTimer.kind==='ROUND'&&nextTimer.remainingMs<=0&&round<timing.rounds;
          if(!expiredRunning&&!pausedRoundRecovery)throw new HttpError(409,'TIMER_NOT_EXPIRED','The authoritative timer has not expired.');
          if(nextTimer.kind==='ROUND'&&(state==='IN_PROGRESS'||pausedRoundRecovery)){
            const endedRound=round;const roundWinner=currentRound.blue_score===currentRound.red_score?null:currentRound.blue_score>currentRound.red_score?'BLUE':'RED';
            this.db.prepare('UPDATE match_rounds SET winner_side=?,ended_at=? WHERE id=?').run(roundWinner,new Date(now).toISOString(),currentRound.id);
            const roundResult={number:endedRound,blueScore:currentRound.blue_score,redScore:currentRound.red_score,winner:roundWinner};
            if(endedRound<timing.rounds){
              round+=1;transition('ROUND_BREAK');nextTimer=startTimer(resetTimer({...nextTimer,kind:'BREAK'},timing.breakDurationMs,now),now);eventType='match.round_changed';
              payload={...payload,previousRound:endedRound,round,automatic:true,recoveredPaused:pausedRoundRecovery,roundResult};
            }else{
              transition('PAUSED');nextTimer=pauseTimer(nextTimer,now);eventType='match.paused';payload={...payload,reason:'ROUND_EXPIRED',round:endedRound,automatic:true,roundResult};
            }
            break;
          }
          if(nextTimer.kind==='BREAK'&&state==='ROUND_BREAK'){
            nextTimer=pauseTimer(nextTimer,now);eventType='timer.updated';payload={...payload,reason:'BREAK_EXPIRED',round};break;
          }
          if(nextTimer.kind==='MEDICAL'&&state==='PAUSED'){
            nextTimer=pauseTimer(nextTimer,now);eventType='timer.updated';payload={...payload,reason:'MEDICAL_EXPIRED',round};break;
          }
          if(nextTimer.kind==='GOLDEN_POINT'&&state==='GOLDEN_POINT'){
            transition('PAUSED');nextTimer=pauseTimer(nextTimer,now);eventType='match.paused';payload={...payload,reason:'GOLDEN_POINT_EXPIRED',round};break;
          }
          throw new HttpError(409,'INVALID_TIMER_STATE','The expired timer does not match the current match state.');
        }
        case 'COMPLETE': {
          if(!['IN_PROGRESS','PAUSED','ROUND_BREAK','GOLDEN_POINT','UNDER_REVIEW'].includes(state))throw new HttpError(409,'INVALID_STATE','The match cannot be completed from its current state.');
          const rounds=this.db.prepare('SELECT * FROM match_rounds WHERE match_id=? ORDER BY number').all(matchId) as Array<{number:number;blue_score:number;red_score:number;blue_penalties:number;red_penalties:number}>;
          const result=determineMatchResult(rounds.map(item=>({number:item.number,blueScore:item.blue_score,redScore:item.red_score,bluePenalties:item.blue_penalties,redPenalties:item.red_penalties})),ruleset);if(!result.winner)throw new HttpError(409,'UNRESOLVED_TIE',result.reason);
          winner=result.winner;decision=result.decisionMethod;transition('COMPLETED');nextTimer=pauseTimer(nextTimer,now);actualEnd=new Date(now).toISOString();eventType='match.completed';payload={winner,decisionMethod:decision,result};
          this.db.prepare('UPDATE match_rounds SET winner_side=CASE WHEN blue_score=red_score THEN NULL WHEN blue_score>red_score THEN \'BLUE\' ELSE \'RED\' END,ended_at=COALESCE(ended_at,?) WHERE match_id=? AND number<=?').run(new Date(now).toISOString(),matchId,round);break;
        }
        case 'WALKOVER': {
          if(!command.side)throw new HttpError(400,'VALIDATION_ERROR','Winner side is required for a walkover.');
          if(!['READY','CALLED'].includes(state))throw new HttpError(409,'INVALID_STATE','Walkover requires a ready or called match.');
          winner=command.side;decision='WALKOVER';transition('WALKOVER');actualEnd=new Date(now).toISOString();eventType='match.walkover';payload={winner,decisionMethod:decision};break;
        }
        case 'UNDO': {
          if(!command.reason)throw new HttpError(400,'REASON_REQUIRED','An audit reason is required for corrections.');
          if(['COMPLETED','WALKOVER','DISQUALIFIED','WITHDRAWN'].includes(state))throw new HttpError(409,'RESULT_CORRECTION_REQUIRED','Completed results require the dedicated correction workflow.');
          const target=this.db.prepare(`SELECT * FROM match_events WHERE match_id=? AND event_type IN ('score.manual','score.accepted','penalty.accepted') AND json_extract(payload_json,'$.undoable')=1 AND NOT EXISTS(SELECT 1 FROM match_events correction WHERE correction.match_id=match_events.match_id AND json_extract(correction.payload_json,'$.targetEventId')=match_events.event_id) ORDER BY sequence DESC LIMIT 1`).get(matchId) as {event_id:string;event_type:string;payload_json:string}|undefined;
          if(!target)throw new HttpError(409,'NOTHING_TO_UNDO','No reversible scoring event exists.');const original=JSON.parse(target.payload_json) as {side:Side;points:number;roundId:string};
          if(target.event_type==='penalty.accepted'){
            if(original.side==='BLUE'){blueGam=Math.max(0,blueGam-1);redScore=Math.max(0,redScore-original.points);}else{redGam=Math.max(0,redGam-1);blueScore=Math.max(0,blueScore-original.points);}
            this.db.prepare(`UPDATE match_rounds SET ${original.side==='BLUE'?'blue_penalties':'red_penalties'}=MAX(0,${original.side==='BLUE'?'blue_penalties':'red_penalties'}-1),${original.side==='BLUE'?'red_score':'blue_score'}=MAX(0,${original.side==='BLUE'?'red_score':'blue_score'}-?) WHERE id=?`).run(original.points,original.roundId);
          }else{
            if(original.side==='BLUE')blueScore=Math.max(0,blueScore-original.points);else redScore=Math.max(0,redScore-original.points);
            this.db.prepare(`UPDATE match_rounds SET ${original.side==='BLUE'?'blue_score':'red_score'}=MAX(0,${original.side==='BLUE'?'blue_score':'red_score'}-?) WHERE id=?`).run(original.points,original.roundId);
          }
          eventType='score.correction';payload={targetEventId:target.event_id,reason:command.reason,original:original};break;
        }
      }
      const sequence=current.sequence+1;const updatedAt=isoNow();
      const update=this.db.prepare(`UPDATE matches SET state=?,current_round=?,blue_score=?,red_score=?,blue_gam_jeom=?,red_gam_jeom=?,winner_side=?,decision_method=?,timer_json=?,sequence=?,version=version+1,actual_end_at=?,updated_at=? WHERE id=? AND version=?`).run(state,round,blueScore,redScore,blueGam,redGam,winner,decision,JSON.stringify(nextTimer),sequence,actualEnd,updatedAt,matchId,current.version);
      if(update.changes!==1)throw new HttpError(409,'VERSION_CONFLICT','Match changed concurrently. No command was applied.');
      appendMatchEvent(this.db,{tournamentId:current.tournament_id,matchId,sequence,type:eventType,actorId:actor.id,sessionId:actor.sessionId,payload,idempotencyKey});
      audit(this.db,{tournamentId:current.tournament_id,actorId:actor.id,action:`MATCH_${command.type}`,entityType:'match',entityId:matchId,before:{state:current.state,version:current.version,blueScore:current.blue_score,redScore:current.red_score},after:{state,version:current.version+1,blueScore,redScore},reason:command.reason});
      if(winner&&['COMPLETED','WALKOVER'].includes(state)){
        const winnerId=winner==='BLUE'?current.blue_athlete_id:current.red_athlete_id;const loserId=winner==='BLUE'?current.red_athlete_id:current.blue_athlete_id;if(!winnerId)throw new HttpError(409,'RESULT_INVALID','Winner athlete is unknown.');
        this.db.prepare('INSERT INTO tournament_results(id,tournament_id,match_id,winner_athlete_id,loser_athlete_id,decision_method,blue_score,red_score,completed_at,version) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),current.tournament_id,matchId,winnerId,loserId,decision??'RESULT',blueScore,redScore,actualEnd??updatedAt,current.version+1);
        this.repository.advanceFromCompletedMatch(actor,matchId,winnerId);this.repository.releaseMatAndAssignNext(current.tournament_id,matchId,actor.id);
      }
    })();
    return this.snapshot(matchId);
  }

  private static cleanTimer(timer: MatchSnapshot['timer'] & {returnTimer?:MatchSnapshot['timer']}): MatchSnapshot['timer'] & {returnTimer?:MatchSnapshot['timer']} { return {...timer,remainingMs:remainingAt(timer,Date.now())}; }

  createPairing(actor: Actor, input: {matchId:string;role:'J1'|'J2'|'J3'|'REFEREE';expiresInSeconds?:number;replace?:boolean;deviceName?:string}): {token:string;expiresAt:number;matchId:string;role:string} {
    const match=getMatchRow(this.db,input.matchId);this.repository.authorizeTournament(actor,match.tournament_id);if(!['SUPER_ADMIN','TOURNAMENT_ADMIN','MAT_OPERATOR'].includes(actor.role))throw new HttpError(403,'PERMISSION_DENIED','Pairing permission required.');
    const table=input.role==='REFEREE'?'referee_sessions':'judge_sessions';const roleQuery=input.role==='REFEREE'?'':' AND role=?';
    const existing=this.db.prepare(`SELECT id FROM ${table} WHERE match_id=? AND status='ACTIVE'${roleQuery}`).get(...(input.role==='REFEREE'?[input.matchId]:[input.matchId,input.role])) as {id:string}|undefined;
    if(existing){if(!input.replace)throw new HttpError(409,'ROLE_ALREADY_PAIRED',`${input.role} already has an active session. Replace it explicitly.`);this.db.prepare(`UPDATE ${table} SET status='REVOKED' WHERE id=?`).run(existing.id);this.db.prepare('DELETE FROM device_presence WHERE session_id=?').run(existing.id);}
    const token=createToken();const expiresAt=Date.now()+(input.expiresInSeconds??300)*1000;const id=randomUUID();
    this.db.transaction(()=>{this.db.prepare('INSERT INTO pairing_tokens(id,token_hash,tournament_id,match_id,role,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,hashToken(token),match.tournament_id,input.matchId,input.role,expiresAt,actor.id,isoNow());audit(this.db,{tournamentId:match.tournament_id,actorId:actor.id,action:'PAIRING_TOKEN_ISSUED',entityType:'match',entityId:input.matchId,after:{role:input.role,expiresAt}});})();
    return{token,expiresAt,matchId:input.matchId,role:input.role};
  }

  exchangePairing(token: string, deviceName: string): {sessionToken:string;session:DeviceSession} {
    const pairing=this.db.prepare('SELECT * FROM pairing_tokens WHERE token_hash=?').get(hashToken(token)) as {id:string;tournament_id:string;match_id:string;role:'J1'|'J2'|'J3'|'REFEREE';expires_at:number;used_at:number|null}|undefined;
    if(!pairing||pairing.used_at)throw new HttpError(401,'INVALID_PAIRING_TOKEN','Pairing code is invalid or has already been used.');if(pairing.expires_at<Date.now())throw new HttpError(401,'PAIRING_TOKEN_EXPIRED','Pairing code has expired. Ask the operator for a new code.');
    const sessionToken=createToken();const sessionId=randomUUID();const now=Date.now();const table=pairing.role==='REFEREE'?'referee_sessions':'judge_sessions';
    this.db.transaction(()=>{const update=this.db.prepare('UPDATE pairing_tokens SET used_at=? WHERE id=? AND used_at IS NULL').run(now,pairing.id);if(update.changes!==1)throw new HttpError(409,'PAIRING_TOKEN_USED','Pairing code was already used.');if(table==='judge_sessions')this.db.prepare('INSERT INTO judge_sessions(id,tournament_id,match_id,token_hash,role,device_name,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)').run(sessionId,pairing.tournament_id,pairing.match_id,hashToken(sessionToken),pairing.role,deviceName.slice(0,100)||'Browser device',now+12*3600*1000,isoNow());else this.db.prepare('INSERT INTO referee_sessions(id,tournament_id,match_id,token_hash,device_name,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').run(sessionId,pairing.tournament_id,pairing.match_id,hashToken(sessionToken),deviceName.slice(0,100)||'Referee browser',now+12*3600*1000,isoNow());this.db.prepare('INSERT INTO device_presence(session_id,role,match_id,status,last_seen_at,connected_at) VALUES(?,?,?,\'OFFLINE\',?,?)').run(sessionId,pairing.role,pairing.match_id,now,now);})();
    return{sessionToken,session:this.deviceSession(sessionToken)};
  }

  deviceSession(token: string, heartbeat = false): DeviceSession {
    const hash=hashToken(token);let session=this.db.prepare(`SELECT id,tournament_id,match_id,role,device_name,status,expires_at,last_sequence FROM judge_sessions WHERE token_hash=?`).get(hash) as DeviceSession|undefined;
    if(!session)session=this.db.prepare(`SELECT id,tournament_id,match_id,'REFEREE' AS role,device_name,status,expires_at,0 AS last_sequence FROM referee_sessions WHERE token_hash=?`).get(hash) as DeviceSession|undefined;
    if(!session||session.status!=='ACTIVE')throw new HttpError(401,'SESSION_INVALID','Device session is invalid or revoked.');if(session.expires_at<Date.now())throw new HttpError(401,'SESSION_EXPIRED','Device session has expired.');
    if(heartbeat){const now=Date.now();const table=session.role==='REFEREE'?'referee_sessions':'judge_sessions';this.db.prepare(`UPDATE ${table} SET last_seen_at=? WHERE id=?`).run(now,session.id);this.db.prepare(`INSERT INTO device_presence(session_id,role,match_id,status,last_seen_at,connected_at) VALUES(?,?,?,'ONLINE',?,?) ON CONFLICT(session_id) DO UPDATE SET status='ONLINE',last_seen_at=excluded.last_seen_at`).run(session.id,session.role,session.match_id,now,now);}
    return session;
  }

  heartbeat(token:string):DeviceSession & {presenceChanged:boolean}{
    const session=this.deviceSession(token,false);const before=this.db.prepare('SELECT status,last_seen_at FROM device_presence WHERE session_id=?').get(session.id) as {status:string;last_seen_at:number}|undefined;
    const cutoff=Date.now()-Number(process.env.PRESENCE_EXPIRY_SECONDS||15)*1000;const presenceChanged=!before||before.status!=='ONLINE'||before.last_seen_at<=cutoff;
    return {...this.deviceSession(token,true),presenceChanged};
  }
  revokeSession(actor:Actor,sessionId:string):void{const session=this.db.prepare(`SELECT id,tournament_id,'judge' AS kind FROM judge_sessions WHERE id=? UNION ALL SELECT id,tournament_id,'referee' AS kind FROM referee_sessions WHERE id=?`).get(sessionId,sessionId) as {id:string;tournament_id:string;kind:string}|undefined;if(!session)throw new HttpError(404,'NOT_FOUND','Session not found.');this.repository.authorizeTournament(actor,session.tournament_id);const table=session.kind==='judge'?'judge_sessions':'referee_sessions';this.db.transaction(()=>{this.db.prepare(`UPDATE ${table} SET status='REVOKED' WHERE id=?`).run(sessionId);this.db.prepare('DELETE FROM device_presence WHERE session_id=?').run(sessionId);audit(this.db,{tournamentId:session.tournament_id,actorId:actor.id,action:'DEVICE_SESSION_REVOKED',entityType:'session',entityId:sessionId});})();}

  submitProposal(token:string,input:ScoreProposalInput):ProposalResult{
    const session=this.deviceSession(token,true);if(session.role==='REFEREE')throw new HttpError(403,'PERMISSION_DENIED','Referee sessions cannot submit corner-judge scores.');if(session.match_id!==input.matchId||session.id!==input.judgeSessionId)throw new HttpError(403,'SESSION_MISMATCH','Proposal does not belong to this assigned judge session.');
    const match=getMatchRow(this.db,input.matchId);if(!['IN_PROGRESS','GOLDEN_POINT'].includes(match.state))throw new HttpError(409,'SCORING_CLOSED','Scoring proposals require a live round.');const ruleset=this.ruleset(match.tournament_id);const now=Date.now();
    const presenceCutoff=now-Number(process.env.PRESENCE_EXPIRY_SECONDS||15)*1000;
    const onlineJudgeCount=(this.db.prepare(`SELECT COUNT(DISTINCT session_id) AS count FROM device_presence WHERE match_id=? AND role IN ('J1','J2','J3') AND status='ONLINE' AND last_seen_at>?`).get(match.id,presenceCutoff) as {count:number}).count;
    // Automatic policy: one live corner judge can score alone; two or more restore two-judge consensus.
    const consensusThreshold=Math.min(ruleset.consensusThreshold,onlineJudgeCount===1?1:2);const scoringMode=onlineJudgeCount===1?'ONE_JUDGE':'TWO_JUDGE';
    // Device clocks are diagnostic only. Server receipt time is the authority for consensus windows.
    const clientSubmittedAt=input.submittedAt;input={...input,submittedAt:now};
    const duplicate=this.db.prepare('SELECT status,reason,decision_id FROM scoring_proposals WHERE event_id=? OR idempotency_key=?').get(input.eventId,input.idempotencyKey) as {status:string;reason:string;decision_id:string|null}|undefined;if(duplicate)return{status:duplicate.status,reason:'DUPLICATE_DELIVERY',decisionId:duplicate.decision_id,points:0,duplicate:true,matchId:match.id};
    let result:ProposalResult|undefined;
    this.db.transaction(()=>{
      let status='PENDING';let reason='AWAITING_DISTINCT_JUDGES';let decisionId:string|null=null;let points=0;let expiredPriorCount=0;let matchingJudgeCount=0;const round=this.db.prepare('SELECT id,number FROM match_rounds WHERE id=? AND match_id=?').get(input.roundId,match.id) as {id:string;number:number}|undefined;
      if(!round||round.number!==match.current_round){status='REJECTED';reason='ROUND_MISMATCH';}
      else if((session.last_sequence??0)>=input.sequence){status='REJECTED';reason='OUT_OF_ORDER_SEQUENCE';}
      else{
        const expired=this.db.prepare(`UPDATE scoring_proposals SET status='EXPIRED',reason='CONSENSUS_WINDOW_ELAPSED' WHERE match_id=? AND round_id=? AND side=? AND point_type=? AND status='PENDING' AND submitted_at<?`).run(match.id,input.roundId,input.side,input.pointType,now-ruleset.consensusWindowMs);expiredPriorCount=expired.changes;
        const prior=this.db.prepare(`SELECT event_id,judge_id,submitted_at FROM scoring_proposals WHERE match_id=? AND round_id=? AND side=? AND point_type=? AND status='PENDING' ORDER BY submitted_at`).all(match.id,input.roundId,input.side,input.pointType) as Array<{event_id:string;judge_id:string;submitted_at:number}>;
        if(consensusThreshold>1){
          if(prior.some(p=>p.judge_id===session.id)){status='REJECTED';reason='JUDGE_ALREADY_COUNTED';}
          else if(prior.length>0&&(input.submittedAt<prior[0]!.submitted_at||input.submittedAt-prior[0]!.submitted_at>ruleset.consensusWindowMs)){status='REJECTED';reason='OUTSIDE_CONSENSUS_WINDOW';}
        }
      }
      this.db.prepare(`INSERT INTO scoring_proposals(event_id,match_id,round_id,judge_session_id,judge_id,side,point_type,submitted_at,event_sequence,idempotency_key,status,reason,decision_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.eventId,match.id,input.roundId,session.id,session.id,input.side,input.pointType,input.submittedAt,input.sequence,input.idempotencyKey,status,reason,decisionId,isoNow());
      if(status!=='OUT_OF_ORDER_SEQUENCE')this.db.prepare('UPDATE judge_sessions SET last_sequence=? WHERE id=?').run(input.sequence,session.id);
      if(status==='PENDING'){
        const group=this.db.prepare(`SELECT event_id,judge_id FROM scoring_proposals WHERE match_id=? AND round_id=? AND side=? AND point_type=? AND status='PENDING' ORDER BY submitted_at`).all(match.id,input.roundId,input.side,input.pointType) as Array<{event_id:string;judge_id:string}>;
        matchingJudgeCount=new Set(group.map(item=>item.judge_id)).size;
        if(matchingJudgeCount>=consensusThreshold){
          status='ACCEPTED';reason=consensusThreshold===1?'ONE_JUDGE_MODE':'CONSENSUS_THRESHOLD_MET';decisionId=randomUUID();points=ruleset.points[input.pointType];const ids=group.map(item=>item.event_id);const placeholders=ids.map(()=>'?').join(',');this.db.prepare(`UPDATE scoring_proposals SET status='ACCEPTED',reason=?,decision_id=? WHERE event_id IN (${placeholders})`).run(reason,decisionId,...ids);
          const column=input.side==='BLUE'?'blue_score':'red_score';this.db.prepare(`UPDATE matches SET ${column}=${column}+? WHERE id=?`).run(points,match.id);this.db.prepare(`UPDATE match_rounds SET ${column}=${column}+? WHERE id=?`).run(points,input.roundId);
          const sequence=match.sequence+1;this.db.prepare('UPDATE matches SET sequence=?,version=version+1,updated_at=? WHERE id=?').run(sequence,isoNow(),match.id);appendMatchEvent(this.db,{tournamentId:match.tournament_id,matchId:match.id,sequence,type:'score.accepted',actorId:session.id,sessionId:session.id,payload:{side:input.side,pointType:input.pointType,points,roundId:input.roundId,round:match.current_round,proposalIds:ids,decisionId,undoable:true,scoringMode,onlineJudgeCount,consensusThreshold},idempotencyKey:`consensus:${decisionId}`});
        }
      }
      if(status!=='ACCEPTED'){const sequence=match.sequence+1;this.db.prepare('UPDATE matches SET sequence=?,version=version+1,updated_at=? WHERE id=?').run(sequence,isoNow(),match.id);appendMatchEvent(this.db,{tournamentId:match.tournament_id,matchId:match.id,sequence,type:status==='REJECTED'?'score.rejected':'score.proposed',actorId:session.id,sessionId:session.id,payload:{eventId:input.eventId,side:input.side,pointType:input.pointType,status,reason},idempotencyKey:`proposal:${input.eventId}`});}
      audit(this.db,{tournamentId:match.tournament_id,actorId:session.id,action:`SCORE_PROPOSAL_${status}`,entityType:'match',entityId:match.id,after:{eventId:input.eventId,status,reason,decisionId,clientSubmittedAt,scoringMode,onlineJudgeCount,consensusThreshold}});result={status,reason,decisionId,points,matchId:match.id,diagnostics:{serverReceivedAt:now,consensusWindowMs:ruleset.consensusWindowMs,consensusThreshold,matchingJudgeCount,expiredPriorCount,onlineJudgeCount,scoringMode}};
    })();if(!result)throw new HttpError(500,'PROPOSAL_NOT_RECORDED','Proposal transaction did not return a result.');return result;
  }

  expirePresence(expiryMs=15000):string[]{const cutoff=Date.now()-expiryMs;const rows=this.db.prepare(`SELECT match_id FROM device_presence WHERE status='ONLINE' AND last_seen_at<?`).all(cutoff) as Array<{match_id:string}>;this.db.prepare(`UPDATE device_presence SET status='OFFLINE' WHERE status='ONLINE' AND last_seen_at<?`).run(cutoff);return[...new Set(rows.map(row=>row.match_id))];}

  /** Persist timer expiry before broadcasting it. A finished break never starts scoring automatically. */
  expireTimers(now=Date.now()):string[]{
    const rows=this.db.prepare(`SELECT m.id,m.tournament_id,m.state,m.current_round,m.timer_json,c.rounds AS total_rounds
      FROM matches m JOIN categories c ON c.id=m.category_id
      WHERE json_extract(m.timer_json,'$.running')=1
         OR (m.state='PAUSED' AND json_extract(m.timer_json,'$.kind')='ROUND' AND json_extract(m.timer_json,'$.remainingMs')<=0)`).all() as Array<{id:string;tournament_id:string;state:MatchSnapshot['state'];current_round:number;total_rounds:number;timer_json:string}>;
    const changed:string[]=[];
    for(const row of rows){
      const timer=JSON.parse(row.timer_json) as MatchSnapshot['timer'];
      const runningExpired=timer.running&&remainingAt(timer,now)<=0;
      const pausedRoundRecovery=row.state==='PAUSED'&&timer.kind==='ROUND'&&timer.remainingMs<=0&&row.current_round<row.total_rounds;
      if(!runningExpired&&!pausedRoundRecovery)continue;
      const valid=pausedRoundRecovery||(timer.kind==='ROUND'&&row.state==='IN_PROGRESS')||(timer.kind==='BREAK'&&row.state==='ROUND_BREAK')||(timer.kind==='MEDICAL'&&row.state==='PAUSED')||(timer.kind==='GOLDEN_POINT'&&row.state==='GOLDEN_POINT');
      if(!valid)continue;
      this.execute({id:'system-timer',role:'SUPER_ADMIN',tournamentIds:[row.tournament_id]},row.id,{type:'TIMER_EXPIRED'},`timer-expired:${row.id}:${timer.authoritativeAt}`);
      changed.push(row.id);
    }
    return changed;
  }

  recoverTimers(reason='Server restarted; operator confirmation required before resume.'):string[]{const rows=this.db.prepare(`SELECT id,tournament_id,sequence,timer_json FROM matches WHERE json_extract(timer_json,'$.running')=1`).all() as Array<{id:string;tournament_id:string;sequence:number;timer_json:string}>;for(const row of rows){this.db.transaction(()=>{const timer=JSON.parse(row.timer_json) as MatchSnapshot['timer'];const recovered={...timer,remainingMs:remainingAt(timer,Date.now()),running:false,authoritativeAt:Date.now()};this.db.prepare('UPDATE matches SET timer_json=?,state=CASE WHEN state=\'IN_PROGRESS\' THEN \'PAUSED\' ELSE state END,sequence=sequence+1,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(recovered),isoNow(),row.id);appendMatchEvent(this.db,{tournamentId:row.tournament_id,matchId:row.id,sequence:row.sequence+1,type:'timer.recovered_paused',payload:{reason}});})();}return rows.map(row=>row.id);}
}
