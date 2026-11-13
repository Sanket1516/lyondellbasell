"use client";
// Safety net for any page that fails while rendering: a plain message and a retry, never a stack trace or a blank screen.
// The details stay in the server log; the reference code lets the team find the entry.
import Link from "next/link";
import s from "./status.module.css";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className={s.wrap}>
      <div className={s.card} role="alert">
        <p className={s.kicker}>Something went wrong</p>
        <h1>This screen could not be loaded</h1>
        <p>The data is safe and nothing was changed. Try again, or go back to the start page and open it from there.</p>
        <div className={s.actions}>
          <button type="button" className={s.primary} onClick={() => reset()}>Try again</button>
          <Link href="/start" className={s.secondary}>Back to start</Link>
        </div>
        {error.digest && <p className={s.ref}>Reference {error.digest}</p>}
      </div>
    </div>
  );
}
