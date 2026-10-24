'use client';
import{useParams}from'next/navigation';import{TournamentWorkspace}from'@/features/tournaments/tournament-workspace';export default function TournamentPage(){const params=useParams<{id:string;section?:string[]}>();return<TournamentWorkspace tournamentId={params.id} section={params.section?.[0]??'overview'}/>;}
