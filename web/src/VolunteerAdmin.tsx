import { useState } from "react";

type Save = (
  path: string,
  body: Record<string, string>,
  method?: string,
) => Promise<boolean>;

export function AddVolunteer({ save }: { save: Save }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  function close() {
    setOpen(false);
    setName("");
    setEmail("");
    setPassword("");
  }
  return (
    <div className="volunteer-create">
      <div className="volunteer-toolbar">
        <p>
          Create an approved volunteer account. New devices still need approval.
        </p>
        {!open && (
          <button
            className="primary"
            onClick={() => {
              setNotice("");
              setOpen(true);
            }}
          >
            Add volunteer
          </button>
        )}
      </div>
      {open && (
        <form
          className="volunteer-form"
          aria-label="Add volunteer"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            try {
              if (
                await save("/admin/volunteers", {
                  name: name.trim(),
                  email: email.trim(),
                  password,
                })
              ) {
                setNotice(`${name.trim()} added. Assign their channels below.`);
                close();
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Volunteer name
            <input
              autoFocus
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              required
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
            />
          </label>
          <p className="volunteer-help">
            Use at least 12 characters. Share the sign-in details with the
            volunteer.
          </p>
          <div className="volunteer-actions">
            <button className="primary" disabled={busy}>
              {busy ? "Adding…" : "Create volunteer"}
            </button>
            <button
              type="button"
              className="outline"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {notice && (
        <p className="volunteer-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

export function VolunteerLogin({
  volunteer,
  save,
}: {
  volunteer: { id: string; name: string; email: string };
  save: Save;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(volunteer.email);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const changed =
    email.trim().toLowerCase() !== volunteer.email.toLowerCase() ||
    password.length > 0;
  return (
    <>
      <button
        className="outline"
        aria-label={`Edit login for ${volunteer.name}`}
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          setEmail(volunteer.email);
          setPassword("");
          setNotice("");
          setOpen(!open);
        }}
      >
        Edit login
      </button>
      {open && (
        <form
          className="volunteer-form volunteer-edit"
          aria-label={`Login details for ${volunteer.name}`}
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !changed) return;
            setBusy(true);
            const body: Record<string, string> = {};
            if (email.trim().toLowerCase() !== volunteer.email.toLowerCase())
              body.email = email.trim();
            if (password) body.password = password;
            try {
              if (
                await save(`/admin/volunteers/${volunteer.id}`, body, "PUT")
              ) {
                setNotice(
                  password
                    ? "Sign-in updated. The volunteer must sign in again with the new password."
                    : "Email updated. Channel assignments and history are preserved.",
                );
                setPassword("");
                setOpen(false);
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input
              autoFocus
              type="email"
              required
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
            />
          </label>
          <p className="volunteer-help">
            Leave the password blank to keep it. A new password signs the
            volunteer out of all active sessions.
          </p>
          <div className="volunteer-actions">
            <button className="primary" disabled={busy || !changed}>
              {busy ? "Saving…" : "Save login"}
            </button>
            <button
              className="outline"
              type="button"
              disabled={busy}
              onClick={() => {
                setPassword("");
                setOpen(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {notice && (
        <p className="volunteer-notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
