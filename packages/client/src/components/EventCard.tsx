import React from 'react';
import type { EventCard as EventCardType } from '../types';

export interface EventCardProps {
  event: EventCardType | null;
}

/** Displays the current round's event card. Req 4.2 */
export const EventCardDisplay: React.FC<EventCardProps> = ({ event }) => {
  if (!event) {
    return <div>No event card revealed yet.</div>;
  }

  return (
    <div style={{ border: '1px solid #666', padding: '8px' }}>
      <h3>Event: {event.name}</h3>
      <p>Glory: {event.gloryCondition.description}</p>
      {event.immediateEffect && <p>Immediate effect active</p>}
      {event.penaltyEffect && <p>Penalty effect active</p>}
    </div>
  );
};
