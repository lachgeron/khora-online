import React, { useState } from 'react';
import { ACTION_NUMBERS } from './types';
import type {
  PlayerInfo,
  DiceAssignment,
  TrackAdvancement,
  ActionType,
  ActionChoices,
} from './types';
import { createLobby, joinLobby, startGame, takeSeat } from './api';
import { useGameSocket } from './useGameSocket';
import { useLobbyPolling } from './useLobbyPolling';
import { GameBrowser } from './components/GameBrowser';
import { LobbyRoom } from './components/LobbyRoom';
import { CitySelection } from './components/CitySelection';
import { PoliticsDraft } from './components/PoliticsDraft';
import { GameBoard } from './components/GameBoard';
import { DicePhase } from './components/DicePhase';
import { ActionPhase } from './components/ActionPhase';
import { WaitingPanel } from './components/WaitingPanel';
import { ProgressPhase } from './components/ProgressPhase';
import { AchievementPhase } from './components/AchievementPhase';
import { GloryEventPanel } from './components/GloryEventPanel';
import { GameSummary } from './components/GameSummary';

type Screen = 'NAME' | 'BROWSE' | 'LOBBY' | 'GAME';

export const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('NAME');
  const [playerName, setPlayerName] = useState('');
  const [currentPlayerId, setCurrentPlayerId] = useState('');
  const [hostPlayerId, setHostPlayerId] = useState('');
  const [lobbyId, setLobbyId] = useState('');
  const [lobbyPlayers, setLobbyPlayers] = useState<PlayerInfo[]>([]);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);

  const { gameState, privateState, finalScores, connected, error: wsError, sendMessage } =
    useGameSocket(gameId, currentPlayerId);

  // Poll lobby for player list updates while in LOBBY screen
  useLobbyPolling(
    screen === 'LOBBY' ? lobbyId : null,
    2000,
    ({ players, started, gameId: detectedGameId }) => {
      setLobbyPlayers(players);
      if (started && detectedGameId && !gameId) {
        setGameId(detectedGameId);
        setScreen('GAME');
      }
    },
  );

  const handleCreateGame = async () => {
    try {
      const data = await createLobby(playerName);
      if (data.code) { setLobbyError(data.message); return; }
      setLobbyId(data.lobbyId);
      setHostPlayerId(data.hostPlayerId);
      setCurrentPlayerId(data.hostPlayerId);
      setLobbyPlayers([{ playerId: data.hostPlayerId, playerName }]);
      setLobbyError(null);
      setScreen('LOBBY');
    } catch { setLobbyError('Failed to create game'); }
  };

  const handleJoinLobby = async (targetLobbyId: string) => {
    try {
      const data = await joinLobby(targetLobbyId, playerName);
      if (data.code) { setLobbyError(data.message); return; }
      setLobbyId(data.lobbyId);
      setCurrentPlayerId(data.playerId);
      setLobbyPlayers(data.players);
      setHostPlayerId(data.players[0]?.playerId ?? '');
      setLobbyError(null);
      setScreen('LOBBY');
    } catch { setLobbyError('Failed to join lobby'); }
  };

  const handleTakeSeat = async (targetGameId: string) => {
    try {
      const data = await takeSeat(targetGameId, playerName);
      if (data.code) { setLobbyError(data.message); return; }
      setGameId(data.gameId);
      setCurrentPlayerId(data.playerId);
      setLobbyError(null);
      setScreen('GAME');
    } catch { setLobbyError('Failed to take seat'); }
  };

  const handleStartGame = async () => {
    try {
      const data = await startGame(lobbyId, currentPlayerId);
      if (data.code) { setLobbyError(data.message); return; }
      setGameId(data.gameId);
      setScreen('GAME');
    } catch { setLobbyError('Failed to start game'); }
  };

  const handleBackToBrowse = () => {
    setLobbyId('');
    setLobbyPlayers([]);
    setLobbyError(null);
    setScreen('BROWSE');
  };

  const handleRollDice = () => sendMessage({ type: 'ROLL_DICE' });
  const handleAssignDice = (assignments: DiceAssignment[], philosophyTokensToSpend?: number) =>
    sendMessage({ type: 'ASSIGN_DICE', assignments, philosophyTokensToSpend });
  const handleUnassignDice = () => sendMessage({ type: 'UNASSIGN_DICE' });
  const handleResolveAction = (actionType: ActionType, choices: ActionChoices) =>
    sendMessage({ type: 'RESOLVE_ACTION', actionType, choices });
  const handleProgressTrack = (advancement: TrackAdvancement, extraTracks?: TrackAdvancement[]) =>
    sendMessage({ type: 'PROGRESS_TRACK', advancement, extraTracks });
  const handleUndoProgress = () => sendMessage({ type: 'UNDO_PROGRESS' });
  const handleSkipPhase = () => sendMessage({ type: 'SKIP_PHASE' });
  const handleClaimAchievement = (achievementId: string, trackChoice: 'TAX' | 'GLORY') =>
    sendMessage({ type: 'CLAIM_ACHIEVEMENT', achievementId, trackChoice });
  const handleSelectCity = (cityId: string) => sendMessage({ type: 'SELECT_CITY', cityId });
  const handleDraftCard = (cardId: string) => sendMessage({ type: 'DRAFT_CARD', cardId });

  const currentPlayer = gameState?.players.find(p => p.playerId === currentPlayerId);

  const playerNames: Record<string, string> = {};
  if (gameState) {
    for (const p of gameState.players) {
      playerNames[p.playerId] = p.playerName;
    }
  }

  return (
    <div>
      {screen === 'NAME' && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="max-w-sm w-full text-center px-6">
            <h1 className="font-display text-4xl font-bold text-sand-800 mb-1">Khora</h1>
            <p className="text-sand-500 italic mb-10">Rise of an Empire</p>
            <input
              type="text"
              placeholder="Enter your name"
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && playerName.trim() && setScreen('BROWSE')}
              className="w-full px-4 py-2.5 bg-sand-50 border border-sand-300 rounded-lg text-sm text-center focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
            <button
              onClick={() => playerName.trim() && setScreen('BROWSE')}
              disabled={!playerName.trim()}
              className="mt-4 w-full px-4 py-2.5 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {screen === 'BROWSE' && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="max-w-lg w-full px-6">
            <h1 className="font-display text-2xl font-bold text-sand-800 mb-1 text-center">Khora</h1>
            <p className="text-sand-500 italic mb-8 text-center">Rise of an Empire</p>
            <GameBrowser
              playerName={playerName}
              onCreateGame={handleCreateGame}
              onJoinLobby={handleJoinLobby}
              onTakeSeat={handleTakeSeat}
              error={lobbyError}
            />
          </div>
        </div>
      )}

      {screen === 'LOBBY' && (
        <LobbyRoom
          players={lobbyPlayers}
          currentPlayerId={currentPlayerId}
          hostPlayerId={hostPlayerId}
          onStartGame={handleStartGame}
          onBack={handleBackToBrowse}
        />
      )}

      {screen === 'GAME' && !gameState && (
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-sand-600">Connecting to game server{connected ? '...' : ' (waiting)'}</p>
          {wsError && <p className="text-crimson mt-2">{wsError}</p>}
        </div>
      )}

      {screen === 'GAME' && gameState && privateState && (() => {
        // Show end-game summary when game is over
        if (gameState.currentPhase === 'GAME_OVER') {
          const scores = finalScores ?? gameState.finalScores;
          if (scores) {
            return (
              <GameSummary finalScores={scores} gameLog={gameState.gameLog} gameState={gameState} />
            );
          }
        }

        const PHASE_DISPLAY_LABELS: Record<string, string> = {
          OMEN: 'Event Announcement',
          TAXATION: 'Collecting taxes',
          GLORY: 'Event Resolution',
        };
        const pending = gameState.pendingDecisions.find(d => d.decisionType !== 'PHASE_DISPLAY') ?? gameState.pendingDecisions[0];
        const isDisplayPhase = pending?.decisionType === 'PHASE_DISPLAY';
        const isMyTurn = !isDisplayPhase && pending?.playerId === currentPlayerId;
        const DECISION_LABELS: Record<string, string> = {
          SELECT_CITY: 'select a city', DRAFT_CARD: 'draft a card', ROLL_DICE: 'roll dice',
          ASSIGN_DICE: 'assign dice', RESOLVE_ACTION: 'resolve action', PROGRESS_TRACK: 'advance a track',
          ACHIEVEMENT_TRACK_CHOICE: 'choose reward', SPEND_PHILOSOPHY_TOKENS: 'spend tokens',
        };
        let statusText = '';
        if (isDisplayPhase) {
          statusText = PHASE_DISPLAY_LABELS[gameState.currentPhase] ?? '';
        } else if (pending && gameState.currentPhase !== 'GAME_OVER') {
          const who = isMyTurn ? 'Your turn' : `Waiting for ${gameState.players.find(p => p.playerId === pending.playerId)?.playerName ?? '...'}`;
          const action = DECISION_LABELS[pending.decisionType] ?? pending.decisionType;
          statusText = isMyTurn ? `Your turn — ${action}` : `${who} to ${action}`;
        }

        return (
        <div className="grid grid-cols-[320px_1fr_280px] grid-rows-[auto_1fr_auto] gap-3 max-w-[1440px] mx-auto p-3 min-h-screen">

          {gameState.currentPhase === 'CITY_SELECTION' && gameState.cityDraft && (
            <CitySelection
              offeredCities={privateState.offeredCities ?? null}
              pickOrder={gameState.cityDraft.pickOrder}
              currentPickerIndex={gameState.cityDraft.currentPickerIndex}
              selections={gameState.cityDraft.selections}
              allCities={gameState.cityDraft.allCities}
              currentPlayerId={currentPlayerId}
              playerNames={playerNames}
              pendingDecisions={gameState.pendingDecisions}
              onSelectCity={handleSelectCity}
            />
          )}

          {gameState.currentPhase === 'DRAFT_POLITICS' && gameState.politicsDraft && (
            <PoliticsDraft
              draftPack={privateState.draftPack ?? null}
              draftedCards={privateState.draftedCards ?? null}
              draftRound={gameState.politicsDraft.draftRound}
              totalRounds={gameState.politicsDraft.totalRounds}
              waitingFor={gameState.politicsDraft.waitingFor}
              currentPlayerId={currentPlayerId}
              playerNames={playerNames}
              pendingDecisions={gameState.pendingDecisions}
              onDraftCard={handleDraftCard}
              cityCard={(() => {
                const player = gameState.players.find(p => p.playerId === currentPlayerId);
                return player?.cityId ? (gameState.cityCards?.[player.cityId] ?? null) : null;
              })()}
            />
          )}

          {gameState.currentPhase !== 'CITY_SELECTION' && gameState.currentPhase !== 'DRAFT_POLITICS' && (
            <GameBoard
              gameState={gameState}
              privateState={privateState}
              currentPlayerId={currentPlayerId}
              statusText={statusText}
              isMyTurn={isMyTurn}
              onActivateDev={(devId) => sendMessage({ type: 'ACTIVATE_DEV', devId })}
            >
              {gameState.currentPhase === 'OMEN' && gameState.currentEvent && (
                <div className="text-center py-4">
                  <p className="font-display text-xs uppercase tracking-[0.12em] text-sand-500 mb-3">Event Announcement</p>
                  <p className="font-display text-lg font-bold text-sand-800">{gameState.currentEvent.name}</p>
                  <p className="text-sm text-sand-600 mt-2">{gameState.currentEvent.gloryCondition.description}</p>
                  <p className="text-xs text-sand-400 mt-4 animate-pulse">Continuing shortly...</p>
                </div>
              )}

              {gameState.currentPhase === 'TAXATION' && (
                <div className="py-4">
                  <p className="font-display text-xs uppercase tracking-[0.12em] text-sand-500 mb-3 text-center">Tax Collection</p>
                  <div className="space-y-1.5">
                    {gameState.players.map(p => {
                      const entries = gameState.gameLog
                        .filter(e => e.roundNumber === gameState.roundNumber && e.phase === 'TAXATION' && e.playerId === p.playerId);
                      const taxIncome = (entries.find(e => e.details?.taxIncome != null)?.details?.taxIncome as number) ?? 0;
                      const vpGain = (entries.find(e => e.details?.vpGain != null)?.details?.vpGain as number) ?? 0;
                      const troopGain = (entries.find(e => e.details?.troopGain != null)?.details?.troopGain as number) ?? 0;
                      const extraCoins = (entries.find(e => e.details?.extraCoins != null)?.details?.extraCoins as number) ?? 0;
                      const citizenGain = (entries.find(e => e.details?.citizenGain != null)?.details?.citizenGain as number) ?? 0;
                      const isMe = p.playerId === currentPlayerId;
                      const hasBonuses = vpGain > 0 || troopGain > 0 || extraCoins > 0 || citizenGain > 0;
                      return (
                        <div key={p.playerId} className={`rounded-lg px-3 py-2 ${isMe ? 'bg-gold/10 border border-gold/30' : 'bg-sand-100'}`}>
                          <div className="flex items-center justify-between">
                            <span className={`text-sm ${isMe ? 'font-semibold text-sand-800' : 'text-sand-600'}`}>
                              {p.playerName}{isMe ? ' (you)' : ''}
                            </span>
                            <span className="text-sm font-semibold text-amber-700">+{taxIncome} 💰</span>
                          </div>
                          {hasBonuses && (
                            <div className="flex flex-wrap gap-2 mt-1">
                              {vpGain > 0 && <span className="text-[0.65rem] font-medium text-emerald-700">+{vpGain} ★</span>}
                              {troopGain > 0 && <span className="text-[0.65rem] font-medium text-sand-600">+{troopGain} ⚔️</span>}
                              {extraCoins > 0 && <span className="text-[0.65rem] font-medium text-amber-600">+{extraCoins} 💰</span>}
                              {citizenGain > 0 && <span className="text-[0.65rem] font-medium text-sky-700">+{citizenGain} 👤</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-sand-400 mt-4 text-center animate-pulse">Continuing shortly...</p>
                </div>
              )}

              {gameState.currentPhase === 'GLORY' && gameState.currentEvent && (
                <GloryEventPanel
                  gameState={gameState}
                  privateState={privateState}
                  currentPlayerId={currentPlayerId}
                  currentPlayer={currentPlayer}
                  onResolveAction={handleResolveAction}
                  onSkip={handleSkipPhase}
                  sendMessage={sendMessage}
                />
              )}

              {gameState.currentPhase === 'DICE' && (
                <DicePhase
                  diceRoll={privateState.diceRoll}
                  citizenTrack={currentPlayer?.citizenTrack ?? 0}
                  philosophyTokens={privateState.philosophyTokens}
                  players={gameState.players}
                  currentPlayerId={currentPlayerId}
                  startPlayerId={gameState.startPlayerId}
                  actionSlots={privateState.actionSlots}
                  pendingDecisions={gameState.pendingDecisions}
                  onRoll={handleRollDice}
                  onAssign={handleAssignDice}
                  onUnassign={handleUnassignDice}
                />
              )}

              {gameState.currentPhase === 'ACTIONS' && (() => {
                const hasPendingDecision = gameState.pendingDecisions.some(
                  d => d.playerId === currentPlayerId && d.decisionType === 'RESOLVE_ACTION',
                );
                const nextSlot = hasPendingDecision
                  ? (privateState.actionSlots
                      .filter((s): s is NonNullable<typeof s> => s !== null && !s.resolved)
                      .sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType])[0] ?? null)
                  : null;

                return (
                  <div className="space-y-4">
                    {nextSlot && (
                      <ActionPhase
                        actionType={nextSlot.actionType}
                        handCards={privateState.handCards}
                        playerCoins={privateState.coins}
                        playerMilitaryTrack={currentPlayer?.militaryTrack ?? 0}
                        playerTroopTrack={currentPlayer?.troopTrack ?? 0}
                        playerKnowledgeTokens={privateState.knowledgeTokens}
                        philosophyTokens={privateState.philosophyTokens}
                        developmentLevel={currentPlayer?.developmentLevel ?? 0}
                        cityId={currentPlayer?.cityId}
                        cityDevelopments={gameState.cityCards?.[currentPlayer?.cityId ?? '']?.developments}
                        centralBoardTokens={gameState.centralBoardTokens}
                        legislationDraw={privateState.legislationDraw}
                        onResolve={handleResolveAction}
                        onSkip={handleSkipPhase}
                        timeoutAt={gameState.pendingDecisions.find(d => d.playerId === currentPlayerId && d.decisionType === 'RESOLVE_ACTION')?.timeoutAt}
                      />
                    )}
                    <div className={nextSlot ? 'border-t border-sand-200 pt-4' : ''}>
                      <WaitingPanel gameState={gameState} privateState={privateState} currentPlayerId={currentPlayerId} />
                    </div>
                  </div>
                );
              })()}

              {gameState.currentPhase === 'PROGRESS' && (
                <ProgressPhase
                  economyTrack={currentPlayer?.economyTrack ?? 0}
                  cultureTrack={currentPlayer?.cultureTrack ?? 0}
                  militaryTrack={currentPlayer?.militaryTrack ?? 0}
                  coins={privateState.coins}
                  philosophyTokens={privateState.philosophyTokens}
                  pendingDecisions={gameState.pendingDecisions}
                  currentPlayerId={currentPlayerId}
                  playedCardIds={privateState.playedCards.map(c => c.id)}
                  onAdvance={handleProgressTrack}
                  onUndo={handleUndoProgress}
                  onSkip={handleSkipPhase}
                />
              )}

              {gameState.currentPhase === 'ACHIEVEMENT' && (
                <AchievementPhase
                  claimableAchievements={gameState.availableAchievements}
                  pendingDecisions={gameState.pendingDecisions}
                  currentPlayerId={currentPlayerId}
                  onClaim={handleClaimAchievement}
                  onSkip={handleSkipPhase}
                />
              )}
            </GameBoard>
          )}
        </div>
        );
      })()}
    </div>
  );
};

export default App;
