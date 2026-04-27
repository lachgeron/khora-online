import type { PoliticsCard, PrivatePlayerState, PublicGameState } from '../types';
import type { DraftCardRecommendation, DraftPlan } from './types';

const BASE_CARD_VALUE: Record<string, number> = {
  'central-government': 92,
  diversification: 88,
  'gold-reserve': 84,
  'heavy-taxes': 82,
  austerity: 80,
  proskenion: 76,
  bank: 74,
  'hall-of-statues': 72,
  'corinthian-columns': 91,
  reformists: 88,
  gradualism: 85,
  oracle: 84,
  'founding-the-lyceum': 82,
  diolkos: 81,
  lighthouse: 80,
  'foreign-supplies': 78,
  persians: 78,
  stadion: 77,
  helepole: 76,
  'stoa-poikile': 75,
  'constructing-the-mint': 73,
  power: 72,
  'public-market': 72,
  'extraordinary-collection': 70,
  'colossus-of-rhodes': 83,
  'silver-mining': 79,
  'tunnel-of-eupalinos': 76,
  'greek-fire': 74,
  peripteros: 72,
  quarry: 70,
  archives: 69,
  council: 68,
  'gifts-from-the-west': 65,
  ostracism: 63,
  'scholarly-welcome': 62,
  contribution: 60,
  'mercenary-recruitment': 59,
  rivalry: 56,
};

const CITY_SYNERGY: Record<string, Record<string, number>> = {
  athens: {
    'central-government': 12,
    austerity: 10,
    council: 8,
    ostracism: 7,
    'extraordinary-collection': 7,
    'gifts-from-the-west': 4,
  },
  miletus: {
    'corinthian-columns': 12,
    lighthouse: 10,
    diolkos: 10,
    bank: 8,
    'gold-reserve': 8,
    'constructing-the-mint': 6,
  },
  sparta: {
    'greek-fire': 12,
    helepole: 11,
    'foreign-supplies': 10,
    persians: 8,
    stadion: 8,
    'mercenary-recruitment': 7,
  },
  thebes: {
    'greek-fire': 10,
    helepole: 9,
    'foreign-supplies': 9,
    stadion: 8,
    'heavy-taxes': 6,
    quarry: 5,
    'silver-mining': 5,
  },
  argos: {
    'greek-fire': 9,
    helepole: 9,
    'foreign-supplies': 8,
    proskenion: 8,
    'mercenary-recruitment': 6,
    stadion: 5,
  },
  corinth: {
    reformists: 12,
    gradualism: 11,
    'hall-of-statues': 10,
    'scholarly-welcome': 8,
    'founding-the-lyceum': 7,
    'constructing-the-mint': 6,
  },
  olympia: {
    'stoa-poikile': 12,
    persians: 10,
    peripteros: 8,
    'central-government': 6,
    'tunnel-of-eupalinos': 5,
  },
};

export function buildDraftPlan(
  publicState: PublicGameState,
  privateState: PrivatePlayerState,
  currentPlayerId: string,
): DraftPlan | null {
  if (publicState.currentPhase !== 'DRAFT_POLITICS') return null;

  const start = performance.now();
  const me = publicState.players.find(p => p.playerId === currentPlayerId);
  const cityId = me?.cityId ?? '';
  const fullMe = privateState.solverFullState?.players.find(p => p.playerId === currentPlayerId);

  if (publicState.pickBanDraft) {
    const draft = publicState.pickBanDraft;
    const occupied = new Set<string>();
    for (const cards of Object.values(draft.bannedCards)) {
      for (const card of cards) occupied.add(card.id);
    }
    for (const cards of Object.values(draft.pickedCards)) {
      for (const card of cards) occupied.add(card.id);
    }
    const candidates = draft.allCards.filter(card => !occupied.has(card.id));
    const action = draft.phase;
    const isMyTurn = draft.turnOrder[draft.currentTurnIndex] === currentPlayerId;
    const draftedCards = draft.pickedCards[currentPlayerId] ?? [];
    const opponentCityIds = publicState.players
      .filter(player => player.playerId !== currentPlayerId)
      .map(player => player.cityId)
      .filter(Boolean);
    const recommendations = rankDraftCards(
      candidates,
      draftedCards,
      cityId,
      action === 'BAN',
      fullMe?.citizenTrack ?? me?.citizenTrack ?? 1,
      opponentCityIds,
    );
    return {
      action,
      phaseLabel: `${action === 'BAN' ? 'Ban' : 'Pick'} phase`,
      isMyTurn,
      currentChoiceName: recommendations[0]?.cardName ?? null,
      draftedCards,
      recommendations,
      computeMs: Math.max(0, Math.round(performance.now() - start)),
    };
  }

  if (publicState.politicsDraft) {
    const candidates = privateState.draftPack ?? [];
    const draftedCards = privateState.draftedCards ?? [];
    const isMyTurn = publicState.politicsDraft.waitingFor.includes(currentPlayerId);
    const recommendations = rankDraftCards(
      candidates,
      draftedCards,
      cityId,
      false,
      fullMe?.citizenTrack ?? me?.citizenTrack ?? 1,
    );
    return {
      action: 'PICK',
      phaseLabel: `Draft pick ${publicState.politicsDraft.draftRound}/${publicState.politicsDraft.totalRounds}`,
      isMyTurn,
      currentChoiceName: recommendations[0]?.cardName ?? null,
      draftedCards,
      recommendations,
      computeMs: Math.max(0, Math.round(performance.now() - start)),
    };
  }

  return null;
}

export function draftPlanKey(plan: DraftPlan): string {
  return JSON.stringify({
    action: plan.action,
    phaseLabel: plan.phaseLabel,
    isMyTurn: plan.isMyTurn,
    drafted: plan.draftedCards.map(c => c.id),
    recommendations: plan.recommendations.map(r => [r.cardId, r.score]),
  });
}

function rankDraftCards(
  candidates: PoliticsCard[],
  draftedCards: PoliticsCard[],
  cityId: string,
  forBan: boolean,
  currentCitizenTrack: number,
  opponentCityIds: string[] = [],
): DraftCardRecommendation[] {
  const draftedIds = new Set(draftedCards.map(card => card.id));
  const roleCounts = countRoles(draftedCards);
  return candidates
    .filter(card => !draftedIds.has(card.id))
    .map(card => scoreCard(card, draftedCards, roleCounts, cityId, forBan, currentCitizenTrack, opponentCityIds))
    .sort((a, b) => b.score - a.score || a.cardName.localeCompare(b.cardName))
    .slice(0, 8);
}

function scoreCard(
  card: PoliticsCard,
  draftedCards: PoliticsCard[],
  roleCounts: Record<string, number>,
  cityId: string,
  forBan: boolean,
  currentCitizenTrack: number,
  opponentCityIds: string[],
): DraftCardRecommendation {
  const reasons: string[] = [];
  let score = BASE_CARD_VALUE[card.id] ?? fallbackBaseValue(card);

  const targetCityIds = forBan && opponentCityIds.length > 0 ? opponentCityIds : [cityId];
  const bestCityFit = targetCityIds
    .map(targetCityId => ({ cityId: targetCityId, bonus: CITY_SYNERGY[targetCityId]?.[card.id] ?? 0 }))
    .sort((a, b) => b.bonus - a.bonus)[0];
  const cityBonus = bestCityFit?.bonus ?? 0;
  if (cityBonus > 0) {
    score += cityBonus;
    reasons.push(forBan ? `threatens ${cityLabel(bestCityFit.cityId)}` : `fits ${cityLabel(cityId)}`);
  }

  if (card.type === 'ONGOING') {
    const earlyBonus = draftedCards.length <= 2 ? 6 : 3;
    score += earlyBonus;
    reasons.push('early ongoing value');
  } else if (card.type === 'END_GAME') {
    score += draftedCards.length >= 3 ? 5 : 2;
    reasons.push('end-game ceiling');
  } else if (card.type === 'IMMEDIATE') {
    score += 1;
  }

  const requirement = totalRequirement(card);
  if (requirement >= 3) {
    score -= 4;
    reasons.push('harder requirement');
  }
  if (card.cost >= 5) {
    score -= 4;
    reasons.push('expensive to play');
  } else if (card.cost === 0) {
    score += 3;
    reasons.push('free to play');
  }

  const role = cardRole(card);
  if (role && roleCounts[role] === 0) {
    score += 5;
    reasons.push(`adds ${role}`);
  } else if (role && roleCounts[role] >= 2) {
    score -= 3;
  }

  if (hasCard(draftedCards, 'central-government') && card.type !== 'END_GAME') {
    score += 2;
    reasons.push('feeds Central Government');
  }
  if (card.id === 'central-government' && draftedCards.filter(c => c.type !== 'END_GAME').length >= 2) {
    score += 5;
    reasons.push('your draft already supports it');
  }
  if (card.id === 'austerity' && draftedCards.some(c => c.type === 'END_GAME')) {
    score -= 4;
  }
  if (card.id === 'proskenion') {
    const citizenBonus = Math.min(8, Math.max(0, currentCitizenTrack - 2));
    score += citizenBonus;
    reasons.push(currentCitizenTrack >= 5 ? 'citizen scoring path' : 'needs citizen support');
  }
  if (forBan) {
    score += banPressure(card);
    reasons.unshift('deny opponent');
  }

  if (reasons.length === 0) reasons.push('solid generic value');

  return {
    cardId: card.id,
    cardName: card.name,
    score: Math.round(score),
    type: card.type,
    cost: card.cost,
    reasons: unique(reasons).slice(0, 3),
  };
}

function fallbackBaseValue(card: PoliticsCard): number {
  if (card.type === 'END_GAME') return 66;
  if (card.type === 'ONGOING') return 68;
  return 58;
}

function totalRequirement(card: PoliticsCard): number {
  return card.knowledgeRequirement.green + card.knowledgeRequirement.blue + card.knowledgeRequirement.red;
}

function countRoles(cards: PoliticsCard[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of cards) {
    const role = cardRole(card);
    if (role) counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}

function cardRole(card: PoliticsCard): string | null {
  if (['central-government', 'austerity', 'bank', 'gold-reserve', 'heavy-taxes', 'proskenion', 'diversification', 'hall-of-statues'].includes(card.id)) {
    return 'scoring';
  }
  if (['greek-fire', 'foreign-supplies', 'helepole', 'stadion', 'mercenary-recruitment', 'persians'].includes(card.id)) {
    return 'military';
  }
  if (['corinthian-columns', 'diolkos', 'lighthouse', 'gifts-from-the-west', 'constructing-the-mint'].includes(card.id)) {
    return 'economy';
  }
  if (['reformists', 'gradualism', 'oracle', 'founding-the-lyceum', 'scholarly-welcome'].includes(card.id)) {
    return 'progress';
  }
  if (['council', 'ostracism', 'extraordinary-collection'].includes(card.id)) {
    return 'card engine';
  }
  return null;
}

function hasCard(cards: PoliticsCard[], id: string): boolean {
  return cards.some(card => card.id === id);
}

function banPressure(card: PoliticsCard): number {
  if (card.type === 'ONGOING') return 5;
  if (card.id === 'central-government' || card.id === 'diversification') return 6;
  return 0;
}

function cityLabel(cityId: string): string {
  if (!cityId) return 'your city';
  return cityId.charAt(0).toUpperCase() + cityId.slice(1);
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
