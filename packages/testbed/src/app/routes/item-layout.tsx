import type { ReactElement } from "react";
import { Link, NavLink, Outlet, redirect, useParams } from "react-router";

import { findItem, getSession } from "../data.ts";

export function clientLoader(): Response | null {
  return getSession() === undefined ? redirect("/login") : null;
}

export default function ItemLayout(): ReactElement {
  const { id } = useParams<"id">();
  const item = id === undefined ? undefined : findItem(id);

  if (item === undefined) {
    return (
      <section>
        <h1>Not found</h1>
        <Link to="/items">Back to items</Link>
      </section>
    );
  }

  return (
    <section>
      <Link to="/items">Back to items</Link>
      <h1>{item.name}</h1>
      <nav className="tabs" aria-label="Item sections">
        <NavLink to={`/items/${item.id}`} end>
          Details
        </NavLink>
        <NavLink to={`/items/${item.id}/notes`}>Notes</NavLink>
        <NavLink to={`/items/${item.id}/history`}>History</NavLink>
      </nav>
      <Outlet context={item} />
    </section>
  );
}
