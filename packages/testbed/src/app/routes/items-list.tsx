import type { ReactElement, SubmitEvent } from "react";
import { useState } from "react";
import { Link, redirect } from "react-router";

import type { Item, ItemKind } from "../data.ts";
import { createItem, deleteItem, getSession, loadItems } from "../data.ts";
import { Modal } from "../modal.tsx";

export function clientLoader(): Response | null {
  return getSession() === undefined ? redirect("/login") : null;
}

export default function ItemsList(): ReactElement {
  const [items, setItems] = useState<Item[]>(loadItems);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Item>();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ItemKind>("gadget");

  const create = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (name === "") {
      return;
    }

    createItem(name, kind);
    setItems(loadItems());
    setName("");
    setKind("gadget");
    setCreating(false);
  };

  const confirmDelete = (): void => {
    if (deleting !== undefined) {
      deleteItem(deleting.id);
      setItems(loadItems());
    }

    setDeleting(undefined);
  };

  return (
    <section>
      <div className="row">
        <h1>Items</h1>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
          }}
        >
          New item
        </button>
      </div>

      {items.length === 0 ? (
        <p className="empty">No items yet.</p>
      ) : (
        <ul className="items" aria-label="Items">
          {items.map((item) => (
            <li key={item.id}>
              <Link to={`/items/${item.id}`}>{item.name}</Link>
              <span className="kind">{item.kind}</span>
              <button
                type="button"
                onClick={() => {
                  setDeleting(item);
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        title="New item"
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
      >
        <form onSubmit={create}>
          <label htmlFor="item-name">Name</label>
          <input
            id="item-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <label htmlFor="item-kind">Kind</label>
          <select
            id="item-kind"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as ItemKind);
            }}
          >
            <option value="gadget">gadget</option>
            <option value="consumable">consumable</option>
            <option value="tool">tool</option>
          </select>
          <div className="row">
            <button type="submit">Create</button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        title={`Delete ${deleting?.name ?? "item"}?`}
        role="alertdialog"
        open={deleting !== undefined}
        onClose={() => {
          setDeleting(undefined);
        }}
      >
        <p>
          Delete <strong>{deleting?.name}</strong>? This cannot be undone.
        </p>
        <div className="row">
          <button type="button" onClick={confirmDelete}>
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              setDeleting(undefined);
            }}
          >
            Cancel
          </button>
        </div>
      </Modal>
    </section>
  );
}
