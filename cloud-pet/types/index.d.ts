export type PetUsage = {
  /** tokens in the context right now (the last response's input) */
  tokens: number
  /** five_hour rate-limit window used, 0-100; absent until the API reports one */
  five?: number
  /** seven_day rate-limit window used, 0-100 */
  week?: number
  /** ISO time the five_hour window resets */
  fiveResets?: string
  /** session cost in USD */
  cost?: number
}

/** One day of the pet's diary, kept in $.store under `days` by local date (YYYY-MM-DD). */
export type Day = {
  turns: number
  /** seconds of turns */
  secs: number
  /** USD spent in turns */
  cost: number
  compacts: number
  /** times a limit ran out */
  deaths: number
}

declare module 'claude-code' {
  interface PluginState {
    'cloud-pet': { usage: PetUsage; compacts: number }
  }
}
