export type ItemKind = "gadget" | "consumable" | "tool";

export interface Item {
  id: string;
  name: string;
  kind: ItemKind;
}

export interface Note {
  id: string;
  itemId: string;
  text: string;
}

export interface Profile {
  displayName: string;
  theme: "light" | "dark";
}

const keys = {
  session: "walkshop.session",
  items: "walkshop.items",
  notes: "walkshop.notes",
  nextId: "walkshop.nextId",
  profile: "walkshop.profile",
};

function read(key: string): unknown {
  const raw = localStorage.getItem(key);

  if (raw === null) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getSession(): string | undefined {
  const value = read(keys.session);
  return typeof value === "string" ? value : undefined;
}

export function setSession(email: string): void {
  write(keys.session, email);
}

export function clearSession(): void {
  localStorage.removeItem(keys.session);
}

export function loadItems(): Item[] {
  return (read(keys.items) as Item[] | undefined) ?? [];
}

export function createItem(name: string, kind: ItemKind): Item {
  const next = (read(keys.nextId) as number | undefined) ?? 1;
  write(keys.nextId, next + 1);

  const item: Item = { id: `i${String(next)}`, name, kind };
  write(keys.items, [...loadItems(), item]);

  return item;
}

export function deleteItem(id: string): void {
  write(
    keys.items,
    loadItems().filter((item) => item.id !== id),
  );
}

export function findItem(id: string): Item | undefined {
  return loadItems().find((item) => item.id === id);
}

export function loadNotes(itemId: string): Note[] {
  const notes = (read(keys.notes) as Note[] | undefined) ?? [];
  return notes.filter((note) => note.itemId === itemId);
}

export function addNote(itemId: string, text: string): Note {
  const next = (read(keys.nextId) as number | undefined) ?? 1;
  write(keys.nextId, next + 1);

  const note: Note = { id: `n${String(next)}`, itemId, text };
  const notes = (read(keys.notes) as Note[] | undefined) ?? [];
  write(keys.notes, [...notes, note]);

  return note;
}

export function deleteNote(id: string): void {
  const notes = (read(keys.notes) as Note[] | undefined) ?? [];
  write(
    keys.notes,
    notes.filter((note) => note.id !== id),
  );
}

export function loadProfile(): Profile {
  return (
    (read(keys.profile) as Profile | undefined) ?? {
      displayName: "Walker",
      theme: "light",
    }
  );
}

export function saveProfile(profile: Profile): void {
  write(keys.profile, profile);
}

export function resetData(): void {
  localStorage.removeItem(keys.items);
  localStorage.removeItem(keys.notes);
  localStorage.removeItem(keys.nextId);
  localStorage.removeItem(keys.profile);
}
