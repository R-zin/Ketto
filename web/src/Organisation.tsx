import { useState } from "react";
import { Plus, RefreshCw, MessageSquare } from "lucide-react";
import { api } from "./api";
import type { useOperations } from "./Operations";

export default function Organisation({
  overview,
  user,
  ops,
  refresh,
  onConversation,
  onPrivate,
  report,
}: {
  overview: any;
  user: any;
  ops: ReturnType<typeof useOperations>;
  refresh: () => Promise<void>;
  onConversation: (id: string) => void;
  onPrivate: (id: string) => void;
  report: (error: any) => void;
}) {
  const [tab, setTab] = useState("People"),
    [expanded, setExpanded] = useState(""),
    [channelName, setChannelName] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      await fn();
      await Promise.all([refresh(), ops.refresh()]);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  if (!overview) return <p className="empty">Loading organisation…</p>;
  const pending = overview.users.filter(
    (u: any) => !u.approved || u.devices.some((d: any) => !d.approved),
  );
  const showDevices = (u: any, onlyPending = false) => (
    <div className="organisation-devices">
      {u.devices
        .filter((d: any) => !onlyPending || !d.approved)
        .map((d: any) => (
          <div className="organisation-row" key={d.id}>
            <div>
              <strong>{d.name}</strong>
              <small>
                {d.approved
                  ? d.online
                    ? d.onDuty
                      ? "On duty"
                      : "Off duty"
                    : "Offline"
                  : "Awaiting device approval"}
                {d.busy ? " · In a call" : ""}
              </small>
            </div>
            {d.id !== user.device && (
              <button
                className="outline"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    api(`/admin/devices/${d.id}/approval`, {
                      approved: !d.approved,
                    }),
                  )
                }
              >
                {d.approved ? "Revoke device" : "Approve device"}
              </button>
            )}
          </div>
        ))}
    </div>
  );
  return (
    <section className="organisation-workspace">
      <div className="page-title">
        <h1>Organisation</h1>
        <button
          className="outline"
          disabled={busy}
          onClick={() => void run(refresh)}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      <div
        className="organisation-tabs"
        role="tablist"
        aria-label="Organisation sections"
      >
        {["People", "Channels", "Approvals"].map((name) => (
          <button
            key={name}
            id={`org-${name}`}
            role="tab"
            aria-selected={tab === name}
            aria-controls="organisation-content"
            className={tab === name ? "active" : ""}
            onClick={() => {
              setTab(name);
              setExpanded("");
            }}
          >
            {name}
            {name === "Approvals" && pending.length > 0 && (
              <span className="count-badge">{pending.length}</span>
            )}
          </button>
        ))}
      </div>
      <div
        id="organisation-content"
        role="tabpanel"
        aria-labelledby={`org-${tab}`}
        className="organisation-panel"
      >
        {tab === "People" &&
          overview.users.map((u: any) => (
            <div className="organisation-person" key={u.id}>
              <div className="organisation-row">
                <div>
                  <strong>{u.name}</strong>
                  <small>
                    {u.email} · {u.role === "admin" ? "Admin" : "Volunteer"}
                  </small>
                </div>
                <span className="status-chip">
                  {u.approved ? "Approved" : "Pending"}
                </span>
                <div className="row-actions">
                  {u.approved && u.id !== user.id && (
                    <button
                      className="outline"
                      onClick={() => onPrivate(u.id)}
                      aria-label={`Message ${u.name}`}
                    >
                      <MessageSquare size={15} />
                      Message
                    </button>
                  )}
                  <button
                    className="outline"
                    aria-expanded={expanded === u.id}
                    onClick={() => setExpanded(expanded === u.id ? "" : u.id)}
                  >
                    Manage
                  </button>
                </div>
              </div>
              {expanded === u.id && (
                <div className="person-management">
                  {u.id !== user.id && (
                    <button
                      className="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api(`/admin/users/${u.id}/approval`, {
                            approved: !u.approved,
                          }),
                        )
                      }
                    >
                      {u.approved ? "Revoke member" : "Approve member"}
                    </button>
                  )}
                  {showDevices(u)}
                </div>
              )}
            </div>
          ))}
        {tab === "Channels" && (
          <>
            <form
              className="inline-form panel-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api("/admin/operational-teams", { name: channelName });
                  setChannelName("");
                });
              }}
            >
              <input
                aria-label="New channel name"
                required
                minLength={2}
                placeholder="New channel name"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
              />
              <button className="primary" disabled={busy || !ops.live}>
                <Plus size={15} />
                New channel
              </button>
            </form>
            {overview.channels.map((c: any) => (
              <div key={c.id} className="organisation-person">
                <div className="organisation-row">
                  <div>
                    <strong>{c.name}</strong>
                    <small>
                      {c.kind === "broadcast" ? "Broadcast" : "Channel"} ·{" "}
                      {c.memberIds.length} members
                    </small>
                  </div>
                  <div className="row-actions">
                    <button
                      className="outline"
                      onClick={() => onConversation(c.id)}
                    >
                      Open
                    </button>
                    {c.kind === "channel" && (
                      <button
                        className="outline"
                        aria-expanded={expanded === c.id}
                        onClick={() =>
                          setExpanded(expanded === c.id ? "" : c.id)
                        }
                      >
                        Manage volunteers
                      </button>
                    )}
                  </div>
                </div>
                {expanded === c.id &&
                  (() => {
                    const assignment = (ops.data?.teams || []).find(
                      (t: any) => t.channel_id === c.id,
                    );
                    const volunteers = overview.users.filter(
                      (u: any) =>
                        u.approved && (!assignment || u.role === "staff"),
                    );
                    return (
                      <div className="panel-form channel-volunteers">
                        <h2>Manage volunteers</h2>
                        {assignment && (
                          <p className="channel-assignment-note">
                            Volunteers can belong to multiple channels. Changes
                            here affect only this channel.
                          </p>
                        )}
                        {volunteers.map((u: any) => {
                          const memberships =
                            ops.data?.volunteers.find((v: any) => v.id === u.id)
                              ?.channelMemberships || [];
                          const checked = assignment
                            ? memberships.some(
                                (t: any) => t.id === assignment.id,
                              )
                            : c.memberIds.includes(u.id);
                          return (
                            <label className="assignment-row" key={u.id}>
                              <span>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={busy || !ops.live}
                                  onChange={(e) => {
                                    const add = e.target.checked;
                                    void run(() =>
                                      assignment
                                        ? api(
                                            `/admin/operational-assignments/${u.id}`,
                                            {
                                              teamId: assignment.id,
                                              assigned: add,
                                            },
                                            "PUT",
                                          )
                                        : api(
                                            `/admin/channels/${c.id}/members`,
                                            {
                                              memberIds: add
                                                ? [...c.memberIds, u.id]
                                                : c.memberIds.filter(
                                                    (id: string) => id !== u.id,
                                                  ),
                                            },
                                            "PUT",
                                          ),
                                    );
                                  }}
                                />
                                {u.name}
                              </span>
                              {assignment && (
                                <small>
                                  {memberships
                                    .map((t: any) => t.name)
                                    .join(", ") || "Unassigned"}
                                </small>
                              )}
                            </label>
                          );
                        })}
                        {!volunteers.length && (
                          <p className="empty">
                            No approved volunteers to assign.
                          </p>
                        )}
                      </div>
                    );
                  })()}
              </div>
            ))}
          </>
        )}
        {tab === "Approvals" && (
          <>
            {!pending.length && <p className="empty">No pending approvals.</p>}
            {pending.map((u: any) => (
              <div className="organisation-person" key={u.id}>
                <div className="organisation-row">
                  <div>
                    <strong>{u.name}</strong>
                    <small>{u.email}</small>
                  </div>
                  {!u.approved && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api(`/admin/users/${u.id}/approval`, {
                            approved: true,
                          }),
                        )
                      }
                    >
                      Approve member
                    </button>
                  )}
                </div>
                {showDevices(u, true)}
              </div>
            ))}
          </>
        )}
      </div>
      {tab === "Channels" && (
        <details className="account-details">
          <summary>Duty administrator</summary>
          <p>Current: {ops.data?.dutyAdmin?.name || "Not designated"}</p>
          <button
            className="outline"
            disabled={busy || !ops.live}
            onClick={() =>
              void run(() =>
                api(
                  "/admin/duty-admin",
                  { userId: user.id, deviceId: user.device },
                  "PUT",
                ),
              )
            }
          >
            Use this browser as duty admin
          </button>
        </details>
      )}
    </section>
  );
}
