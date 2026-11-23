import { setTimeout } from 'node:timers/promises'

export const waitForUpdate = async (milliseconds: number, signal?: AbortSignal): Promise<void> => {
  signal?.throwIfAborted()
  if (milliseconds > 0) await setTimeout(milliseconds, undefined, { signal })
  signal?.throwIfAborted()
}
