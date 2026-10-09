// HTTP-status från ett ApiError. Duck-typat så att moduler som testas med en
// mockad '@/lib/api' inte behöver importera klassen.
export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error as { status: unknown };
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}
