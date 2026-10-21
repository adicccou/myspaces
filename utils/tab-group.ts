export async function decomposeGroupId(
  composedId: string
): Promise<{ id: number; title: string; color: string }> {
  try {
    const parsed = JSON.parse(composedId);
    if (Array.isArray(parsed) && parsed.length === 3) {
      return { id: -1, title: parsed[0], color: parsed[1] };
    }
  } catch {}
  const firstSeparator = composedId.indexOf("::");
  const lastSeparator = composedId.lastIndexOf("::");
  if (firstSeparator < 0 || lastSeparator === firstSeparator) {
    return { id: -1, title: composedId, color: "grey" };
  }
  return {
    id: Number.parseInt(composedId.slice(0, firstSeparator), 10),
    title: composedId.slice(firstSeparator + 2, lastSeparator),
    color: composedId.slice(lastSeparator + 2),
  };
}
