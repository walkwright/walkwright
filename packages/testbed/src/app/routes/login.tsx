import type { ReactElement, SubmitEvent } from "react";
import { useState } from "react";
import { redirect, useNavigate } from "react-router";

import { getSession, setSession } from "../data.ts";

export function clientLoader(): Response | null {
  return getSession() === undefined ? null : redirect("/");
}

export default function Login(): ReactElement {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (email === "" || password === "") {
      setError("Email and password are both required.");
      return;
    }

    setSession(email);
    void navigate("/");
  };

  return (
    <section className="narrow">
      <h1>Sign in</h1>
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        {error === undefined ? null : <p className="error">{error}</p>}
        <button type="submit">Sign in</button>
      </form>
    </section>
  );
}
