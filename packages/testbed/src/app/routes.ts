import type { RouteConfig } from "@react-router/dev/routes";
import { index, route } from "@react-router/dev/routes";

export default [
  index("routes/dashboard.tsx"),
  route("login", "routes/login.tsx"),
  route("items", "routes/items-list.tsx"),
  route("items/:id", "routes/item-layout.tsx", [
    index("routes/item-detail.tsx"),
    route("notes", "routes/item-notes.tsx"),
    route("history", "routes/item-history.tsx"),
  ]),
  route("settings", "routes/settings.tsx"),
] satisfies RouteConfig;
