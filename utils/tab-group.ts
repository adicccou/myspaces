export async function composeGroupId(groupId: number) {
  const group = await browser.tabGroups.get(groupId);
  return `${groupId}::${group.title}::${group.color}`;
}

export async function decomposeGroupId(
  composedId: string
): Promise<{ id: number; title: string; color: string }> {
  const [idStr, title, color] = composedId.split("::");
  return { id: parseInt(idStr), title, color };
}
