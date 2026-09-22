export function isCompleteFivePlayerSquad(captainId: string, memberIds: string[]): boolean {
  return memberIds.length === 5 &&
    new Set(memberIds).size === 5 &&
    memberIds.includes(captainId);
}

export function skillRangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin <= bMax && bMin <= aMax;
}

export function availabilityOverlaps(
  a: { startAt: Date; endAt: Date; pitchId?: string | null },
  b: { startAt: Date; endAt: Date; pitchId?: string | null },
): boolean {
  return (!a.pitchId || !b.pitchId || a.pitchId === b.pitchId) &&
    a.startAt < b.endAt &&
    b.startAt < a.endAt;
}

export function cappedResultLimit(value: unknown, defaultValue = 50): number {
  return Math.min(100, Math.max(1, Number(value) || defaultValue));
}

export function validSlotStartsInOverlap(input: {
  overlapStart: Date; overlapEnd: Date; pitchId: string; durationMinutes: number;
  openTime: string; closeTime: string; exactA: boolean; exactB: boolean;
  exactStartA?: Date; exactStartB?: Date;
}): Date[] {
  const date = input.overlapStart.toISOString().slice(0, 10);
  const start = new Date(`${date}T${input.openTime}Z`);
  const close = new Date(`${date}T${input.closeTime}Z`);
  const result: Date[] = [];
  while (start.getTime() + input.durationMinutes * 60_000 <= close.getTime()) {
    const end = new Date(start.getTime() + input.durationMinutes * 60_000);
    const exactStartsAgree = (!input.exactA || !input.exactB || !input.exactStartA || !input.exactStartB ||
      input.exactStartA.getTime() === input.exactStartB.getTime());
    if (start >= input.overlapStart && end <= input.overlapEnd && exactStartsAgree &&
      // Exact availability is represented by a window exactly matching a slot.
       (!input.exactA || (start.getTime() === (input.exactStartA ?? input.overlapStart).getTime() && end <= input.overlapEnd)) &&
       (!input.exactB || (start.getTime() === (input.exactStartB ?? input.overlapStart).getTime() && end <= input.overlapEnd))) result.push(new Date(start));
    start.setTime(end.getTime());
  }
  return result;
}