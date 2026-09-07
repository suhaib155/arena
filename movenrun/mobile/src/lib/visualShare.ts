/** One user-initiated export. Files are temporary and never outlive the sheet. */
export interface VisualSharePorts {
  current(): boolean;
  captureMap(): Promise<string | null>;
  prepareCard(map: string | null): Promise<void>;
  captureCard(): Promise<string>;
  shareImage(uri: string): Promise<void>;
  remove(uri: string): Promise<void>;
}

export async function shareVisualSummary(ports: VisualSharePorts): Promise<void> {
  const files = new Set<string>();
  const check = () => { if (!ports.current()) throw new Error("share_cancelled"); };
  try {
    check();
    const map = await ports.captureMap();
    if (map) files.add(map);
    check();
    await ports.prepareCard(map);
    check();
    const card = await ports.captureCard();
    files.add(card);
    check();
    await ports.shareImage(card);
  } finally {
    await Promise.all([...files].map((file) => ports.remove(file)));
  }
}
