import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]){return twMerge(clsx(inputs));}
export function flagEmoji(code?:string|null){if(!code||code.length!==3)return '🏳️';const map:Record<string,string>={MAR:'MA',FRA:'FR',KOR:'KR',ESP:'ES',USA:'US',FIN:'FI',NOR:'NO',ALG:'DZ',TUN:'TN',BRA:'BR',GBR:'GB',CAN:'CA',GER:'DE',ITA:'IT',JPN:'JP',SEN:'SN',CIV:'CI',EGY:'EG'};const two=map[code.toUpperCase()];if(!two)return '🏳️';return String.fromCodePoint(...[...two].map(char=>127397+char.charCodeAt(0)));}
export function formatTime(ms:number){const safe=Math.max(0,ms);if(safe<10000){const hundredths=Math.floor(safe/10);return `${Math.floor(hundredths/6000)}:${String(Math.floor((hundredths%6000)/100)).padStart(2,'0')}.${String(hundredths%100).padStart(2,'0')}`;}const total=Math.ceil(safe/1000);return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;}
export function formatDate(value?:string|null,locale='en'){if(!value)return '—';return new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeZone:'Africa/Casablanca'}).format(new Date(value.includes('T')?value:`${value}T12:00:00Z`));}
export function titleCase(value:string){return value.toLowerCase().replaceAll('_',' ').replace(/\b\w/g,char=>char.toUpperCase());}
