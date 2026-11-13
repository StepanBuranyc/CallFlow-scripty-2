const recentEvents: Array<{ at: string; participantId: number; stage: string; detail?: string | number; ticketNumber?: number }> = [];
const eventLimit = 100;

export function recordAiEvent(participantId: number, stage: string, detail?: string | number, ticketNumber?: number): void {
  recentEvents.push({ at: new Date().toISOString(), participantId, stage, detail, ticketNumber });
  if (recentEvents.length > eventLimit) recentEvents.shift();
}

export function recentAiEvents() {
  const cutoff = Date.now() - 30 * 60_000;
  return recentEvents.filter(event => Date.parse(event.at) >= cutoff).reverse();
}
