/**
 * Instant-runoff voting (IRV), the counting method of ranked ballots.
 *
 * Each round, every ballot counts for its highest-ranked option that is
 * still in the race. If an option has more than half of the ballots still
 * counting, it wins. Otherwise the option with the fewest votes is
 * eliminated and its ballots move to their next choice. A ballot whose
 * remaining choices are all eliminated is "exhausted" and stops counting
 * (voters may rank only some of the options).
 *
 * Ties for last place are broken by (1) fewer first-preference votes, then
 * (2) fewer ballots mentioning the option at any rank. If every option still
 * in the race is tied on votes and on both criteria, they share the victory
 * (a true tie). A tie limited to some options is settled by their position in
 * the poll (later options go first), so the count is always reproducible.
 */

export interface IrvRound {
  round: number;
  /** Votes per option still in the race at this round. */
  tallies: { optionId: string; votes: number }[];
  /** Ballots counting this round (not exhausted). */
  activeBallots: number;
  exhaustedBallots: number;
  /** Option(s) eliminated at the end of this round (empty on the final round). */
  eliminated: string[];
}

export interface IrvResult {
  rounds: IrvRound[];
  /** One winner, several in case of a perfect tie, none without ballots. */
  winners: string[];
}

/**
 * @param optionIds options in poll order (used for the final tie-break)
 * @param ballots   each ballot = option ids in order of preference
 */
export function instantRunoff(optionIds: string[], ballots: string[][]): IrvResult {
  const valid = ballots.map((b) => b.filter((id) => optionIds.includes(id))).filter((b) => b.length > 0);
  if (valid.length === 0) return { rounds: [], winners: [] };

  const firstPreferences = new Map(optionIds.map((id) => [id, 0]));
  const mentions = new Map(optionIds.map((id) => [id, 0]));
  for (const b of valid) {
    firstPreferences.set(b[0], firstPreferences.get(b[0])! + 1);
    for (const id of b) mentions.set(id, mentions.get(id)! + 1);
  }
  const strength = (id: string) => [firstPreferences.get(id)!, mentions.get(id)!];

  const remaining = new Set(optionIds);
  const rounds: IrvRound[] = [];

  for (let round = 1; remaining.size > 0; round++) {
    const tallies = new Map([...remaining].map((id) => [id, 0]));
    let active = 0;
    for (const b of valid) {
      const choice = b.find((id) => remaining.has(id));
      if (choice) {
        tallies.set(choice, tallies.get(choice)! + 1);
        active++;
      }
    }
    const entries = [...tallies.entries()].map(([optionId, votes]) => ({ optionId, votes }));
    const base = { round, tallies: entries, activeBallots: active, exhaustedBallots: valid.length - active };

    const max = Math.max(...entries.map((e) => e.votes));
    const leaders = entries.filter((e) => e.votes === max);
    // Majority of the ballots still counting, or a single option left.
    if ((active > 0 && max * 2 > active) || remaining.size === 1) {
      rounds.push({ ...base, eliminated: [] });
      return { rounds, winners: [leaders[0].optionId] };
    }
    // Everyone left tied on votes AND on the tie-break criteria: a true tie.
    if (leaders.length === entries.length) {
      const [f0, m0] = strength(entries[0].optionId);
      if (entries.every((e) => strength(e.optionId)[0] === f0 && strength(e.optionId)[1] === m0)) {
        rounds.push({ ...base, eliminated: [] });
        return { rounds, winners: leaders.map((l) => l.optionId) };
      }
    }

    const min = Math.min(...entries.map((e) => e.votes));
    const loser = entries
      .filter((e) => e.votes === min)
      .sort((a, b) => {
        const [fa, ma] = strength(a.optionId);
        const [fb, mb] = strength(b.optionId);
        return fa - fb || ma - mb || optionIds.indexOf(b.optionId) - optionIds.indexOf(a.optionId);
      })[0].optionId;
    rounds.push({ ...base, eliminated: [loser] });
    remaining.delete(loser);
  }
  return { rounds, winners: [] };
}
