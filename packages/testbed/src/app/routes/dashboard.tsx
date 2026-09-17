import type { ReactElement } from "react";
import { Link, redirect } from "react-router";

import { getSession, loadItems, loadProfile } from "../data.ts";

export function clientLoader(): Response | null {
  return getSession() === undefined ? redirect("/login") : null;
}

export default function Dashboard(): ReactElement {
  const items = loadItems();
  const profile = loadProfile();

  return (
    <section>
      <h1>Dashboard</h1>
      <p>
        Welcome back, <strong>{profile.displayName}</strong>.
      </p>
      <ul className="cards" aria-label="Overview">
        <li>
          <span className="stat">{items.length}</span>
          <Link to="/items">items in stock</Link>
        </li>
        <li>
          <span className="stat">{profile.theme}</span>
          <Link to="/settings">theme</Link>
        </li>
      </ul>
    </section>
  );
}
