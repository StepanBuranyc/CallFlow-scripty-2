const recentEvents: Array<{ at: string; participantId: number; stage: string; detail?: string | number }> = [];
const eventLimit = 100;

export function recordAiEvent(participantId: number, stage: string, detail?: string | number): void {
  recentEvents.push({ at: new Date().toISOString(), participantId, stage, detail });
  if (recentEvents.length > eventLimit) recentEvents.shift();
}

export function recentAiEvents() {
  return recentEvents.slice().reverse();
}
