import React from 'react';
import type { ClientMessage, PrivatePlayerState, PublicPlayerState } from '../types';
import { ActionPhase } from './ActionPhase';
import { CountdownTimer } from './CountdownTimer';

export function ExpansionChoicePanel({ privateState, player, sendMessage, timeoutAt }: {
  privateState: PrivatePlayerState;
  player?: PublicPlayerState;
  sendMessage: (message: ClientMessage) => void;
  timeoutAt?: number;
}) {
  const choice = privateState.expansionChoice;
  if (!choice) return null;
  const name = privateState.playedCards.find(c => c.id === choice.cardId)?.name ?? 'Bonus politics';
  const select = (value?: string, amount?: number) => sendMessage({ type: 'RESOLVE_EXPANSION', value, amount });
  const button = 'w-full rounded-lg border border-sand-300 bg-sand-100 px-4 py-3 text-left text-sm text-sand-800 hover:border-gold hover:bg-gold/10';
  return (
    <div className="fixed inset-0 z-50 bg-sand-900/60 flex items-center justify-center p-6">
      <section role="dialog" aria-modal="true" aria-label={name} className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-sand-50 p-6 shadow-2xl space-y-3">
        <h2 className="font-display text-xl font-bold text-sand-800">{name}</h2>
        {timeoutAt && <CountdownTimer timeoutAt={timeoutAt} />}
        {choice.kind === 'TOKEN' && <>
          <p className="text-sm text-sand-600">Sacrifice a minor token to gain 6 VP.</p>
          {privateState.knowledgeTokens.filter(t => t.tokenType === 'MINOR').map(t => <button key={t.id} className={button} onClick={() => select(t.id)}>Sacrifice {t.color.toLowerCase()} minor token</button>)}
        </>}
        {choice.kind === 'COINS' && <>
          <p className="text-sm text-sand-600">Choose how many drachma to spend.</p>
          {Array.from({ length: Math.min(3, privateState.coins) + 1 }, (_, amount) => <button key={amount} className={button} onClick={() => select(undefined, amount)}>{amount === 0 ? 'Do not spend drachma' : `Pay ${amount} drachma → gain ${Math.min(amount * 2, 15 - (player?.citizenTrack ?? 0))} citizens`}</button>)}
        </>}
        {choice.kind === 'DRAW' && <>
          <p className="text-sm text-sand-600">Choose a card from the bottom of the deck to add to your hand.</p>
          {choice.cards?.map(card => <button key={card.id} className={button} onClick={() => select(card.id)}><strong>{card.name}</strong><span className="block text-xs mt-1">{card.description}</span><span className="block text-xs mt-1">{card.cost} drachma · {card.knowledgeRequirement.green} green · {card.knowledgeRequirement.blue} blue · {card.knowledgeRequirement.red} red</span></button>)}
        </>}
        {choice.kind === 'ENLIST' && <>
          <button className={button} onClick={() => select(undefined, 1)}>Lose 1 citizen → gain 1 troop</button>
          <button className={button} onClick={() => select(undefined, 0)}>Keep my citizen</button>
        </>}
        {choice.kind === 'REWARD' && <>
          <button className={button} onClick={() => select('scroll')}>Gain 1 scroll</button>
          <button className={button} onClick={() => select('coin')}>Gain 1 drachma</button>
        </>}
        {choice.kind === 'GLORY' && <>
          <p className="text-sm text-sand-600">You would gain {choice.amount} Glory. Choose how many levels to exchange for VP.</p>
          {Array.from({ length: (choice.amount ?? 0) + 1 }, (_, amount) => <button key={amount} className={button} onClick={() => select(undefined, amount)}>Gain {Math.min(10 - (player?.gloryTrack ?? 0), (choice.amount ?? 0) - amount)} Glory{amount > 0 ? ` and ${amount * 3} VP` : ''}</button>)}
        </>}
        {choice.kind === 'POLITICS' && <>
          <p className="text-sm text-sand-600">{choice.extraCost ? 'You may pay 1 additional drachma to play a card, paying its normal cost and meeting its knowledge requirements.' : 'You may take another politics action.'}</p>
          <ActionPhase actionType="POLITICS" handCards={privateState.handCards} playedCards={privateState.playedCards}
            playerCoins={Math.max(0, privateState.coins - (choice.extraCost ?? 0))}
            playerKnowledgeTokens={privateState.knowledgeTokens} philosophyTokens={privateState.philosophyTokens}
            onResolve={(_type, choices) => sendMessage({ type: 'RESOLVE_EXPANSION', choices })}
            onSkip={() => select('skip')} />
        </>}
      </section>
    </div>
  );
}
