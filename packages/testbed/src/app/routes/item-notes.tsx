import type { ReactElement, SubmitEvent } from "react";
import { useState } from "react";
import { useOutletContext } from "react-router";

import type { Item, Note } from "../data.ts";
import { addNote, deleteNote, loadNotes } from "../data.ts";

export default function ItemNotes(): ReactElement {
  const item = useOutletContext<Item>();
  const [notes, setNotes] = useState<Note[]>(() => loadNotes(item.id));
  const [text, setText] = useState("");

  const add = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (text === "") {
      return;
    }

    addNote(item.id, text);
    setNotes(loadNotes(item.id));
    setText("");
  };

  const remove = (id: string): void => {
    deleteNote(id);
    setNotes(loadNotes(item.id));
  };

  return (
    <>
      <h2>Notes</h2>
      <form onSubmit={add}>
        <label htmlFor="note-text">Note</label>
        <input
          id="note-text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <button type="submit">Add note</button>
      </form>
      {notes.length === 0 ? (
        <p className="empty">No notes yet.</p>
      ) : (
        <ul className="notes" aria-label="Notes">
          {notes.map((note) => (
            <li key={note.id}>
              {note.text}
              <button
                type="button"
                onClick={() => {
                  remove(note.id);
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
