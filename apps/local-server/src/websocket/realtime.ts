import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import type { EventEnvelope, MatchSnapshot } from '@tkd/contracts';
import type { MatchService } from '../domain/match-service';

interface Client extends WebSocket { matchIds?:Set<string>;tournamentIds?:Set<string>;lastSequences?:Map<string,number>;deviceToken?:string;isAlive?:boolean }
export class RealtimeGateway {
  private readonly wss=new WebSocketServer({noServer:true});
  constructor(private readonly matches:MatchService){
    this.wss.on('connection',(socket:Client,request:IncomingMessage)=>this.onConnection(socket,request));
    const interval=setInterval(()=>{for(const client of this.wss.clients as Set<Client>){if(client.isAlive===false){client.terminate();continue;}client.isAlive=false;client.ping();}},30000);interval.unref();
  }
  upgrade(request:IncomingMessage,socket:Socket,head:Buffer){this.wss.handleUpgrade(request,socket,head,client=>this.wss.emit('connection',client,request));}
  private onConnection(client:Client,request:IncomingMessage){
    client.matchIds=new Set();client.tournamentIds=new Set();client.lastSequences=new Map();client.isAlive=true;
    const url=new URL(request.url??'/ws','http://local');const matchId=url.searchParams.get('matchId');const token=url.searchParams.get('token');
    if(matchId)client.matchIds.add(matchId);if(token){try{const session=this.matches.heartbeat(token);client.deviceToken=token;client.matchIds.add(session.match_id);this.broadcastMatch(session.match_id,'judge.connected');}catch{client.close(4401,'Invalid or expired session');return;}}
    client.on('pong',()=>{client.isAlive=true;});
    client.on('message',raw=>{try{const message=JSON.parse(String(raw)) as {type?:string;matchId?:string;token?:string};if(message.type==='subscribe'&&message.matchId){client.matchIds?.add(message.matchId);this.sendSnapshot(client,message.matchId);}if(message.type==='heartbeat'&&client.deviceToken){const session=this.matches.heartbeat(client.deviceToken);this.sendSnapshot(client,session.match_id);}if(message.type==='request_snapshot'){for(const id of client.matchIds??[])this.sendSnapshot(client,id);}}catch{client.send(JSON.stringify({type:'error',error:{code:'INVALID_MESSAGE',message:'Malformed realtime message.'}}));}});
    client.on('close',()=>{if(client.deviceToken){try{const session=this.matches.deviceSession(client.deviceToken);this.broadcastMatch(session.match_id,'judge.disconnected');}catch{/* revoked or expired */}}});
    for(const id of client.matchIds)this.sendSnapshot(client,id);
  }
  private sendSnapshot(client:Client,matchId:string){try{const snapshot=this.matches.snapshot(matchId);client.lastSequences?.set(matchId,snapshot.sequence);this.send(client,this.envelope(snapshot,'match.snapshot'));}catch{client.send(JSON.stringify({type:'error',error:{code:'SNAPSHOT_UNAVAILABLE',message:'Match snapshot unavailable.'}}));}}
  private envelope(snapshot:MatchSnapshot,type:EventEnvelope['type']):EventEnvelope<MatchSnapshot>{return{schemaVersion:1,eventId:crypto.randomUUID(),tournamentId:snapshot.tournamentId,matchId:snapshot.matchId,serverTimestamp:Date.now(),sequence:snapshot.sequence,actorId:null,type,payload:snapshot};}
  private send(client:Client,event:unknown){if(client.readyState===WebSocket.OPEN)client.send(JSON.stringify(event));}
  broadcastMatch(matchId:string,type:EventEnvelope['type']='match.snapshot'){const snapshot=this.matches.snapshot(matchId);const event=this.envelope(snapshot,type);for(const client of this.wss.clients as Set<Client>){if(!client.matchIds?.has(matchId))continue;const previous=client.lastSequences?.get(matchId);if(previous!=null&&snapshot.sequence>previous+1){this.send(client,{type:'sequence.gap',matchId,expected:previous+1,received:snapshot.sequence});}this.send(client,event);client.lastSequences?.set(matchId,snapshot.sequence);}}
  broadcastTournament(tournamentId:string,type:EventEnvelope['type'],payload:unknown){for(const client of this.wss.clients as Set<Client>){if(client.tournamentIds?.has(tournamentId))this.send(client,{schemaVersion:1,eventId:crypto.randomUUID(),tournamentId,matchId:null,serverTimestamp:Date.now(),sequence:0,actorId:null,type,payload});}}
  get connectedDevices():number{let count=0;for(const client of this.wss.clients as Set<Client>)if(client.deviceToken&&client.readyState===WebSocket.OPEN)count++;return count;}
  close(){for(const client of this.wss.clients as Set<Client>)client.terminate();}
}
