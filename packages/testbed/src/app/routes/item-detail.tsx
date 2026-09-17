import type { ReactElement } from "react";
import { useOutletContext } from "react-router";

import type { Item } from "../data.ts";

export default function ItemDetail(): ReactElement {
  const item = useOutletContext<Item>();

  return (
    <>
      <h2>Details</h2>
      <dl>
        <dt>Kind</dt>
        <dd>{item.kind}</dd>
        <dt>Id</dt>
        <dd>{item.id}</dd>
      </dl>
    </>
  );
}
