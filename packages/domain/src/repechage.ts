import { advanceWinner, generateBracket, type Bracket, type BracketNode } from './bracket';

export interface RepechageConfig {
  qualification: 'LOST_TO_FINALIST';
  pairing: 'SEPARATE_FINALIST_PATHS';
  bronzePolicy: 'SEMIFINAL_LOSER_VS_PATH_WINNER';
  medalsPerFinalistPath: 1;
}
export const DEFAULT_REPECHAGE_CONFIG: RepechageConfig = {
  qualification: 'LOST_TO_FINALIST', pairing: 'SEPARATE_FINALIST_PATHS',
  bronzePolicy: 'SEMIFINAL_LOSER_VS_PATH_WINNER', medalsPerFinalistPath: 1
};
export interface RepechageGroup {
  finalistId: string;
  qualifierIds: string[];
  semifinalLoserId: string;
  pathBracket: Bracket | null;
  directPathWinnerId: string | null;
  bronzeNode: BracketNode;
}
export interface RepechagePlan { config: RepechageConfig; groups: RepechageGroup[]; warnings: string[] }

function pathForFinalist(bracket: Bracket, finalistId: string): BracketNode[] {
  const final = bracket.nodes.find(node => node.destinationNodeId === null);
  if (!final) throw new Error('Main bracket final is missing.');
  const path: BracketNode[] = [];
  let current: BracketNode | undefined = final;
  while (current) {
    if (![current.blueEntrantId, current.redEntrantId].includes(finalistId)) throw new Error('Finalist path could not be reconstructed.');
    if (current.winnerEntrantId && current.winnerEntrantId !== finalistId && current.destinationNodeId !== null) throw new Error('Finalist did not win a required path match.');
    path.push(current);
    let next: BracketNode | undefined;
    for (const id of current.sourceNodeIds) {
      const source = bracket.nodes.find(node => node.id === id);
      if (source && [source.blueEntrantId, source.redEntrantId].includes(finalistId)) { next = source; break; }
    }
    current = next;
  }
  return path.sort((a, b) => a.round - b.round);
}

/** Dedicated configurable strategy; this example is not represented as an official WT format. */
export function buildRepechagePlan(main: Bracket, config: RepechageConfig = DEFAULT_REPECHAGE_CONFIG): RepechagePlan {
  const final = main.nodes.find(node => node.destinationNodeId === null);
  if (!final?.blueEntrantId || !final.redEntrantId) throw new Error('Both finalists must be known before repechage generation.');
  const warnings = ['Verify this configurable repechage policy against the regulations adopted by the tournament.'];
  const groups = [final.blueEntrantId, final.redEntrantId].map((finalistId, groupIndex): RepechageGroup => {
    const path = pathForFinalist(main, finalistId);
    const opponents = path.flatMap(node => {
      if (node.isBye || !node.winnerEntrantId) return [];
      const opponent = node.blueEntrantId === finalistId ? node.redEntrantId : node.blueEntrantId;
      return opponent ? [{ id: opponent, round: node.round }] : [];
    });
    const semifinal = opponents.filter(item => item.round === final.round - 1).at(-1);
    if (!semifinal) throw new Error('A semi-final loser is required for this bronze policy.');
    const earlier = opponents.filter(item => item.round < final.round - 1).map(item => item.id);
    if (new Set(earlier).size !== earlier.length) throw new Error('Duplicate repechage qualifier detected.');
    let pathBracket: Bracket | null = null;
    let directPathWinnerId: string | null = null;
    if (earlier.length === 1) directPathWinnerId = earlier[0]!;
    if (earlier.length >= 2) pathBracket = generateBracket(earlier.map(id => ({ id })), { categoryId: main.categoryId, method: 'SEEDED', seed: `${main.seed}-rep-${groupIndex}`, bracketId: `${main.id}-rep-${groupIndex + 1}` });
    const pathWinner = directPathWinnerId;
    const bronzeNode: BracketNode = {
      id: `${main.id}-bronze-${groupIndex + 1}`, label: `Bronze match ${groupIndex + 1}`,
      matchNumber: `B${groupIndex + 1}`, round: final.round + 1, position: groupIndex,
      roundName: 'Bronze match', blueEntrantId: semifinal.id, redEntrantId: pathWinner,
      sourceNodeIds: pathBracket ? [pathBracket.nodes.find(node => node.destinationNodeId === null)!.id] : [],
      destinationNodeId: null, destinationSide: null,
      status: earlier.length === 0 ? 'BYE' : pathWinner ? 'READY' : 'PENDING',
      winnerEntrantId: earlier.length === 0 ? semifinal.id : null, isBye: earlier.length === 0
    };
    return { finalistId, qualifierIds: [semifinal.id, ...earlier], semifinalLoserId: semifinal.id, pathBracket, directPathWinnerId, bronzeNode };
  });
  return { config, groups, warnings };
}

export function advanceRepechageWinner(plan: RepechagePlan, groupIndex: number, nodeId: string, winnerId: string): void {
  const group = plan.groups[groupIndex];
  if (!group) throw new Error('Repechage group not found.');
  if (nodeId === group.bronzeNode.id) {
    if (group.bronzeNode.status !== 'READY') throw new Error('Bronze match is not ready.');
    if (![group.bronzeNode.blueEntrantId, group.bronzeNode.redEntrantId].includes(winnerId)) throw new Error('Winner is not a bronze-match entrant.');
    group.bronzeNode.status = 'COMPLETED'; group.bronzeNode.winnerEntrantId = winnerId; return;
  }
  if (!group.pathBracket) throw new Error('This group has no repechage path bracket.');
  advanceWinner(group.pathBracket, nodeId, winnerId);
  const pathFinal = group.pathBracket.nodes.find(node => node.destinationNodeId === null)!;
  if (pathFinal.id === nodeId) {
    group.bronzeNode.redEntrantId = winnerId;
    if (group.bronzeNode.blueEntrantId) group.bronzeNode.status = 'READY';
  }
}


export function calculatePlacements(main: Bracket, repechage: RepechagePlan): Array<{ athleteId: string; place: 1 | 2 | 3 }> {
  const final = main.nodes.find(node => node.destinationNodeId === null);
  if (!final?.winnerEntrantId || !final.blueEntrantId || !final.redEntrantId) throw new Error('Final must be completed before placements are awarded.');
  const silver = final.blueEntrantId === final.winnerEntrantId ? final.redEntrantId : final.blueEntrantId;
  const bronze = repechage.groups.map(group => {
    if (!group.bronzeNode.winnerEntrantId) throw new Error('All bronze matches must be completed before medal allocation.');
    return group.bronzeNode.winnerEntrantId;
  });
  return [{ athleteId: final.winnerEntrantId, place: 1 }, { athleteId: silver, place: 2 }, ...bronze.map(athleteId => ({ athleteId, place: 3 as const }))];
}
