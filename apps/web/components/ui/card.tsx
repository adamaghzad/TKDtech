import {cn} from '@/lib/utils';
export function Card({className,...props}:React.HTMLAttributes<HTMLDivElement>){return<div className={cn('panel',className)}{...props}/>;}
export function CardHeader({className,...props}:React.HTMLAttributes<HTMLDivElement>){return<div className={cn('flex items-start justify-between gap-4 border-b border-line/60 px-5 py-4',className)}{...props}/>;}
export function CardTitle({className,...props}:React.HTMLAttributes<HTMLHeadingElement>){return<h2 className={cn('text-sm font-semibold tracking-wide text-white',className)}{...props}/>;}
export function CardContent({className,...props}:React.HTMLAttributes<HTMLDivElement>){return<div className={cn('p-5',className)}{...props}/>;}
