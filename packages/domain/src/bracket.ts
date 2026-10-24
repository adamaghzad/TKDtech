import { createSeed, fisherYates, seededRandom } from './random';

export interface BracketEntrant { id: string; name?: string; seed?: number | null }
export type BracketNodeStatus = 'PENDING' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'BYE' | 'CANCELLED';
export interface BracketNode {
  id: string;
  label: string;
  matchNumber: string;
  round: number;
  position: number;
  roundName: string;
  blueEntrantId: string | null;
  redEntrantId: string | null;
  sourceNodeIds: string[];
  destinationNodeId: string | null;
  destinationSide: 'BLUE' | 'RED' | null;
  status: BracketNodeStatus;
  winnerEntrantId: string | null;
  isBye: boolean;
}
export interface Bracket {
  id: string;
  categoryId: string;
  size: number;
  method: 'RANDOM' | 'SEEDED';
  seed: string;
  orderedEntrantIds: string[];
  placementPolicy: 'STANDARD_SEED_SEPARATION';
  nodes: BracketNode[];
  createdAt: string;
}
export interface DrawOptions {
  categoryId: string;
  method: 'RANDOM' | 'SEEDED';
  seed?: string;
  bracketId?: string;
  now?: string;
}

export function nextPowerOfTwo(value: number): number {
  if (!Number.isInteger(value) || value < 2) throw new Error('At least two eligible entrants are required.');
  return 2 ** Math.ceil(Math.log2(value));
}

/** Seed number → slot policy: 1/4/2/3 for four, 1/8/4/5/2/7/3/6 for eight. */
export function standardSeedOrder(size: number): number[] {
  if (size < 2 || (size & (size - 1)) !== 0) throw new Error('Bracket size must be a power of two.');
  let order = [1, 2];
  while (order.length < size) {
    const complement = order.length * 2 + 1;
    order = order.flatMap(seed => [seed, complement - seed]);
  }
  return order;
}

export function roundName(matchCount: number, repechage = false): string {
  const prefix = repechage ? 'Repechage ' : '';
  if (matchCount === 1) return `${prefix}Final`;
  if (matchCount === 2) return `${prefix}Semi-finals`;
  if (matchCount === 4) return `${prefix}Quarter-finals`;
  return `${prefix}Round of ${matchCount * 2}`;
}

export function generateBracket(entrantsInput: readonly BracketEntrant[], options: DrawOptions): Bracket {
  if (entrantsInput.length < 2) throw new Error('A draw requires at least two eligible athletes.');
  const ids = entrantsInput.map(entrant => entrant.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate athletes are not allowed in a draw.');
  if (ids.some(id => !id)) throw new Error('Every entrant must have an ID.');
  const size = nextPowerOfTwo(entrantsInput.length);
  const seed = options.seed ?? createSeed();
  const random = seededRandom(seed);
  const seedOrder = standardSeedOrder(size);
  const slots: Array<string | null> = Array<string | null>(size).fill(null);

  if (options.method === 'RANDOM') {
    const shuffled = fisherYates(entrantsInput, random);
    shuffled.forEach((entrant, index) => { slots[seedOrder.indexOf(index + 1)] = entrant.id; });
  } else {
    const seeds = entrantsInput.filter(entrant => entrant.seed != null);
    const seedValues = seeds.map(entrant => entrant.seed!);
    if (new Set(seedValues).size !== seedValues.length || seedValues.some(value => !Number.isInteger(value) || value < 1 || value > entrantsInput.length)) {
      throw new Error('Seeds must be unique integer positions within the entrants list.');
    }
    seeds.forEach(entrant => { slots[seedOrder.indexOf(entrant.seed!)] = entrant.id; });
    const occupiedSeedNumbers = new Set(seedValues);
    const openSeedNumbers = Array.from({ length: entrantsInput.length }, (_, index) => index + 1).filter(value => !occupiedSeedNumbers.has(value));
    const unseeded = fisherYates(entrantsInput.filter(entrant => entrant.seed == null), random);
    unseeded.forEach((entrant, index) => {
      const seedNumber = openSeedNumbers[index];
      if (seedNumber == null) throw new Error('No eligible open seed position remains.');
      slots[seedOrder.indexOf(seedNumber)] = entrant.id;
    });
  }

  const bracketId = options.bracketId ?? `bracket-${seed.slice(0, 12)}`;
  const nodes: BracketNode[] = [];
  const rounds = Math.log2(size);
  let matchNumber = 1;
  for (let round = 1; round <= rounds; round++) {
    const count = size / (2 ** round);
    for (let position = 0; position < count; position++) {
      let blue: string | null = null;
      let red: string | null = null;
      let sourceNodeIds: string[] = [];
      if (round === 1) {
        blue = slots[position * 2] ?? null;
        red = slots[position * 2 + 1] ?? null;
      } else {
        const previous = nodes.filter(node => node.round === round - 1);
        const first = previous[position * 2];
        const second = previous[position * 2 + 1];
        if (!first || !second) throw new Error('Bracket graph generation failed.');
        sourceNodeIds = [first.id, second.id];
      }
      const isBye = round === 1 && Boolean(blue) !== Boolean(red);
      nodes.push({
        id: `${bracketId}-r${round}m${position + 1}`,
        label: `${roundName(count)} · ${position + 1}`,
        matchNumber: `M${matchNumber++}`, round, position, roundName: roundName(count),
        blueEntrantId: blue, redEntrantId: red, sourceNodeIds,
        destinationNodeId: null, destinationSide: null,
        status: blue && red ? 'READY' : isBye ? 'BYE' : 'PENDING',
        winnerEntrantId: null, isBye
      });
    }
  }

  const bracket: Bracket = {
    id: bracketId, categoryId: options.categoryId, size, method: options.method, seed,
    orderedEntrantIds: slots.filter((id): id is string => id !== null),
    placementPolicy: 'STANDARD_SEED_SEPARATION', nodes, createdAt: options.now ?? new Date().toISOString()
  };
  for (const node of nodes) {
    if (node.sourceNodeIds.length === 0) continue;
    const sources = node.sourceNodeIds.map(id => nodes.find(candidate => candidate.id === id)!);
    sources.forEach((source, index) => { source.destinationNodeId = node.id; source.destinationSide = index === 0 ? 'BLUE' : 'RED'; });
  }
  for (const node of nodes.filter(candidate => candidate.isBye)) {
    node.winnerEntrantId = node.blueEntrantId ?? node.redEntrantId;
    advanceWinner(bracket, node.id, node.winnerEntrantId!, true);
  }
  validateBracket(bracket);
  return bracket;
}

export function advanceWinner(bracket: Bracket, nodeId: string, winnerEntrantId: string, fromBye = false): BracketNode | null {
  const node = bracket.nodes.find(candidate => candidate.id === nodeId);
  if (!node) throw new Error('Match node not found.');
  if (![node.blueEntrantId, node.redEntrantId].includes(winnerEntrantId)) throw new Error('Winner must be an entrant in this match.');
  if (!fromBye && node.isBye) throw new Error('A bye cannot be recorded as a scored victory.');
  if (!fromBye && node.status !== 'READY' && node.status !== 'IN_PROGRESS') throw new Error('Match is not ready for progression; completed results require an authorized correction.');
  if (!fromBye) { node.status = 'COMPLETED'; node.winnerEntrantId = winnerEntrantId; }
  if (!node.destinationNodeId) return null;
  const destination = bracket.nodes.find(candidate => candidate.id === node.destinationNodeId);
  if (!destination) throw new Error('Destination match is missing.');
  if (destination.status === 'IN_PROGRESS' || destination.status === 'COMPLETED') throw new Error('Cannot change a participant after the destination match has started.');
  if (node.destinationSide === 'BLUE') destination.blueEntrantId = winnerEntrantId;
  else destination.redEntrantId = winnerEntrantId;
  if (destination.blueEntrantId && destination.redEntrantId && destination.status === 'PENDING') destination.status = 'READY';
  return destination;
}

export function validateBracket(bracket: Bracket): void {
  const nodeIds = new Set(bracket.nodes.map(node => node.id));
  if (nodeIds.size !== bracket.nodes.length) throw new Error('Bracket contains duplicate node IDs.');
  const firstRoundIds = bracket.nodes.filter(node => node.round === 1).flatMap(node => [node.blueEntrantId, node.redEntrantId]).filter((id): id is string => Boolean(id));
  if (new Set(firstRoundIds).size !== firstRoundIds.length) throw new Error('An athlete appears more than once in the first round.');
  if (firstRoundIds.length < 2) throw new Error('Bracket has insufficient entrants.');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Circular match dependency detected.');
    if (visited.has(id)) return;
    visiting.add(id);
    const node = bracket.nodes.find(candidate => candidate.id === id);
    if (!node) throw new Error('Bracket references an unknown match node.');
    if (node.destinationNodeId === id || node.sourceNodeIds.includes(id)) throw new Error('Self-referencing match node detected.');
    node.sourceNodeIds.forEach(visit);
    visiting.delete(id); visited.add(id);
  };
  bracket.nodes.forEach(node => {
    if (node.round === 1 && node.sourceNodeIds.length !== 0) throw new Error('First-round nodes cannot have match sources.');
    if (node.round > 1 && node.sourceNodeIds.length !== 2) throw new Error('Later-round nodes must have two sources.');
    node.sourceNodeIds.forEach(id => { if (!nodeIds.has(id)) throw new Error('Unknown source match.'); });
    visit(node.id);
  });
}
