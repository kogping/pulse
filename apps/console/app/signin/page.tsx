"use client";

import { useState, useTransition } from "react";
import { requestMagicLink } from "./actions";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <main>
      <h1>Sign in to the console</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await requestMagicLink(email);
            setMessage(result.message);
          });
        }}
      >
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" disabled={isPending}>
          Send sign-in link
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </main>
  );
}
