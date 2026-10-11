/** A failed call cannot trigger fixture cleanup while another approved call is still executing. */
export async function settleLiveBatch<T>(calls: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(calls);
  const failures = settled.filter((result) => result.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      'Native call batch failed after every call settled',
    );
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}
