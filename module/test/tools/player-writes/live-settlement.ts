/** Attach rejection tracking before UI preparation can fail, and keep cleanup behind every call. */
export function startLiveBatch<T>(calls: readonly Promise<T>[]) {
  const settled = Promise.allSettled(calls);
  return {
    settled,
    async result(): Promise<T[]> {
      const results = await settled;
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason),
          'Native call batch failed after every call settled',
        );
      return results.map((result) => (result as PromiseFulfilledResult<T>).value);
    },
  };
}

export async function settleLiveBatch<T>(calls: readonly Promise<T>[]): Promise<T[]> {
  return startLiveBatch(calls).result();
}
