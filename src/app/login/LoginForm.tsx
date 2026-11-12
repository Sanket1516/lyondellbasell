"use client";
import { useActionState, useState } from "react";
import { loginAction, type LoginState } from "../actions";
import { Button, Input } from "@/components/ui";
import s from "./login.module.css";

interface Account { username: string; password: string; displayName: string; title: string }

export default function LoginForm({ accounts }: { accounts: Account[] }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className={s.page}>
      <aside className={s.hero} aria-hidden="true">
        <div className={s.heroName}><span>Plant X</span><span>Payables</span><span>Desk</span></div>
        <div className={s.run}>
          <div className={s.pipe}><i style={{ background: "var(--band-po)" }} /><b>Purchase order</b></div>
          <div className={s.pipe}><i style={{ background: "var(--band-rc)" }} /><b>Goods receipt</b></div>
          <div className={s.pipe}><i style={{ background: "var(--band-inv)" }} /><b>Invoice</b></div>
        </div>
      </aside>
      <section className={s.card}>
        <h1>Sign in</h1>
        <p className={s.sub}>Sign in with your payables desk account.</p>
        <form action={action} className={s.form}>
          <Input label="Username" name="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          <Input label="Password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          {state.error && <p role="alert" className={s.error}>{state.error}</p>}
          <Button variant="primary" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
        </form>
      </section>

      <section className={s.demo} aria-labelledby="demo-h">
        <h2 id="demo-h">Demo accounts</h2>
        <p className={s.sub}>Prototype with synthetic data. Select an account to fill the form.</p>
        <table className={s.table}>
          <thead><tr><th>Account</th><th>Role</th><th>Password</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.username}>
                <td>
                  <button type="button" className={s.fill} onClick={() => { setUsername(a.username); setPassword(a.password); }}>
                    <span className="mono">{a.username}</span>
                  </button>
                </td>
                <td>{a.title}</td>
                <td className="mono">{a.password}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
