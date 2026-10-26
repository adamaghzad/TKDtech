import { randomUUID } from 'node:crypto';
import type { AuthUser, Role, Ruleset } from '@tkd/contracts';
import { advanceWinner, EXAMPLE_WT_STYLE_RULESET, generateBracket, validateBracket, validateRuleset, type Bracket } from '@tkd/domain';
import type { SqliteDatabase } from './database';
import { audit, isoNow } from './audit';
import { createToken, hashPassword, hashToken, verifyPassword } from '../security/auth';
import { HttpError, optionalString, requiredString } from '../http';
import type { Actor, TournamentRow } from '../types';

interface TournamentInput { name: string; description?: string; organizer?: string; venue?: string; country?: string; startDate: string; endDate: string; timezone?: string; matCount?: number; mode?: 'LOCAL'|'CLOUD' }
interface AthleteInput { firstName: string; lastName: string; dateOfBirth: string; division: 'MEN'|'WOMEN'; nationality: string; countryCode: string; clubId?: string; externalNumber?: string; coach?: string; categoryId?: string; weightKg?: number; seed?: number }
interface RulesetConfigurationInput { roundPointGapEnabled:boolean;roundPointGapThreshold:number;matchPointGapEnabled:boolean;matchPointGapThreshold:number;matchPointGapCompletionRound:number;matchPointGapLiveFromRound:number;expectedVersion?:string }
interface CategoryInput { name: string; division: 'MEN'|'WOMEN'; ageGroup: string; minWeightKg: number; maxWeightKg: number; format: 'SINGLE_ELIMINATION'|'REPECHAGE'; rounds?: number; roundDurationMs?: number; breakDurationMs?: number; goldenPointPolicy?: string; repechagePolicy?: string }

export class TournamentRepository {
  constructor(readonly db: SqliteDatabase) {}

  authenticate(email: string, password: string): { token: string; user: AuthUser } {
    const profile = this.db.prepare('SELECT * FROM profiles WHERE lower(email)=lower(?)').get(email) as {id:string;email:string;full_name:string;password_hash:string}|undefined;
    if (!profile || !verifyPassword(password, profile.password_hash)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    return { token: this.createAuthSession(profile.id), user: this.userForProfile(profile.id) };
  }

  createAuthSession(profileId: string): string {
    const token = createToken();
    this.db.prepare('INSERT INTO auth_sessions(id,token_hash,profile_id,expires_at,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), hashToken(token), profileId, Date.now() + 7*24*3600*1000, isoNow());
    return token;
  }

  userForProfile(profileId: string): AuthUser {
    const profile = this.db.prepare('SELECT id,email,full_name FROM profiles WHERE id=?').get(profileId) as {id:string;email:string;full_name:string}|undefined;
    if (!profile) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in is required.');
    const membership = this.db.prepare(`SELECT role FROM organization_members WHERE profile_id=? ORDER BY CASE role WHEN 'SUPER_ADMIN' THEN 0 WHEN 'TOURNAMENT_ADMIN' THEN 1 ELSE 2 END LIMIT 1`).get(profileId) as {role:Role}|undefined;
    const tournamentIds = (this.db.prepare('SELECT t.id AS tournament_id FROM organization_members om JOIN tournaments t ON t.organization_id=om.organization_id WHERE om.profile_id=?').all(profileId) as Array<{tournament_id:string}>).map(row => row.tournament_id);
    return { id: profile.id, email: profile.email, name: profile.full_name, role: membership?.role ?? 'PUBLIC_VIEWER', tournamentIds };
  }

  userForToken(token?: string): AuthUser | null {
    if (!token) return null;
    const row = this.db.prepare('SELECT profile_id,expires_at FROM auth_sessions WHERE token_hash=?').get(hashToken(token)) as {profile_id:string;expires_at:number}|undefined;
    if (!row) return null;
    if (row.expires_at < Date.now()) { this.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hashToken(token)); return null; }
    return this.userForProfile(row.profile_id);
  }

  revokeAuthToken(token: string): void { this.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hashToken(token)); }

  registerOrganization(input: { name: string; fullName: string; email: string; password: string }): { token: string; user: AuthUser } {
    if (input.password.length < 10) throw new HttpError(400, 'WEAK_PASSWORD', 'Password must contain at least 10 characters.');
    const profileId = randomUUID(); const organizationId = randomUUID(); const now = isoNow();
    const slug = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}-${organizationId.slice(0,6)}`;
    try {
      this.db.transaction(() => {
        this.db.prepare('INSERT INTO organizations(id,name,slug,created_at) VALUES(?,?,?,?)').run(organizationId, requiredString(input.name,'Organization'), slug, now);
        this.db.prepare('INSERT INTO profiles(id,email,full_name,password_hash,created_at) VALUES(?,?,?,?,?)').run(profileId, input.email.toLowerCase(), requiredString(input.fullName,'Full name'), hashPassword(input.password), now);
        this.db.prepare('INSERT INTO organization_members(organization_id,profile_id,role) VALUES(?,?,?)').run(organizationId, profileId, 'TOURNAMENT_ADMIN');
        audit(this.db, { actorId: profileId, action: 'ORGANIZATION_CREATED', entityType: 'organization', entityId: organizationId, after: { name: input.name } });
      })();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) throw new HttpError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists.');
      throw error;
    }
    return { token: this.createAuthSession(profileId), user: this.userForProfile(profileId) };
  }

  actor(user: AuthUser): Actor { return { id: user.id, role: user.role, tournamentIds: user.tournamentIds }; }
  authorizeTournament(actor: Actor, tournamentId: string, write = false): void {
    if (!actor.tournamentIds.includes(tournamentId) && actor.role !== 'SUPER_ADMIN') throw new HttpError(403, 'TOURNAMENT_FORBIDDEN', 'You are not assigned to this tournament.');
    if (write && !['SUPER_ADMIN','TOURNAMENT_ADMIN','REGISTRATION_MANAGER'].includes(actor.role)) throw new HttpError(403, 'PERMISSION_DENIED', 'Your role cannot perform this action.');
  }

  listTournaments(actor?: Actor): TournamentRow[] {
    if (!actor || actor.role === 'PUBLIC_VIEWER') return this.db.prepare(`SELECT * FROM tournaments WHERE status NOT IN ('DRAFT','CANCELLED') ORDER BY start_date DESC`).all() as TournamentRow[];
    if (actor.role === 'SUPER_ADMIN') return this.db.prepare('SELECT * FROM tournaments ORDER BY start_date DESC').all() as TournamentRow[];
    const placeholders = actor.tournamentIds.map(() => '?').join(',');
    if (!placeholders) return [];
    return this.db.prepare(`SELECT * FROM tournaments WHERE id IN (${placeholders}) ORDER BY start_date DESC`).all(...actor.tournamentIds) as TournamentRow[];
  }

  createTournament(actor: Actor, input: TournamentInput): TournamentRow {
    if (!['SUPER_ADMIN','TOURNAMENT_ADMIN'].includes(actor.role)) throw new HttpError(403, 'PERMISSION_DENIED', 'Tournament administrator role required.');
    const membership = this.db.prepare('SELECT organization_id FROM organization_members WHERE profile_id=? LIMIT 1').get(actor.id) as {organization_id:string}|undefined;
    if (!membership) throw new HttpError(400, 'NO_ORGANIZATION', 'Create an organization before creating a tournament.');
    const id = randomUUID(); const now = isoNow(); const name = requiredString(input.name, 'Tournament name');
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}-${id.slice(0,6)}`;
    if (input.endDate < input.startDate) throw new HttpError(400, 'INVALID_DATES', 'End date cannot precede start date.');
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO tournaments(id,organization_id,name,slug,description,organizer,venue,country,start_date,end_date,timezone,status,mode,mat_count,ruleset_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?, ?,?)`).run(
        id, membership.organization_id, name, slug, optionalString(input.description,2000), input.organizer || 'TKDTech Sports Management', input.venue || 'To be announced', input.country || 'Morocco', input.startDate, input.endDate, input.timezone || 'Africa/Casablanca', input.mode || 'LOCAL', input.matCount || 1, EXAMPLE_WT_STYLE_RULESET.id, now, now
      );
      this.db.prepare('INSERT INTO tournament_rulesets(id,tournament_id,version,name,config_json,effective_date,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), id, EXAMPLE_WT_STYLE_RULESET.version, EXAMPLE_WT_STYLE_RULESET.name, JSON.stringify({...EXAMPLE_WT_STYLE_RULESET, rounds: 3}), EXAMPLE_WT_STYLE_RULESET.effectiveDate, now);
      const matCount = Math.max(1, Math.min(32, input.matCount || 1));
      for (let index=1; index<=matCount; index++) this.db.prepare('INSERT INTO mats(id,tournament_id,name,display_slug,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), id, `Mat ${index}`, `${slug}-mat-${index}`, now);
      audit(this.db, { tournamentId: id, actorId: actor.id, action: 'TOURNAMENT_CREATED', entityType: 'tournament', entityId: id, after: input });
    })();
    actor.tournamentIds.push(id);
    return this.db.prepare('SELECT * FROM tournaments WHERE id=?').get(id) as TournamentRow;
  }

  updateTournamentStatus(actor: Actor, id: string, status: string): void {
    this.authorizeTournament(actor, id, true);
    if (actor.role === 'REGISTRATION_MANAGER') throw new HttpError(403, 'PERMISSION_DENIED', 'Registration managers cannot change tournament status.');
    const row = this.db.prepare('SELECT * FROM tournaments WHERE id=?').get(id) as TournamentRow|undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Tournament not found.');
    const allowed: Record<string,string[]> = { DRAFT:['REGISTRATION_OPEN','CANCELLED'], REGISTRATION_OPEN:['REGISTRATION_CLOSED','CANCELLED'], REGISTRATION_CLOSED:['DRAW_READY','REGISTRATION_OPEN','CANCELLED'], DRAW_READY:['IN_PROGRESS','REGISTRATION_CLOSED','CANCELLED'], IN_PROGRESS:['COMPLETED','CANCELLED'], COMPLETED:['IN_PROGRESS'], CANCELLED:[] };
    if (!allowed[row.status]?.includes(status)) throw new HttpError(409, 'INVALID_TRANSITION', `${row.status} cannot transition to ${status}.`);
    if (status === 'COMPLETED') {
      const unresolved = this.db.prepare(`SELECT COUNT(*) AS count FROM matches WHERE tournament_id=? AND state NOT IN ('COMPLETED','WALKOVER','WITHDRAWN','DISQUALIFIED','CANCELLED') AND blue_athlete_id IS NOT NULL AND red_athlete_id IS NOT NULL`).get(id) as {count:number};
      if (unresolved.count > 0) throw new HttpError(409, 'UNRESOLVED_MATCHES', 'Complete or explicitly resolve all scheduled matches first.');
    }
    this.db.transaction(() => { this.db.prepare('UPDATE tournaments SET status=?,version=version+1,updated_at=? WHERE id=?').run(status, isoNow(), id); audit(this.db,{tournamentId:id,actorId:actor.id,action:'TOURNAMENT_STATUS_CHANGED',entityType:'tournament',entityId:id,before:{status:row.status},after:{status}}); })();
  }

  updateRuleset(actor: Actor, tournamentId: string, input: RulesetConfigurationInput): Ruleset {
    this.authorizeTournament(actor,tournamentId,true);
    if(!['SUPER_ADMIN','TOURNAMENT_ADMIN'].includes(actor.role))throw new HttpError(403,'PERMISSION_DENIED','Only tournament administrators can change scoring rules.');
    let updated:Ruleset|undefined;
    this.db.transaction(()=>{
      const current=this.db.prepare('SELECT * FROM tournament_rulesets WHERE tournament_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(tournamentId) as {id:string;version:string;name:string;config_json:string;effective_date:string}|undefined;
      if(!current)throw new HttpError(404,'RULESET_NOT_FOUND','Tournament ruleset not found.');
      if(input.expectedVersion&&input.expectedVersion!==current.version)throw new HttpError(409,'RULESET_VERSION_CONFLICT','The ruleset changed in another session. Refresh before saving.');
      const active=this.db.prepare(`SELECT COUNT(*) AS count FROM matches WHERE tournament_id=? AND state IN ('CALLED','IN_PROGRESS','PAUSED','ROUND_BREAK','GOLDEN_POINT','UNDER_REVIEW')`).get(tournamentId) as {count:number};
      if(active.count>0)throw new HttpError(409,'RULESET_LOCKED','Scoring rules cannot change while a match is active. Finish the active match first.');
      const previous=JSON.parse(current.config_json) as Ruleset;
      const revision=(this.db.prepare('SELECT COUNT(*) AS count FROM tournament_rulesets WHERE tournament_id=?').get(tournamentId) as {count:number}).count+1;
      const version=`${current.version.replace(/-r\d+$/,'')}-r${revision}`;
      const {expectedVersion:_expectedVersion,...configuration}=input;
      updated={...previous,...configuration,version};
      const errors=validateRuleset(updated);if(errors.length)throw new HttpError(400,'INVALID_RULESET','Ruleset validation failed.',{errors});
      const id=randomUUID();const now=isoNow();
      this.db.prepare('INSERT INTO tournament_rulesets(id,tournament_id,version,name,config_json,effective_date,created_at) VALUES(?,?,?,?,?,?,?)').run(id,tournamentId,version,current.name,JSON.stringify(updated),current.effective_date,now);
      const policy=(ruleset:Ruleset)=>({roundPointGapEnabled:ruleset.roundPointGapEnabled??false,roundPointGapThreshold:ruleset.roundPointGapThreshold??15,matchPointGapEnabled:ruleset.matchPointGapEnabled??false,matchPointGapThreshold:ruleset.matchPointGapThreshold??20,matchPointGapCompletionRound:ruleset.matchPointGapCompletionRound??2,matchPointGapLiveFromRound:ruleset.matchPointGapLiveFromRound??3});
      audit(this.db,{tournamentId,actorId:actor.id,action:'RULESET_UPDATED',entityType:'ruleset',entityId:id,before:{version:current.version,...policy(previous)},after:{version,...policy(updated)}});
    })();
    if(!updated)throw new HttpError(500,'RULESET_UPDATE_FAILED','Ruleset update did not complete.');
    return updated;
  }

  getTournament(id: string): Record<string, unknown> {
    const tournament = this.db.prepare('SELECT * FROM tournaments WHERE id=?').get(id) as TournamentRow|undefined;
    if (!tournament) throw new HttpError(404,'NOT_FOUND','Tournament not found.');
    const clubs = this.db.prepare(`SELECT c.*,COUNT(a.id) AS athlete_count FROM clubs c LEFT JOIN athletes a ON a.club_id=c.id WHERE c.tournament_id=? GROUP BY c.id ORDER BY c.name`).all(id);
    const athletes = this.db.prepare(`SELECT a.*,c.name AS club_name,cat.name AS category_name,cat.id AS category_id,r.id AS registration_id,w.weight_kg,w.passed AS weigh_in_passed,s.seed_position FROM athletes a LEFT JOIN clubs c ON c.id=a.club_id LEFT JOIN athlete_registrations r ON r.athlete_id=a.id LEFT JOIN categories cat ON cat.id=r.category_id LEFT JOIN weigh_ins w ON w.registration_id=r.id LEFT JOIN tournament_seeds s ON s.athlete_id=a.id AND s.category_id=cat.id WHERE a.tournament_id=? ORDER BY a.last_name,a.first_name`).all(id);
    const categories = this.db.prepare(`SELECT c.*,COUNT(r.id) AS entrant_count FROM categories c LEFT JOIN athlete_registrations r ON r.category_id=c.id WHERE c.tournament_id=? GROUP BY c.id ORDER BY c.name`).all(id);
    const mats = this.db.prepare('SELECT * FROM mats WHERE tournament_id=? ORDER BY name').all(id);
    const matches = this.db.prepare(`SELECT m.id,m.match_number,m.state,m.current_round,m.blue_score,m.red_score,m.mat_id,m.queue_position,m.scheduled_at,c.name AS category_name,ba.first_name||' '||ba.last_name AS blue_name,ra.first_name||' '||ra.last_name AS red_name,mat.name AS mat_name FROM matches m JOIN categories c ON c.id=m.category_id LEFT JOIN athletes ba ON ba.id=m.blue_athlete_id LEFT JOIN athletes ra ON ra.id=m.red_athlete_id LEFT JOIN mats mat ON mat.id=m.mat_id WHERE m.tournament_id=? ORDER BY CAST(m.match_number AS INTEGER),m.match_number`).all(id);
    const draws = this.db.prepare(`SELECT d.*,c.name AS category_name FROM draws d JOIN categories c ON c.id=d.category_id WHERE c.tournament_id=? ORDER BY d.created_at DESC`).all(id);
    const results = this.db.prepare(`SELECT r.*,m.match_number,c.name AS category_name,w.first_name||' '||w.last_name AS winner_name,l.first_name||' '||l.last_name AS loser_name FROM tournament_results r JOIN matches m ON m.id=r.match_id JOIN categories c ON c.id=m.category_id LEFT JOIN athletes w ON w.id=r.winner_athlete_id LEFT JOIN athletes l ON l.id=r.loser_athlete_id WHERE r.tournament_id=? ORDER BY r.completed_at DESC`).all(id);
    const medals = this.db.prepare(`SELECT ms.id,ms.place,a.first_name||' '||a.last_name AS athlete_name,cl.name AS club_name,cat.name AS category_name FROM medal_standings ms JOIN athletes a ON a.id=ms.athlete_id LEFT JOIN clubs cl ON cl.id=ms.club_id JOIN categories cat ON cat.id=ms.category_id WHERE ms.tournament_id=? ORDER BY ms.place,a.last_name`).all(id);
    const ruleset = this.db.prepare('SELECT * FROM tournament_rulesets WHERE tournament_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(id) as {config_json:string}|undefined;
    return { tournament, clubs, athletes, categories, mats, matches, draws, results, medals, ruleset: ruleset ? JSON.parse(ruleset.config_json) as Ruleset : EXAMPLE_WT_STYLE_RULESET };
  }

  getPublicTournament(id: string): Record<string, unknown> {
    const details = this.getTournament(id);
    const tournament = details.tournament as TournamentRow;
    return {
      tournament: { id: tournament.id, name: tournament.name, slug: tournament.slug, description: tournament.description, organizer: tournament.organizer, venue: tournament.venue, country: tournament.country, start_date: tournament.start_date, end_date: tournament.end_date, timezone: tournament.timezone, status: tournament.status, mode: tournament.mode, mat_count: tournament.mat_count, is_development_seed: tournament.is_development_seed, version: tournament.version },
      clubs: (details.clubs as Array<Record<string, unknown>>).map(club => ({ id: club.id, name: club.name, country: club.country, country_code: club.country_code, athlete_count: club.athlete_count })),
      athletes: (details.athletes as Array<Record<string, unknown>>).map(athlete => ({ id: athlete.id, first_name: athlete.first_name, last_name: athlete.last_name, division: athlete.division, nationality: athlete.nationality, country_code: athlete.country_code, club_name: athlete.club_name, category_id: athlete.category_id, category_name: athlete.category_name, eligibility_status: athlete.eligibility_status })),
      categories: details.categories,
      mats: (details.mats as Array<Record<string, unknown>>).map(mat => ({ id: mat.id, name: mat.name, display_slug: mat.display_slug, network_status: mat.network_status })),
      matches: details.matches,
      draws: (details.draws as Array<Record<string, unknown>>).filter(draw => draw.status === 'PUBLISHED'),
      results: details.results,
      medals: details.medals,
      ruleset: details.ruleset
    };
  }

  createClub(actor: Actor, tournamentId: string, input: {name:string;country:string;countryCode:string;headCoach?:string;contactEmail?:string}): {id:string} {
    this.authorizeTournament(actor,tournamentId,true); const id=randomUUID();
    this.db.transaction(()=>{const duplicate=this.db.prepare('SELECT id FROM clubs WHERE tournament_id=? AND lower(name)=lower(?)').get(tournamentId,input.name.trim());if(duplicate)throw new HttpError(409,'POSSIBLE_DUPLICATE','A club with this name already exists in the tournament.');this.db.prepare('INSERT INTO clubs(id,tournament_id,name,country,country_code,head_coach,contact_email,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,tournamentId,requiredString(input.name,'Club name'),requiredString(input.country,'Country'),requiredString(input.countryCode,'Country code',3).toUpperCase(),input.headCoach||'',input.contactEmail||'',isoNow());audit(this.db,{tournamentId,actorId:actor.id,action:'CLUB_CREATED',entityType:'club',entityId:id,after:input});})();
    return {id};
  }

  createCategory(actor: Actor, tournamentId: string, input: CategoryInput): {id:string} {
    this.authorizeTournament(actor,tournamentId,true);
    if (actor.role === 'REGISTRATION_MANAGER') throw new HttpError(403,'PERMISSION_DENIED','Registration managers cannot create categories.');
    if (!(input.maxWeightKg>input.minWeightKg) || input.minWeightKg<0) throw new HttpError(400,'INVALID_WEIGHT_RANGE','Maximum weight must exceed minimum weight.');
    const tournament=this.db.prepare('SELECT ruleset_id FROM tournaments WHERE id=?').get(tournamentId) as {ruleset_id:string};
    const id=randomUUID();
    this.db.transaction(()=>{const duplicate=this.db.prepare('SELECT id FROM categories WHERE tournament_id=? AND lower(name)=lower(?)').get(tournamentId,input.name.trim());if(duplicate)throw new HttpError(409,'POSSIBLE_DUPLICATE','A category with this name already exists in the tournament.');this.db.prepare(`INSERT INTO categories(id,tournament_id,name,division,age_group,min_weight_kg,max_weight_kg,ruleset_id,format,rounds,round_duration_ms,break_duration_ms,golden_point_policy,repechage_policy) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,tournamentId,requiredString(input.name,'Category name'),input.division,requiredString(input.ageGroup,'Age group'),input.minWeightKg,input.maxWeightKg,tournament.ruleset_id,input.format,input.rounds||3,input.roundDurationMs||120000,input.breakDurationMs||60000,input.goldenPointPolicy||'CONFIGURED',input.format==='REPECHAGE'?input.repechagePolicy||null:null);audit(this.db,{tournamentId,actorId:actor.id,action:'CATEGORY_CREATED',entityType:'category',entityId:id,after:input});})();
    return {id};
  }

  createAthlete(actor: Actor, tournamentId: string, input: AthleteInput): {id:string} {
    this.authorizeTournament(actor,tournamentId,true); const id=randomUUID(); const now=isoNow();
    if (input.clubId) {const club=this.db.prepare('SELECT id FROM clubs WHERE id=? AND tournament_id=?').get(input.clubId,tournamentId);if(!club)throw new HttpError(400,'INVALID_CLUB','Club must belong to this tournament.');}
    if (input.categoryId) {
      const category=this.db.prepare('SELECT * FROM categories WHERE id=? AND tournament_id=?').get(input.categoryId,tournamentId) as {division:string;min_weight_kg:number;max_weight_kg:number}|undefined;
      if(!category)throw new HttpError(400,'INVALID_CATEGORY','Category must belong to this tournament.');
      if(category.division!==input.division)throw new HttpError(409,'INCOMPATIBLE_CATEGORY','Athlete division does not match the category.');
      if(input.weightKg!=null&&(input.weightKg<category.min_weight_kg||input.weightKg>category.max_weight_kg))throw new HttpError(409,'WEIGH_IN_FAILED','Recorded weight is outside this category.');
    }
    const duplicate=this.db.prepare('SELECT id FROM athletes WHERE tournament_id=? AND lower(first_name)=lower(?) AND lower(last_name)=lower(?) AND date_of_birth=?').get(tournamentId,input.firstName.trim(),input.lastName.trim(),input.dateOfBirth);
    if(duplicate)throw new HttpError(409,'POSSIBLE_DUPLICATE','An athlete with the same name and birth date already exists.');
    this.db.transaction(()=>{
      this.db.prepare(`INSERT INTO athletes(id,tournament_id,club_id,first_name,last_name,date_of_birth,division,nationality,country_code,external_number,coach,eligibility_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'ELIGIBLE',?)`).run(id,tournamentId,input.clubId||null,requiredString(input.firstName,'First name'),requiredString(input.lastName,'Last name'),input.dateOfBirth,input.division,requiredString(input.nationality,'Nationality'),requiredString(input.countryCode,'Country code',3).toUpperCase(),input.externalNumber||null,input.coach||'',now);
      if(input.categoryId){const registrationId=randomUUID();this.db.prepare('INSERT INTO athlete_registrations(id,tournament_id,athlete_id,category_id,status,created_at) VALUES(?,?,?,?,?,?)').run(registrationId,tournamentId,id,input.categoryId,'CONFIRMED',now);if(input.weightKg!=null)this.db.prepare('INSERT INTO weigh_ins(id,registration_id,weight_kg,passed,recorded_at,recorded_by) VALUES(?,?,?,?,?,?)').run(randomUUID(),registrationId,input.weightKg,1,now,actor.id);if(input.seed)this.db.prepare('INSERT INTO tournament_seeds(id,category_id,athlete_id,seed_position) VALUES(?,?,?,?)').run(randomUUID(),input.categoryId,id,input.seed);}
      audit(this.db,{tournamentId,actorId:actor.id,action:'ATHLETE_REGISTERED',entityType:'athlete',entityId:id,after:input});
    })();return{id};
  }

  generateDraw(actor: Actor, categoryId: string, method: 'RANDOM'|'SEEDED'): {drawId:string;bracket:Bracket;tournamentId:string} {
    const category=this.db.prepare('SELECT * FROM categories WHERE id=?').get(categoryId) as {id:string;tournament_id:string;name:string;rounds:number;round_duration_ms:number;repechage_policy:string|null;format:string}|undefined;
    if(!category)throw new HttpError(404,'NOT_FOUND','Category not found.');this.authorizeTournament(actor,category.tournament_id,true);
    if(actor.role==='REGISTRATION_MANAGER')throw new HttpError(403,'PERMISSION_DENIED','Only tournament administrators can generate draws.');
    const existing=this.db.prepare('SELECT id,status FROM draws WHERE category_id=? ORDER BY created_at DESC LIMIT 1').get(categoryId) as {id:string;status:string}|undefined;
    if(existing)throw new HttpError(409,existing.status==='PUBLISHED'?'PUBLISHED_DRAW_IMMUTABLE':'DRAW_EXISTS',existing.status==='PUBLISHED'?'A published draw requires an authorized correction workflow.':'A draft draw already exists for this category.');
    if(category.format==='REPECHAGE'&&!category.repechage_policy)throw new HttpError(409,'REPECHAGE_NOT_CONFIGURED','Select and authorize a repechage policy before generating this draw.');
    const entrants=this.db.prepare(`SELECT a.id,a.first_name||' '||a.last_name AS name,s.seed_position AS seed FROM athlete_registrations r JOIN athletes a ON a.id=r.athlete_id JOIN weigh_ins w ON w.registration_id=r.id AND w.passed=1 LEFT JOIN tournament_seeds s ON s.category_id=r.category_id AND s.athlete_id=a.id WHERE r.category_id=? AND r.status='CONFIRMED' AND a.eligibility_status='ELIGIBLE' ORDER BY a.last_name`).all(categoryId) as Array<{id:string;name:string;seed:number|null}>;
    if(entrants.length<2)throw new HttpError(409,'INSUFFICIENT_ENTRANTS','At least two eligible athletes with passing weigh-ins are required.');
    const bracket=generateBracket(entrants,{categoryId,method,bracketId:randomUUID()});const drawId=bracket.id;const now=isoNow();
    this.db.transaction(()=>{
      this.db.prepare('INSERT INTO draws(id,category_id,method,seed,ruleset_version,status,created_at,created_by) VALUES(?,?,?,?,?,\'DRAFT\',?,?)').run(drawId,categoryId,method,bracket.seed,EXAMPLE_WT_STYLE_RULESET.version,now,actor.id);
      this.db.prepare('INSERT INTO brackets(id,draw_id,category_id,size,graph_json,created_at) VALUES(?,?,?,?,?,?)').run(bracket.id,drawId,categoryId,bracket.size,JSON.stringify(bracket),now);
      const insertNode=this.db.prepare('INSERT INTO bracket_nodes(id,bracket_id,round,position,round_name,source_json,destination_id,destination_side,blue_athlete_id,red_athlete_id,winner_athlete_id,status,is_bye) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
      let matchNumber=((this.db.prepare('SELECT COUNT(*) AS count FROM matches WHERE tournament_id=?').get(category.tournament_id) as {count:number}).count)+1;
      for(const node of bracket.nodes){insertNode.run(node.id,bracket.id,node.round,node.position,node.roundName,JSON.stringify(node.sourceNodeIds),node.destinationNodeId,node.destinationSide,node.blueEntrantId,node.redEntrantId,node.winnerEntrantId,node.status,node.isBye?1:0);if(node.isBye)continue;const matchId=randomUUID();const timer={remainingMs:category.round_duration_ms,running:false,authoritativeAt:Date.now(),kind:'ROUND'};this.db.prepare(`INSERT INTO matches(id,tournament_id,category_id,bracket_node_id,match_number,phase,blue_athlete_id,red_athlete_id,state,timer_json,created_at,updated_at) VALUES(?,?,?,?,?,'MAIN',?,?,?,?,?,?)`).run(matchId,category.tournament_id,categoryId,node.id,String(matchNumber++),node.blueEntrantId,node.redEntrantId,node.status,JSON.stringify(timer),now,now);for(let round=1;round<=category.rounds;round++)this.db.prepare('INSERT INTO match_rounds(id,match_id,number) VALUES(?,?,?)').run(randomUUID(),matchId,round);}
      audit(this.db,{tournamentId:category.tournament_id,actorId:actor.id,action:'DRAW_GENERATED',entityType:'draw',entityId:drawId,after:{method,seed:bracket.seed,entrantIds:bracket.orderedEntrantIds,placementPolicy:bracket.placementPolicy}});
    })();return{drawId,bracket,tournamentId:category.tournament_id};
  }

  publishDraw(actor: Actor, drawId: string): void {
    const draw=this.db.prepare('SELECT d.*,c.tournament_id FROM draws d JOIN categories c ON c.id=d.category_id WHERE d.id=?').get(drawId) as {id:string;status:string;tournament_id:string;category_id:string}|undefined;
    if(!draw)throw new HttpError(404,'NOT_FOUND','Draw not found.');this.authorizeTournament(actor,draw.tournament_id,true);if(actor.role==='REGISTRATION_MANAGER')throw new HttpError(403,'PERMISSION_DENIED','Draw publication requires tournament administrator.');if(draw.status!=='DRAFT')throw new HttpError(409,'DRAW_ALREADY_PUBLISHED','This draw has already been published.');
    const record=this.db.prepare('SELECT graph_json FROM brackets WHERE draw_id=?').get(drawId) as {graph_json:string};const bracket=JSON.parse(record.graph_json) as Bracket;validateBracket(bracket);
    this.db.transaction(()=>{this.db.prepare('UPDATE draws SET status=\'PUBLISHED\',published_version=1 WHERE id=?').run(drawId);this.db.prepare('INSERT INTO draw_versions(id,draw_id,version,snapshot_json,published_at,published_by) VALUES(?,?,?,?,?,?)').run(randomUUID(),drawId,1,record.graph_json,isoNow(),actor.id);this.db.prepare('UPDATE categories SET status=\'DRAW_READY\' WHERE id=?').run(draw.category_id);this.db.prepare('UPDATE tournaments SET status=CASE WHEN status IN (\'REGISTRATION_CLOSED\',\'REGISTRATION_OPEN\') THEN \'DRAW_READY\' ELSE status END,updated_at=? WHERE id=?').run(isoNow(),draw.tournament_id);audit(this.db,{tournamentId:draw.tournament_id,actorId:actor.id,action:'DRAW_PUBLISHED',entityType:'draw',entityId:drawId,after:{version:1,hash:hashToken(record.graph_json)}});})();
  }

  getBracket(categoryId: string): Record<string,unknown> {
    const row=this.db.prepare(`SELECT d.id AS draw_id,d.method,d.seed,d.status,d.published_version,d.created_at,b.graph_json,c.name AS category_name,c.tournament_id FROM draws d JOIN brackets b ON b.draw_id=d.id JOIN categories c ON c.id=d.category_id WHERE d.category_id=? ORDER BY d.created_at DESC LIMIT 1`).get(categoryId) as {draw_id:string;method:string;seed:string;status:string;published_version:number|null;created_at:string;graph_json:string;category_name:string;tournament_id:string}|undefined;
    if(!row)throw new HttpError(404,'DRAW_NOT_FOUND','No draw has been generated for this category.');
    const athletes=this.db.prepare('SELECT id,first_name,last_name,country_code FROM athletes WHERE tournament_id=?').all(row.tournament_id) as Array<{id:string;first_name:string;last_name:string;country_code:string}>;
    return{draw:{id:row.draw_id,method:row.method,seed:row.seed,status:row.status,publishedVersion:row.published_version,createdAt:row.created_at},categoryName:row.category_name,tournamentId:row.tournament_id,bracket:JSON.parse(row.graph_json) as Bracket,athletes:athletes.map(a=>({id:a.id,name:`${a.first_name} ${a.last_name}`,countryCode:a.country_code}))};
  }

  assignMatch(actor: Actor, matchId: string, matId: string): void {
    const match=this.db.prepare('SELECT * FROM matches WHERE id=?').get(matchId) as {id:string;tournament_id:string;state:string;blue_athlete_id:string|null;red_athlete_id:string|null}|undefined;if(!match)throw new HttpError(404,'NOT_FOUND','Match not found.');this.authorizeTournament(actor,match.tournament_id,true);if(!['SUPER_ADMIN','TOURNAMENT_ADMIN','MAT_OPERATOR'].includes(actor.role))throw new HttpError(403,'PERMISSION_DENIED','Mat assignment permission required.');if(['COMPLETED','CANCELLED'].includes(match.state))throw new HttpError(409,'MATCH_RESOLVED','A resolved match cannot be reassigned.');if(!match.blue_athlete_id||!match.red_athlete_id)throw new HttpError(409,'ENTRANTS_UNKNOWN','Both athletes must be known before mat assignment.');
    const mat=this.db.prepare('SELECT id FROM mats WHERE id=? AND tournament_id=?').get(matId,match.tournament_id);if(!mat)throw new HttpError(400,'INVALID_MAT','Mat must belong to the same tournament.');
    const occupied=this.db.prepare('SELECT match_id FROM match_assignments WHERE mat_id=? AND unassigned_at IS NULL AND match_id<>?').get(matId,matchId) as {match_id:string}|undefined;if(occupied)throw new HttpError(409,'MAT_OCCUPIED','The selected mat already has an active match assignment.');
    const conflict=this.db.prepare(`SELECT m.id FROM matches m WHERE m.id<>? AND m.state IN ('CALLED','IN_PROGRESS','PAUSED','ROUND_BREAK','GOLDEN_POINT','UNDER_REVIEW') AND (m.blue_athlete_id IN (?,?) OR m.red_athlete_id IN (?,?))`).get(matchId,match.blue_athlete_id,match.red_athlete_id,match.blue_athlete_id,match.red_athlete_id);if(conflict)throw new HttpError(409,'ATHLETE_CONFLICT','An athlete is already assigned to a simultaneous live match.');
    this.db.transaction(()=>{const now=isoNow();this.db.prepare('UPDATE match_assignments SET unassigned_at=? WHERE match_id=? AND unassigned_at IS NULL').run(now,matchId);this.db.prepare('UPDATE match_assignments SET unassigned_at=? WHERE mat_id=? AND unassigned_at IS NULL').run(now,matId);this.db.prepare('INSERT INTO match_assignments(id,match_id,mat_id,assigned_at) VALUES(?,?,?,?)').run(randomUUID(),matchId,matId,now);this.db.prepare('UPDATE matches SET mat_id=?,state=CASE WHEN state=\'PENDING\' THEN \'READY\' ELSE state END,version=version+1,updated_at=? WHERE id=?').run(matId,now,matchId);this.db.prepare('UPDATE mats SET status=\'OCCUPIED\' WHERE id=?').run(matId);audit(this.db,{tournamentId:match.tournament_id,actorId:actor.id,action:'MATCH_ASSIGNED',entityType:'match',entityId:matchId,after:{matId}});})();
  }

  /** Internal authorized completion/recovery path. Must run inside the caller's transaction. */
  releaseMatAndAssignNext(tournamentId: string, completedMatchId: string, actorId: string | null): {matId:string;nextMatchId:string|null}|null {
    const assignment=this.db.prepare('SELECT mat_id FROM match_assignments WHERE match_id=? AND unassigned_at IS NULL').get(completedMatchId) as {mat_id:string}|undefined;
    if(!assignment)return null;
    const matId=assignment.mat_id;const now=isoNow();
    this.db.prepare('UPDATE match_assignments SET unassigned_at=? WHERE match_id=? AND unassigned_at IS NULL').run(now,completedMatchId);
    const next=this.db.prepare(`SELECT m.id FROM matches m
      WHERE m.tournament_id=? AND m.id<>? AND m.state IN ('PENDING','READY')
        AND m.blue_athlete_id IS NOT NULL AND m.red_athlete_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM match_assignments ma WHERE ma.match_id=m.id AND ma.unassigned_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM matches live WHERE live.tournament_id=m.tournament_id AND live.id<>m.id
          AND live.state IN ('CALLED','IN_PROGRESS','PAUSED','ROUND_BREAK','GOLDEN_POINT','UNDER_REVIEW')
          AND (live.blue_athlete_id IN (m.blue_athlete_id,m.red_athlete_id) OR live.red_athlete_id IN (m.blue_athlete_id,m.red_athlete_id)))
      ORDER BY COALESCE(m.queue_position,999999),CAST(m.match_number AS INTEGER),m.match_number,m.id LIMIT 1`).get(tournamentId,completedMatchId) as {id:string}|undefined;
    if(next){
      const updated=this.db.prepare(`UPDATE matches SET mat_id=?,state=CASE WHEN state='PENDING' THEN 'READY' ELSE state END,version=version+1,updated_at=? WHERE id=? AND state IN ('PENDING','READY')`).run(matId,now,next.id);
      if(updated.changes!==1)throw new HttpError(409,'MAT_QUEUE_CONFLICT','The next queued match changed before automatic assignment. No partial assignment was made.');
      this.db.prepare('INSERT INTO match_assignments(id,match_id,mat_id,assigned_at) VALUES(?,?,?,?)').run(randomUUID(),next.id,matId,now);
    }
    this.db.prepare('UPDATE mats SET status=? WHERE id=?').run(next?'OCCUPIED':'AVAILABLE',matId);
    audit(this.db,{tournamentId,actorId,action:'MAT_RELEASED',entityType:'mat',entityId:matId,before:{matchId:completedMatchId},after:{nextMatchId:next?.id??null,status:next?'OCCUPIED':'AVAILABLE'},reason:'Match resolved; mat released for queue advancement.'});
    if(next)audit(this.db,{tournamentId,actorId,action:'MATCH_ASSIGNED',entityType:'match',entityId:next.id,after:{matId,automatic:true,previousMatchId:completedMatchId},reason:'Previous match completed; next eligible queued match assigned without starting its timer.'});
    return{matId,nextMatchId:next?.id??null};
  }

  recoverResolvedMatAssignments(): Array<{matchId:string;matId:string;nextMatchId:string|null}> {
    const rows=this.db.prepare(`SELECT ma.match_id,m.tournament_id FROM match_assignments ma JOIN matches m ON m.id=ma.match_id
      WHERE ma.unassigned_at IS NULL AND m.state IN ('COMPLETED','WALKOVER','WITHDRAWN','DISQUALIFIED','CANCELLED') ORDER BY ma.assigned_at,ma.match_id`).all() as Array<{match_id:string;tournament_id:string}>;
    const recovered:Array<{matchId:string;matId:string;nextMatchId:string|null}>=[];
    for(const row of rows){const result=this.db.transaction(()=>this.releaseMatAndAssignNext(row.tournament_id,row.match_id,null))();if(result)recovered.push({matchId:row.match_id,...result});}
    return recovered;
  }

  dashboard(actor: Actor): Record<string,unknown> {
    const tournaments=this.listTournaments(actor);const ids=tournaments.map(t=>t.id);if(ids.length===0)return{tournaments:[],activeTournament:null,stats:{},liveMatches:[],recentResults:[],schedule:[],medals:[]};const placeholders=ids.map(()=>'?').join(',');
    const scalar=(sql:string):number=>(this.db.prepare(sql).get(...ids) as {value:number}).value;
    const stats={activeTournaments:scalar(`SELECT COUNT(*) AS value FROM tournaments WHERE id IN (${placeholders}) AND status='IN_PROGRESS'`),athletes:scalar(`SELECT COUNT(*) AS value FROM athletes WHERE tournament_id IN (${placeholders})`),clubs:scalar(`SELECT COUNT(*) AS value FROM clubs WHERE tournament_id IN (${placeholders})`),categories:scalar(`SELECT COUNT(*) AS value FROM categories WHERE tournament_id IN (${placeholders})`),completedMatches:scalar(`SELECT COUNT(*) AS value FROM matches WHERE tournament_id IN (${placeholders}) AND state IN ('COMPLETED','WALKOVER','DISQUALIFIED')`),liveMatches:scalar(`SELECT COUNT(*) AS value FROM matches WHERE tournament_id IN (${placeholders}) AND state IN ('IN_PROGRESS','PAUSED','ROUND_BREAK','GOLDEN_POINT','UNDER_REVIEW')`),waitingMatches:scalar(`SELECT COUNT(*) AS value FROM matches WHERE tournament_id IN (${placeholders}) AND state IN ('READY','CALLED','PENDING')`),connectedJudges:scalar(`SELECT COUNT(*) AS value FROM device_presence WHERE match_id IN (SELECT id FROM matches WHERE tournament_id IN (${placeholders})) AND status='ONLINE' AND last_seen_at>${Date.now()-15000}`)};
    const activeTournament=tournaments.find(t=>t.status==='IN_PROGRESS')??tournaments[0];
    const liveRows=this.db.prepare(`SELECT id FROM matches WHERE tournament_id IN (${placeholders}) AND state IN ('IN_PROGRESS','PAUSED','ROUND_BREAK','GOLDEN_POINT','UNDER_REVIEW') ORDER BY updated_at DESC LIMIT 6`).all(...ids) as Array<{id:string}>;
    const schedule=this.db.prepare(`SELECT m.id,m.match_number,m.state,m.scheduled_at,m.queue_position,c.name AS category_name,ba.first_name||' '||ba.last_name AS blue_name,ra.first_name||' '||ra.last_name AS red_name,mat.name AS mat_name FROM matches m JOIN categories c ON c.id=m.category_id LEFT JOIN athletes ba ON ba.id=m.blue_athlete_id LEFT JOIN athletes ra ON ra.id=m.red_athlete_id LEFT JOIN mats mat ON mat.id=m.mat_id WHERE m.tournament_id IN (${placeholders}) AND m.state IN ('READY','CALLED','PENDING') AND m.blue_athlete_id IS NOT NULL AND m.red_athlete_id IS NOT NULL ORDER BY COALESCE(m.queue_position,999),m.match_number LIMIT 12`).all(...ids);
    const recentResults=this.db.prepare(`SELECT r.*,m.match_number,c.name AS category_name,w.first_name||' '||w.last_name AS winner_name,l.first_name||' '||l.last_name AS loser_name FROM tournament_results r JOIN matches m ON m.id=r.match_id JOIN categories c ON c.id=m.category_id LEFT JOIN athletes w ON w.id=r.winner_athlete_id LEFT JOIN athletes l ON l.id=r.loser_athlete_id WHERE r.tournament_id IN (${placeholders}) ORDER BY r.completed_at DESC LIMIT 8`).all(...ids);
    const medals=this.db.prepare(`SELECT cl.name AS club_name,cl.country_code,SUM(CASE WHEN ms.place=1 THEN 1 ELSE 0 END) AS gold,SUM(CASE WHEN ms.place=2 THEN 1 ELSE 0 END) AS silver,SUM(CASE WHEN ms.place=3 THEN 1 ELSE 0 END) AS bronze FROM medal_standings ms JOIN clubs cl ON cl.id=ms.club_id WHERE ms.tournament_id IN (${placeholders}) GROUP BY cl.id ORDER BY gold DESC,silver DESC,bronze DESC LIMIT 6`).all(...ids);
    return{tournaments,activeTournament,stats,liveMatchIds:liveRows.map(row=>row.id),schedule,recentResults,medals};
  }

  advanceFromCompletedMatch(actor: Actor, matchId: string, winnerId: string): void {
    const row=this.db.prepare(`SELECT m.bracket_node_id,b.graph_json,m.tournament_id FROM matches m JOIN bracket_nodes bn ON bn.id=m.bracket_node_id JOIN brackets b ON b.id=bn.bracket_id WHERE m.id=?`).get(matchId) as {bracket_node_id:string;graph_json:string;tournament_id:string}|undefined;if(!row)return;
    const bracket=JSON.parse(row.graph_json) as Bracket;const destination=advanceWinner(bracket,row.bracket_node_id,winnerId);this.db.prepare('UPDATE brackets SET graph_json=? WHERE id=?').run(JSON.stringify(bracket),bracket.id);this.db.prepare('UPDATE bracket_nodes SET status=\'COMPLETED\',winner_athlete_id=? WHERE id=?').run(winnerId,row.bracket_node_id);
    if(destination){const side=bracket.nodes.find(n=>n.id===row.bracket_node_id)?.destinationSide;const next=this.db.prepare('SELECT id FROM matches WHERE bracket_node_id=?').get(destination.id) as {id:string}|undefined;if(next){this.db.prepare(`UPDATE matches SET ${side==='BLUE'?'blue_athlete_id':'red_athlete_id'}=?,state=?,version=version+1,updated_at=? WHERE id=?`).run(winnerId,destination.status,isoNow(),next.id);}this.db.prepare('UPDATE bracket_nodes SET blue_athlete_id=?,red_athlete_id=?,status=? WHERE id=?').run(destination.blueEntrantId,destination.redEntrantId,destination.status,destination.id);}
    audit(this.db,{tournamentId:row.tournament_id,actorId:actor.id,action:'ATHLETE_ADVANCED',entityType:'match',entityId:matchId,after:{winnerId,destinationNodeId:destination?.id??null}});
  }
}
