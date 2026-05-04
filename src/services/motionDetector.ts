const CONFIRMATION_COUNT = 2;
const WINDOW_SIZE = 5;
const EVENT_TTL = 30000; // 30s — old events don't count

interface MotionEvent {
  isMoving: boolean;
  timestamp: number;
}

class MotionDetector {
  private events: MotionEvent[] = [];

  record(isMoving: boolean): void {
    const now = Date.now();
    this.events.push({ isMoving, timestamp: now });
    if (this.events.length > WINDOW_SIZE) {
      this.events.shift();
    }
  }

  isMotionConfirmed(): boolean {
    const now = Date.now();
    const recent = this.events.filter(e => now - e.timestamp < EVENT_TTL);
    if (recent.length < CONFIRMATION_COUNT) return false;

    const lastN = recent.slice(-CONFIRMATION_COUNT);
    return lastN.every(e => e.isMoving);
  }

  isStationaryConfirmed(): boolean {
    const now = Date.now();
    const recent = this.events.filter(e => now - e.timestamp < EVENT_TTL);
    if (recent.length < CONFIRMATION_COUNT) return true;

    const lastN = recent.slice(-CONFIRMATION_COUNT);
    return lastN.every(e => !e.isMoving);
  }

  reset(): void {
    this.events = [];
  }
}

export const motionDetector = new MotionDetector();
