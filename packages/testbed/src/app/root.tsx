import type { ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LinksFunction } from "react-router";
import {
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router";

import { clearSession, getSession } from "./data.ts";
import styles from "./styles.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export function Layout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>walkshop</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function HydrateFallback(): ReactElement {
  return <p className="loading">loading…</p>;
}

export default function App(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const authed = getSession() !== undefined;

  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [morePosition, setMorePosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    document.documentElement.dataset["hydrated"] = "true";
  }, []);

  useEffect(() => {
    if (!moreOpen) {
      return;
    }

    const button = moreButtonRef.current;
    if (button !== null) {
      const rect = button.getBoundingClientRect();
      setMorePosition({ top: rect.bottom + 4, left: rect.left });
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setMoreOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return (): void => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  const signOut = (): void => {
    clearSession();
    void navigate("/login");
  };

  const goToViaMore = (path: string): void => {
    setMoreOpen(false);
    void navigate(path);
  };

  return (
    <>
      <header className="topbar">
        <strong>walkshop</strong>
        {authed && location.pathname !== "/login" ? (
          <nav>
            <Link to="/">dashboard</Link>
            <Link to="/items">items</Link>
            <Link to="/settings">settings</Link>
            <button
              type="button"
              className="linkish"
              ref={moreButtonRef}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => {
                setMoreOpen((open) => !open);
              }}
            >
              More
            </button>
            <button type="button" className="linkish" onClick={signOut}>
              sign out
            </button>
          </nav>
        ) : null}
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="build-stamp">
        rendered {new Date().toISOString()}
      </footer>
      {moreOpen
        ? createPortal(
            <div
              role="menu"
              aria-label="More"
              className="more-menu"
              style={{ top: morePosition.top, left: morePosition.left }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  goToViaMore("/");
                }}
              >
                Dashboard
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  goToViaMore("/settings");
                }}
              >
                Settings
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
