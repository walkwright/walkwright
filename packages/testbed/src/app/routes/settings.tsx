import type { ReactElement, SubmitEvent } from "react";
import { useState } from "react";
import { redirect } from "react-router";

import { getSession, loadProfile, resetData, saveProfile } from "../data.ts";
import { Modal } from "../modal.tsx";

export function clientLoader(): Response | null {
  return getSession() === undefined ? redirect("/login") : null;
}

export default function Settings(): ReactElement {
  const [profile, setProfile] = useState(loadProfile);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);

  const save = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    saveProfile(profile);
    setSaved(true);
  };

  const confirmReset = (): void => {
    resetData();
    setProfile(loadProfile());
    setSaved(false);
    setResetting(false);
  };

  return (
    <section className="narrow">
      <h1>Settings</h1>
      <form onSubmit={save}>
        <label htmlFor="display-name">Display name</label>
        <input
          id="display-name"
          value={profile.displayName}
          onChange={(event) => {
            setProfile({ ...profile, displayName: event.target.value });
            setSaved(false);
          }}
        />
        <label htmlFor="theme">Theme</label>
        <select
          id="theme"
          value={profile.theme}
          onChange={(event) => {
            setProfile({
              ...profile,
              theme: event.target.value as "light" | "dark",
            });
            setSaved(false);
          }}
        >
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
        <div className="row">
          <button type="submit">Save</button>
          {saved ? <span className="saved">Saved.</span> : null}
        </div>
      </form>

      <h2>Danger</h2>
      <button
        type="button"
        onClick={() => {
          setResetting(true);
        }}
      >
        Reset data
      </button>

      <Modal
        title="Reset data"
        role="alertdialog"
        open={resetting}
        onClose={() => {
          setResetting(false);
        }}
      >
        <p>Every item and this profile will be wiped. Continue?</p>
        <div className="row">
          <button type="button" onClick={confirmReset}>
            Reset
          </button>
          <button
            type="button"
            onClick={() => {
              setResetting(false);
            }}
          >
            Cancel
          </button>
        </div>
      </Modal>
    </section>
  );
}
