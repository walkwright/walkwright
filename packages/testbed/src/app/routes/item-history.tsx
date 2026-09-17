import type { ReactElement } from "react";
import { useOutletContext } from "react-router";

import type { Item } from "../data.ts";
import { loadNotes } from "../data.ts";

export default function ItemHistory(): ReactElement {
  const item = useOutletContext<Item>();
  const notes = loadNotes(item.id);

  return (
    <>
      <h2>History</h2>
      <ul className="history" aria-label="History">
        <li>created as a {item.kind}</li>
        {notes.map((note) => (
          <li key={note.id}>note added: {note.text}</li>
        ))}
      </ul>
    </>
  );
}
