import{describe,expect,it}from'vitest';import{advanceRepechageWinner,advanceWinner,buildRepechagePlan,calculatePlacements,generateBracket,type Bracket}from'@tkd/domain';
function completedMain(count:number):Bracket{const entrants=Array.from({length:count},(_,index)=>({id:`a${index+1}`,seed:index+1}));const bracket=generateBracket(entrants,{categoryId:'cat',method:'SEEDED',seed:`rep-${count}`});for(const node of bracket.nodes.filter(node=>!node.isBye)){if(node.status==='READY')advanceWinner(bracket,node.id,node.blueEntrantId!);}return bracket;}
describe('configurable finalist-path repechage',()=>{
  it.each([4,8,16,32])('derives eligible qualifiers and bronze paths for %i athletes',count=>{
    const main=completedMain(count);const final=main.nodes.find(node=>node.destinationNodeId===null)!;const plan=buildRepechagePlan(main);expect(plan.groups).toHaveLength(2);expect(plan.warnings[0]).toMatch(/Verify/);
    for(const group of plan.groups){expect(group.qualifierIds).toHaveLength(Math.log2(count)-1);expect(new Set(group.qualifierIds).size).toBe(group.qualifierIds.length);expect(group.qualifierIds).not.toContain(group.finalistId);}
    if(count===4){expect(plan.groups.every(group=>group.bronzeNode.status==='BYE'&&group.bronzeNode.winnerEntrantId===group.semifinalLoserId)).toBe(true);}else{expect(plan.groups.every(group=>group.bronzeNode.winnerEntrantId===null)).toBe(true);}
    expect(final.blueEntrantId).toBeTruthy();
  });
  it('advances repechage winners into bronze matches and allocates only resolved medals',()=>{const main=completedMain(16);const plan=buildRepechagePlan(main);for(let index=0;index<2;index++){const group=plan.groups[index]!;const pathFinal=group.pathBracket!.nodes.find(node=>node.destinationNodeId===null)!;advanceRepechageWinner(plan,index,pathFinal.id,pathFinal.blueEntrantId!);expect(group.bronzeNode.status).toBe('READY');advanceRepechageWinner(plan,index,group.bronzeNode.id,group.bronzeNode.blueEntrantId!);}const placements=calculatePlacements(main,plan);expect(placements).toHaveLength(4);expect(placements.filter(item=>item.place===3)).toHaveLength(2);expect(new Set(placements.map(item=>item.athleteId)).size).toBe(4);});
  it('refuses medal allocation with an unresolved bronze path',()=>{const main=completedMain(8);const plan=buildRepechagePlan(main);expect(()=>calculatePlacements(main,plan)).toThrow(/bronze matches/);});
});
