export function bracketSize(entrants: number): number {
  if (!Number.isInteger(entrants) || entrants < 2) throw new Error("at least two entrants required");
  return 2 ** Math.ceil(Math.log2(entrants));
}

/** Seeds byes across first-round matches so no later round is left with an
 * impossible one-sided match for 3, 5, 6, or 7 entrants. */
export function firstRoundSeeds<T>(entrants: readonly T[]): Array<[T | null, T | null]> {
  const matches = bracketSize(entrants.length) / 2;
  return Array.from({ length: matches }, (_, index) => [
    entrants[index] ?? null,
    entrants[matches + index] ?? null,
  ]);
}

export function canConfirmTournamentPayment(status: string, bracketGeneratedAt: Date | null): boolean {
  return status === "PUBLISHED" && !bracketGeneratedAt;
}