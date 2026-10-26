import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './database';
import { TournamentRepository } from './repository';
import { MatchService } from '../domain/match-service';
import { hashPassword, hashToken } from '../security/auth';
import type { Actor } from '../types';
import { isoNow } from './audit';

/** Development-only fictional showcase. Never use these records as official results. */
export function seedDevelopment(db: SqliteDatabase): {matchId:string;tournamentId:string}|null {
  const existing=db.prepare('SELECT COUNT(*) AS count FROM tournaments').get() as {count:number};if(existing.count>0){const match=db.prepare(`SELECT id,tournament_id FROM matches WHERE state IN ('PAUSED','IN_PROGRESS') ORDER BY updated_at DESC LIMIT 1`).get() as {id:string;tournament_id:string}|undefined;return match?{matchId:match.id,tournamentId:match.tournament_id}:null;}
  const repo=new TournamentRepository(db);const profileId=randomUUID();const organizationId=randomUUID();const now=isoNow();
  db.transaction(()=>{db.prepare('INSERT INTO organizations(id,name,slug,created_at) VALUES(?,?,?,?)').run(organizationId,'TKDTech Development Organization','tkdtech-development',now);db.prepare('INSERT INTO profiles(id,email,full_name,password_hash,created_at) VALUES(?,?,?,?,?)').run(profileId,'admin@demo.tkd','Adam Aghzaf',hashPassword('DemoAdmin2026!'),now);db.prepare('INSERT INTO organization_members(organization_id,profile_id,role) VALUES(?,?,?)').run(organizationId,profileId,'SUPER_ADMIN');})();
  const actor:Actor={id:profileId,role:'SUPER_ADMIN',tournamentIds:[]};
  const tournament=repo.createTournament(actor,{name:'Morocco Open · Development Showcase',description:'Fictional development data for verifying TKD Scoring workflows. Not an official competition or result record.',organizer:'TKDTech Sports Management',venue:'Casablanca Sports Arena',country:'Morocco',startDate:'2026-10-24',endDate:'2026-10-25',timezone:'Africa/Casablanca',matCount:3,mode:'LOCAL'});
  db.prepare('UPDATE tournaments SET is_development_seed=1 WHERE id=?').run(tournament.id);
  const clubInputs=[{name:'Atlas Taekwondo Club',country:'Morocco',countryCode:'MAR',headCoach:'Youssef El Amrani'},{name:'France Taekwondo Club',country:'France',countryCode:'FRA',headCoach:'Claire Martin'},{name:'Séoul Performance Team',country:'Korea',countryCode:'KOR',headCoach:'Min-jun Park'},{name:'Iberia Kyorugi Academy',country:'Spain',countryCode:'ESP',headCoach:'Diego Ruiz'}];
  const clubs=clubInputs.map(input=>repo.createClub(actor,tournament.id,input).id);
  const categoryId=repo.createCategory(actor,tournament.id,{name:'Men -68 kg',division:'MEN',ageGroup:'Senior',minWeightKg:58,maxWeightKg:68,format:'SINGLE_ELIMINATION',rounds:3,roundDurationMs:120000,breakDurationMs:60000,goldenPointPolicy:'GOLDEN_POINT'}).id;
  const athleteInputs=[
    {firstName:'Rachid',lastName:'A.',division:'MEN' as const,nationality:'France',countryCode:'FRA',clubId:clubs[1],weightKg:66.4,seed:1,dateOfBirth:'2002-04-18',externalNumber:'DEV-FRA-001'},
    {firstName:'Yassine',lastName:'El Mansouri',division:'MEN' as const,nationality:'Morocco',countryCode:'MAR',clubId:clubs[0],weightKg:65.8,seed:2,dateOfBirth:'2001-09-12',externalNumber:'DEV-MAR-002'},
    {firstName:'Jun',lastName:'Kim',division:'MEN' as const,nationality:'Korea',countryCode:'KOR',clubId:clubs[2],weightKg:67.1,seed:3,dateOfBirth:'2003-01-25',externalNumber:'DEV-KOR-003'},
    {firstName:'Diego',lastName:'Lopez',division:'MEN' as const,nationality:'Spain',countryCode:'ESP',clubId:clubs[3],weightKg:64.9,seed:4,dateOfBirth:'2002-11-03',externalNumber:'DEV-ESP-004'},
    {firstName:'Anas',lastName:'Bouazza',division:'MEN' as const,nationality:'Morocco',countryCode:'MAR',clubId:clubs[0],weightKg:66.9,seed:5,dateOfBirth:'2004-02-14',externalNumber:'DEV-MAR-005'},
    {firstName:'Hugo',lastName:'Bernard',division:'MEN' as const,nationality:'France',countryCode:'FRA',clubId:clubs[1],weightKg:65.2,seed:6,dateOfBirth:'2003-07-30',externalNumber:'DEV-FRA-006'},
    {firstName:'Sung',lastName:'Park',division:'MEN' as const,nationality:'Korea',countryCode:'KOR',clubId:clubs[2],weightKg:67.5,seed:7,dateOfBirth:'2001-12-08',externalNumber:'DEV-KOR-007'},
    {firstName:'M.',lastName:'Ait Bouzid',division:'MEN' as const,nationality:'Morocco',countryCode:'MAR',clubId:clubs[0],weightKg:66.1,seed:8,dateOfBirth:'2002-06-22',externalNumber:'DEV-MAR-008'}
  ];
  for(const input of athleteInputs)repo.createAthlete(actor,tournament.id,{...input,categoryId});
  repo.updateTournamentStatus(actor,tournament.id,'REGISTRATION_OPEN');repo.updateTournamentStatus(actor,tournament.id,'REGISTRATION_CLOSED');
  const draw=repo.generateDraw(actor,categoryId,'SEEDED');repo.publishDraw(actor,draw.drawId);repo.updateTournamentStatus(actor,tournament.id,'IN_PROGRESS');
  const active=db.prepare(`SELECT m.id,m.blue_athlete_id FROM matches m JOIN bracket_nodes bn ON bn.id=m.bracket_node_id WHERE m.category_id=? AND bn.round=1 AND bn.position=0`).get(categoryId) as {id:string;blue_athlete_id:string};
  const mat=db.prepare('SELECT id FROM mats WHERE tournament_id=? ORDER BY name LIMIT 1').get(tournament.id) as {id:string};repo.assignMatch(actor,active.id,mat.id);
  const service=new MatchService(db,repo);const command=(type:Parameters<MatchService['execute']>[2]['type'],side?:'BLUE'|'RED',pointType?:Parameters<MatchService['execute']>[2]['pointType'])=>service.execute(actor,active.id,{type,side,pointType});
  command('START');
  command('SCORE','BLUE','HEAD_KICK');command('SCORE','BLUE','BODY_KICK');command('SCORE','RED','BODY_KICK');command('PAUSE');command('NEXT_ROUND');command('RESUME');
  command('SCORE','BLUE','HEAD_KICK');command('SCORE','RED','TURNING_BODY_KICK');command('PAUSE');command('NEXT_ROUND');command('RESUME');
  command('SCORE','BLUE','TURNING_BODY_KICK');command('SCORE','RED','BODY_PUNCH');command('GAM_JEOM','BLUE');command('PAUSE');
  const current=db.prepare('SELECT timer_json FROM matches WHERE id=?').get(active.id) as {timer_json:string};const timer=JSON.parse(current.timer_json) as {remainingMs:number;running:boolean;authoritativeAt:number;kind:string};timer.remainingMs=84000;timer.running=false;timer.authoritativeAt=Date.now();db.prepare('UPDATE matches SET timer_json=?,match_number=\'203\' WHERE id=?').run(JSON.stringify(timer),active.id);
  for(const role of ['J1','J2','J3'] as const){const sessionId=randomUUID();const timestamp=Date.now();db.prepare('INSERT INTO judge_sessions(id,tournament_id,match_id,token_hash,role,device_name,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)').run(sessionId,tournament.id,active.id,hashToken(randomUUID()),role,`Development ${role} tablet`,timestamp+12*3600*1000,isoNow());db.prepare('INSERT INTO device_presence(session_id,role,match_id,status,last_seen_at,connected_at) VALUES(?,?,?,\'ONLINE\',?,?)').run(sessionId,role,active.id,timestamp,timestamp);}
  return{matchId:active.id,tournamentId:tournament.id};
}
