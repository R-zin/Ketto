import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  operationQueue,
  operationCache,
  phaseFile,
  phaseUpload,
  type Operation,
} from "./api";
import {
  MapPin,
  Plus,
  MessageSquare,
  Radio,
  Shield,
  RefreshCw,
  Check,
  AlertTriangle,
} from "lucide-react";
import { exampleFloors, examplePlanImage } from "./exampleVenue";

const ago = (at: number) => {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  return minutes < 1
    ? "just now"
    : minutes < 60
      ? `${minutes}m ago`
      : `${Math.floor(minutes / 60)}h ago`;
};
const status = (s: string) => s.replaceAll("_", " ");
export function useOperations(user: any, canSync: boolean) {
  const [data, setData] = useState<any>(),
    [live, setLive] = useState(false),
    [pending, setPending] = useState<Operation[]>([]),
    [error, setError] = useState("");
  const gate = useRef(false),
    active = useRef(user?.id);
  active.current = user?.id;
  const refresh = useCallback(async () => {
    if (!user) return;
    const owner = user.id;
    try {
      const d = await api("/operations");
      if (active.current !== owner) return;
      const old = await operationCache.get(owner + ":operations");
      for (const x of old?.issues || [])
        if (!d.issues.some((n: any) => n.id === x.id)) {
          await operationCache.remove(owner + ":thread:" + x.id);
          if (x.photo_id)
            await operationCache.remove(owner + ":image:" + x.photo_id);
        }
      const images = new Set(
        [
          ...d.floors.map((f: any) => f.image_id),
          ...d.issues.map((x: any) => x.photo_id),
        ].filter(Boolean),
      );
      const prefix = owner + ":image:";
      for (const key of await operationCache.keys())
        if (
          typeof key === "string" &&
          key.startsWith(prefix) &&
          !images.has(key.slice(prefix.length))
        )
          await operationCache.remove(key);
      await operationCache.put(owner + ":operations", d);
      setData(d);
      setLive(true);
      return d;
    } catch {
      if (active.current === owner) setLive(false);
    }
  }, [user?.id]);
  const reloadPending = useCallback(async () => {
    setPending(
      (await operationQueue.all()).filter((p) => p.owner === user?.id),
    );
  }, [user?.id]);
  const flush = useCallback(async () => {
    if (!user || !canSync || gate.current) return;
    gate.current = true;
    try {
      for (const o of (await operationQueue.all()).filter(
        (p) => p.owner === user.id && p.state === "pending",
      )) {
        if (active.current !== user.id) break;
        try {
          await api(o.path, o.body);
          if (active.current !== user.id) break;
          if (o.photo && o.attachmentPath)
            await phaseUpload(
              o.attachmentPath,
              o.photo,
              o.photoName || "issue.jpg",
            );
          await operationQueue.remove(o.id);
        } catch (e: any) {
          if ([400, 403, 404, 409].includes(e.status)) {
            await operationQueue.put({
              ...o,
              state: "rejected",
              error: e.message,
            });
            continue;
          }
          break;
        }
      }
      await reloadPending();
      await refresh();
    } finally {
      gate.current = false;
    }
  }, [user?.id, canSync, refresh, reloadPending]);
  const enqueue = useCallback(
    async (path: string, body: any, photo?: Blob) => {
      if (!user) return;
      await operationQueue.put({
        id: body.id,
        owner: user.id,
        path,
        body,
        state: "pending",
        queuedAt: Date.now(),
        photo,
        photoName: photo instanceof File ? photo.name : undefined,
        attachmentPath: photo ? "issues/" + body.id : undefined,
      });
      await reloadPending();
      await flush();
    },
    [user?.id, reloadPending, flush],
  );
  useEffect(() => {
    if (!user) {
      setData(undefined);
      return;
    }
    let cancelled = false;
    operationCache.get(user.id + ":operations").then((d) => {
      if (!cancelled && active.current === user.id) setData(d);
    });
    void refresh();
    void reloadPending();
    const tick = setInterval(() => {
      void refresh();
      void flush();
    }, 15000);
    const listener = () => {
      void refresh();
      void flush();
    };
    window.addEventListener("kettoo-operations", listener);
    return () => {
      cancelled = true;
      clearInterval(tick);
      window.removeEventListener("kettoo-operations", listener);
    };
  }, [user?.id, refresh, flush, reloadPending]);
  useEffect(() => {
    void flush();
  }, [flush]);
  return {
    data,
    live,
    pending,
    error,
    setError,
    refresh,
    enqueue,
    flush,
    reloadPending,
  };
}
export function OperationImage({
  id,
  owner,
  online,
  onPoint,
  alt = "Venue floor plan",
}: {
  id: string;
  owner: string;
  online: boolean;
  onPoint?: (x: number, y: number) => void;
  alt?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let done = false,
      link = "";
    (async () => {
      const k = owner + ":image:" + id;
      let blob = await operationCache.get<Blob>(k);
      if (online) {
        try {
          blob = await phaseFile(id);
          await operationCache.put(k, blob);
        } catch {}
      }
      if (blob && !done) {
        link = URL.createObjectURL(blob);
        setUrl(link);
      }
    })();
    return () => {
      done = true;
      if (link) URL.revokeObjectURL(link);
    };
  }, [id, owner, online]);
  return url ? (
    <img
      src={url}
      alt={alt}
      onClick={(e) => {
        const b = e.currentTarget.getBoundingClientRect();
        onPoint?.(
          (e.clientX - b.left) / b.width,
          (e.clientY - b.top) / b.height,
        );
      }}
    />
  ) : (
    <div className="map-empty">Image unavailable in this cache.</div>
  );
}
export function LocationControl({
  ops,
}: {
  ops: ReturnType<typeof useOperations>;
}) {
  const [open, setOpen] = useState(false),
    [floor, setFloor] = useState("");
  const d = ops.data;
  if (!d) return null;
  return (
    <div className="location-control">
      <button className="outline" onClick={() => setOpen(!open)}>
        <MapPin size={16} />
        {d.checkin?.zone_name || "My location · unknown"}
      </button>
      {d.checkin && <small>Last reported {ago(d.checkin.reported_at)}</small>}
      {open && (
        <div className="location-sheet">
          <label>
            Floor
            <select value={floor} onChange={(e) => setFloor(e.target.value)}>
              <option value="">Choose floor</option>
              {d.floors.map((f: any) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <div className="zone-choices">
            {d.zones
              .filter((z: any) => z.floor_id === floor)
              .map((z: any) => (
                <button
                  className="outline"
                  key={z.id}
                  onClick={() => {
                    void ops.enqueue("/checkins", {
                      id: crypto.randomUUID(),
                      zoneId: z.id,
                      reportedAt: Date.now(),
                    });
                    setOpen(false);
                  }}
                >
                  {z.name}
                </button>
              ))}
          </div>
          <small>
            Updates queue when the server is unavailable. Team membership stays
            the same.
          </small>
        </div>
      )}
    </div>
  );
}
export function CommunicationPanel({
  ops,
  user,
  onConversation,
}: {
  ops: ReturnType<typeof useOperations>;
  user: any;
  onConversation: (cid: string) => void;
}) {
  const d = ops.data,
    [selected, setSelected] = useState<string[]>([]),
    [everyone, setEveryone] = useState(false),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!d?.exchange) return;
    const t = setInterval(
      () => void api("/admin-exchange/renew", {}).catch(() => ops.refresh()),
      30000,
    );
    return () => clearInterval(t);
  }, [d?.exchange?.id]);
  if (!d) return null;
  const run = async (fn: () => Promise<any>) => {
    setLoading(true);
    try {
      await fn();
      await ops.refresh();
      window.dispatchEvent(new Event("kettoo-permissions"));
    } catch (e: any) {
      ops.setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="communication-dock">
      <div className="mobile-location">
        <LocationControl ops={ops} />
      </div>
      <div className="dock-assignment">
        <span className="eyebrow">
          {user.role === "admin"
            ? "DUTY ADMIN / LIVE COMMS"
            : "YOUR ASSIGNMENT"}
        </span>
        <strong>
          {(d.channelMemberships || []).map((t: any) => t.name).join(", ") ||
            (user.role === "admin" ? "Control room" : "Team unassigned")}
        </strong>
        <small>
          Duty admin: {d.dutyAdmin?.name || "Not designated"} ·{" "}
          {d.dutyAdmin?.reachable
            ? d.dutyAdmin.busy
              ? "Busy"
              : "Available"
            : "Unavailable"}
        </small>
      </div>
      <div className="dock-actions">
        {(d.channelMemberships || []).map((t: any) => (
          <button
            key={t.id}
            className="primary"
            onClick={() => onConversation(t.channel_id)}
          >
            <Radio size={16} />
            {t.name} PTT
          </button>
        ))}
        {user.role !== "admin" && !d.exchange && (
          <button
            className="outline"
            disabled={!ops.live || loading || !d.dutyAdmin?.reachable}
            onClick={() =>
              void run(async () => {
                const e = await api("/admin-exchange", {});
                onConversation(e.conversation_id);
              })
            }
          >
            <Shield size={16} />
            Talk to admin
          </button>
        )}
        {d.exchange && (
          <>
            <button
              className="primary"
              onClick={() => onConversation(d.exchange.conversation_id)}
            >
              Private exchange · {d.exchange.volunteer?.name || "Duty admin"}
            </button>
            <button
              className="outline"
              disabled={!ops.live}
              onClick={() => void run(() => api("/admin-exchange/end", {}))}
            >
              End exchange
            </button>
          </>
        )}
      </div>
      {user.role === "admin" && (
        <div className="broadcast-selector">
          <strong>Broadcast audience</strong>
          <label>
            <input
              type="checkbox"
              checked={everyone}
              onChange={(e) => setEveryone(e.target.checked)}
            />
            Everyone
          </label>
          {d.teams.map((t: any) => (
            <label key={t.id}>
              <input
                type="checkbox"
                disabled={everyone}
                checked={selected.includes(t.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, t.id]
                      : selected.filter((x) => x !== t.id),
                  )
                }
              />
              {t.name}
            </label>
          ))}
          <button
            className="primary"
            disabled={
              !ops.live ||
              loading ||
              (!everyone && !selected.length) ||
              !!d.exchange
            }
            onClick={() =>
              void run(async () => {
                const b = await api("/admin/broadcasts", {
                  teamIds: selected,
                  everyone,
                });
                onConversation(b.id);
              })
            }
          >
            Prepare broadcast
          </button>
          <small>
            Wait for AUDIO CONNECTED before holding TALK. Finish private
            exchanges first.
          </small>
          {(d.broadcasts || []).map((b: any) => (
            <div key={b.conversation_id} className="dock-actions">
              <button
                className="outline"
                onClick={() => onConversation(b.conversation_id)}
              >
                Open {b.name}
              </button>
              <button
                className="outline"
                disabled={!ops.live || loading}
                onClick={() =>
                  void run(() =>
                    api("/admin/broadcasts/" + b.conversation_id + "/end", {}),
                  )
                }
              >
                End broadcast
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
export default function Operations({
  ops,
  user,
  page,
  onConversation,
  onManageChannels,
}: {
  ops: ReturnType<typeof useOperations>;
  user: any;
  page: string;
  onConversation: (cid: string) => void;
  onManageChannels?: () => void;
}) {
  const [floor, setFloor] = useState(""),
    [zone, setZone] = useState<any>(),
    [thread, setThread] = useState<any>(),
    [filter, setFilter] = useState("open"),
    [create, setCreate] = useState(false),
    [floorName, setFloorName] = useState(""),
    [creatingFloor, setCreatingFloor] = useState(false),
    [removingZone, setRemovingZone] = useState(false),
    [savingZone, setSavingZone] = useState(false),
    [manageVenue, setManageVenue] = useState(false),
    [placing, setPlacing] = useState(false),
    [zoneName, setZoneName] = useState(""),
    [zoneEdit, setZoneEdit] = useState(false),
    [reply, setReply] = useState(""),
    [examplesVisible, setExamplesVisible] = useState(
      () => localStorage.getItem("kettoo.example-maps." + user.id) !== "hidden",
    );
  const [hiddenExampleFloors, setHiddenExampleFloors] = useState<string[]>(
    () => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("kettoo.hidden-example-floors." + user.id) ||
            "[]",
        );
        return Array.isArray(saved)
          ? saved.filter((id) => typeof id === "string")
          : [];
      } catch {
        return [];
      }
    },
  );
  const [removingFloor, setRemovingFloor] = useState(false);
  const [savingExample, setSavingExample] = useState(false);
  const d = ops.data;
  const visibleExampleFloors = examplesVisible
    ? exampleFloors.filter(
        (f) =>
          !hiddenExampleFloors.includes(f.id) &&
          !d?.floors.some((saved: any) => saved.id === f.id),
      )
    : [];
  const floors = [...(d?.floors || []), ...visibleExampleFloors];
  const toggleExamples = (visible: boolean) => {
    if (visible) {
      setHiddenExampleFloors([]);
      localStorage.removeItem("kettoo.hidden-example-floors." + user.id);
    }
    localStorage.setItem(
      "kettoo.example-maps." + user.id,
      visible ? "visible" : "hidden",
    );
    setExamplesVisible(visible);
    setZone(undefined);
    setZoneEdit(false);
    setPlacing(false);
    setFloor(
      visible
        ? exampleFloors[0].id
        : d?.floors.find((f: any) => f.image_id)?.id || d?.floors[0]?.id || "",
    );
  };
  useEffect(() => {
    if (d && !floors.some((f: any) => f.id === floor))
      setFloor(
        d.floors.find((f: any) => f.image_id)?.id ||
          d.floors[0]?.id ||
          (examplesVisible
            ? exampleFloors.find((f) => !hiddenExampleFloors.includes(f.id))?.id
            : "") ||
          "",
      );
  }, [d?.floors, floor, examplesVisible, hiddenExampleFloors]);
  const run = async (fn: () => Promise<any>) => {
    ops.setError("");
    try {
      await fn();
      await ops.refresh();
      window.dispatchEvent(new Event("kettoo-permissions"));
    } catch (e: any) {
      ops.setError(e.message);
    }
  };
  const saveExampleVenue = async () => {
    setSavingExample(true);
    ops.setError("");
    try {
      const images = await Promise.all(
        exampleFloors.map((f) => examplePlanImage(f.image)),
      );
      const result = await api("/admin/venue-template", {
        floors: exampleFloors.map((f) => ({
          id: f.id,
          name: f.name,
          zones: f.zones.map((z) => ({
            id: z.id,
            name: z.name,
            x: z.x,
            y: z.y,
          })),
        })),
      });
      for (let index = 0; index < exampleFloors.length; index++) {
        const f = exampleFloors[index];
        if (!result.floors.find((saved: any) => saved.id === f.id)?.image_id)
          await phaseUpload("floors/" + f.id, images[index], f.id + ".png");
      }
      await ops.refresh();
      toggleExamples(false);
      setFloor(exampleFloors[0].id);
      window.dispatchEvent(new Event("kettoo-operations"));
    } catch (e: any) {
      ops.setError(
        e.message +
          " You can retry saving the example without creating duplicate floors.",
      );
      await ops.refresh();
    } finally {
      setSavingExample(false);
    }
  };
  const openThread = async (iid: string) => {
    try {
      const t = ops.live
        ? await api("/threads/" + iid)
        : await operationCache.get(user.id + ":thread:" + iid);
      if (!t)
        throw new Error("Thread detail is not cached. Reconnect to open it.");
      await operationCache.put(user.id + ":thread:" + iid, t);
      setThread(t);
    } catch (e: any) {
      ops.setError(e.message);
    }
  };
  useEffect(() => {
    if (thread && d && !d.issues.some((x: any) => x.id === thread.id))
      setThread(undefined);
    else if (thread && ops.live) void openThread(thread.id);
  }, [d?.serverAt]);
  if (!d)
    return (
      <div className="empty-operations">
        Connect to the organisation server to load maps and threads.
      </div>
    );
  const people = d.people || d.volunteers;
  const current = floors.find((f: any) => f.id === floor),
    zones = current?.demo
      ? current.zones
      : d.zones
          .filter((z: any) => z.floor_id === floor)
          .map((z: any) => ({
            ...z,
            volunteers: z.onDutyPeople ?? z.volunteers,
            reportedPeople:
              z.reportedPeople ??
              people.filter((u: any) => u.checkin?.zone_id === z.id).length,
          })),
    activeZone = zone ? zones.find((z: any) => z.id === zone.id) : null;
  const issues = d.issues.filter(
    (x: any) =>
      filter === "all" ||
      (filter === "open" && x.status !== "resolved") ||
      (filter === "team" &&
        (user.role === "admin"
          ? x.audience === "team"
          : (d.channelMemberships || []).some(
              (t: any) => t.id === x.team_id,
            ))) ||
      (filter === "mine" && x.owner_id === user.id),
  );
  const removeFloor = () => {
    if (!current) return;
    if (current.demo) {
      const hidden = [...new Set([...hiddenExampleFloors, current.id])];
      localStorage.setItem(
        "kettoo.hidden-example-floors." + user.id,
        JSON.stringify(hidden),
      );
      setHiddenExampleFloors(hidden);
      setFloor(
        exampleFloors.find((f) => !hidden.includes(f.id))?.id ||
          d.floors[0]?.id ||
          "",
      );
      setZone(undefined);
      setZoneEdit(false);
      setPlacing(false);
      return;
    }
    const locations = people.filter(
      (v: any) => v.checkin?.floor_id === current.id,
    ).length;
    if (
      !window.confirm(
        `Remove "${current.name}"?\n\nIts floor plan and ${zones.length} zone(s) will be removed. ${locations} reported volunteer location(s) will be cleared. Issue threads and their replies will be kept.\n\nThis cannot be undone.`,
      )
    )
      return;
    setRemovingFloor(true);
    void run(async () => {
      try {
        await api("/admin/floors/" + current.id, undefined, "DELETE");
        setZone(undefined);
        setPlacing(false);
        setZoneEdit(false);
      } finally {
        setRemovingFloor(false);
      }
    });
  };
  const removeZone = async () => {
    if (!activeZone || activeZone.demo || removingZone) return;
    if (
      !window.confirm(
        `Remove “${activeZone.name}”? Its reported locations will be cleared. Issue threads and replies are kept. This cannot be undone.`,
      )
    )
      return;
    setRemovingZone(true);
    try {
      await run(async () => {
        await api("/admin/zones/" + activeZone.id, undefined, "DELETE");
        setZone(undefined);
        setZoneEdit(false);
      });
    } finally {
      setRemovingZone(false);
    }
  };
  return (
    <div className="operations">
      <div className="page-title">
        <div>
          <span className="eyebrow">
            OPERATIONS / {page === "map" ? "VENUE" : "ISSUE THREADS"}
          </span>
          <h1>
            {page === "map" ? "The venue, at a glance." : "Follow through."}
          </h1>
        </div>
        {page === "map" && user.role === "admin" ? (
          <button
            className="outline"
            aria-expanded={manageVenue}
            onClick={() => setManageVenue(!manageVenue)}
          >
            {manageVenue ? "Done" : "Manage venue"}
          </button>
        ) : (
          <button className="outline" onClick={() => void ops.refresh()}>
            <RefreshCw size={15} />
            Refresh
          </button>
        )}
      </div>
      {(!ops.live || ops.pending.length > 0) && (
        <div className="sync-strip stale">
          {!ops.live
            ? "Showing cached data · Server unavailable"
            : "Updates pending"}{" "}
          · {ops.pending.length} queued/rejected updates
        </div>
      )}
      {ops.error && (
        <div className="notice error" role="alert">
          {ops.error}
          <button onClick={() => ops.setError("")}>×</button>
        </div>
      )}
      {page === "map" ? (
        <>
          {!current?.demo && (
            <div className="operation-stats">
              <div>
                <b>
                  {people.filter((u: any) => u.connected && u.onDuty).length}
                </b>
                Connected on duty
              </div>
              <div>
                <b>
                  {d.issues.filter((x: any) => x.status !== "resolved").length}
                </b>
                Unresolved issues
              </div>
              <div>
                <b>{people.filter((u: any) => !u.checkin).length}</b>
                Location unknown
              </div>
            </div>
          )}
          <div className="venue-example-controls">
            {current &&
              !current.demo &&
              exampleFloors.some((f) => f.id === current.id) && (
                <span className="example-map-label">
                  Shared college test venue · Available on mobile · Choose a
                  floor and zone to check in
                </span>
              )}
            {user.role === "admin" &&
              exampleFloors.some(
                (f) =>
                  !d.floors.some(
                    (saved: any) => saved.id === f.id && saved.image_id,
                  ),
              ) && (
                <button
                  className="primary"
                  disabled={!ops.live || savingExample}
                  onClick={() => void saveExampleVenue()}
                >
                  {savingExample
                    ? "Saving shared venue…"
                    : "Save college example as shared venue"}
                </button>
              )}
            {current?.demo ? (
              <>
                <span className="example-map-label">
                  College hackathon · Preview only · Not available on mobile
                </span>
                <div className="row-actions">
                  {d.floors.length > 0 && (
                    <button
                      className="outline"
                      onClick={() => {
                        setFloor(d.floors[0].id);
                        setZone(undefined);
                      }}
                    >
                      Your venue
                    </button>
                  )}
                  <button
                    className="outline"
                    onClick={() => toggleExamples(false)}
                  >
                    Hide example maps
                  </button>
                </div>
              </>
            ) : (
              !exampleFloors.every((f) =>
                d.floors.some((saved: any) => saved.id === f.id),
              ) && (
                <button
                  className="outline"
                  onClick={() => toggleExamples(true)}
                >
                  View college hackathon example
                </button>
              )
            )}
          </div>
          <div className="map-layout">
            <section className="map-panel">
              <div className="map-toolbar">
                <label>
                  Floor
                  <select
                    value={floor}
                    disabled={!floors.length}
                    onChange={(e) => {
                      setFloor(e.target.value);
                      setZone(undefined);
                      setZoneEdit(false);
                      setPlacing(false);
                    }}
                  >
                    {d.floors.length > 0 && (
                      <optgroup label="Your venue">
                        {d.floors.map((f: any) => (
                          <option value={f.id} key={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {visibleExampleFloors.length > 0 && (
                      <optgroup label="College hackathon example">
                        {visibleExampleFloors.map((f) => (
                          <option value={f.id} key={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
                {manageVenue &&
                  user.role === "admin" &&
                  current?.image_id &&
                  !current.demo && (
                    <button
                      className="outline"
                      onClick={() => setPlacing(!placing)}
                    >
                      {placing ? "Cancel placement" : "Place zone marker"}
                    </button>
                  )}
              </div>
              {manageVenue && placing && !current?.demo && (
                <label className="zone-placement">
                  Zone name
                  <input
                    value={zoneName}
                    onChange={(e) => setZoneName(e.target.value)}
                    placeholder="Stage, Entrance…"
                  />
                  Click the image to place the marker.
                </label>
              )}
              <div className="floor-frame">
                {current?.image_id || current?.demo ? (
                  <div className="floor-image">
                    {current.demo ? (
                      <img
                        src={current.image}
                        alt={"Example college hackathon map: " + current.name}
                      />
                    ) : (
                      <OperationImage
                        id={current.image_id}
                        owner={user.id}
                        online={ops.live}
                        onPoint={(x, y) => {
                          if (placing && zoneName.trim())
                            void run(async () => {
                              await api("/admin/zones", {
                                floorId: floor,
                                name: zoneName.trim(),
                                x,
                                y,
                              });
                              setPlacing(false);
                              setZoneName("");
                            });
                        }}
                      />
                    )}
                    {zones.map((z: any) => (
                      <button
                        key={z.id}
                        className={
                          "zone-marker " +
                          (z.openIssues ? "has-issues " : "") +
                          (activeZone?.id === z.id ? "is-selected" : "")
                        }
                        style={{ left: z.x * 100 + "%", top: z.y * 100 + "%" }}
                        onClick={() => {
                          setZone(z);
                          setZoneName(z.name);
                          setZoneEdit(false);
                        }}
                        aria-pressed={activeZone?.id === z.id}
                        aria-label={
                          z.demo
                            ? `${z.name}: example zone`
                            : `${z.name}: ${z.reportedPeople} people checked in, ${z.volunteers} connected on duty, ${z.openIssues} open issues`
                        }
                      >
                        <MapPin size={18} />
                        <span>{z.name}</span>
                        <small>
                          {z.demo
                            ? "Example zone"
                            : `${z.reportedPeople} ${z.reportedPeople === 1 ? "person" : "people"} · ${z.volunteers} on duty · ${z.openIssues} issues`}
                        </small>
                      </button>
                    ))}
                    {zones.map((z: any) => {
                      const linked = d.issues.filter(
                        (x: any) =>
                          x.zone_id === z.id && x.status !== "resolved",
                      );
                      return linked.length ? (
                        <div
                          key={z.id + ":issues"}
                          className="issue-markers"
                          style={{
                            left: z.x * 100 + "%",
                            top: z.y * 100 + "%",
                          }}
                          role="group"
                          aria-label={`${z.name} unresolved threads`}
                        >
                          {linked.map((x: any, index: number) => (
                            <button
                              key={x.id}
                              className={"issue-marker priority-" + x.priority}
                              title={`${x.priority}: ${x.title}`}
                              aria-label={`Open issue: ${x.title}`}
                              onClick={() => void openThread(x.id)}
                            >
                              {index + 1}
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })}
                  </div>
                ) : (
                  <div className="map-empty">
                    <MapPin size={32} />
                    <p>
                      {current
                        ? "Upload a floor plan to place zones."
                        : "Add your first floor to begin."}
                    </p>
                  </div>
                )}
              </div>
              {(current?.image_id || current?.demo) && (
                <small className="map-legend">
                  {current.demo
                    ? "College hackathon example · Select a zone to explore. Illustrative layout, not a real campus map."
                    : "People counts use their last reported check-in. On duty counts require a live connection. Counts refresh automatically; numbered markers open unresolved threads."}
                </small>
              )}
              {manageVenue &&
                user.role === "admin" &&
                current &&
                !current.demo && (
                  <label className="upload-label">
                    Upload / replace floor image · PNG/JPEG/WebP, 5 MB
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={!ops.live}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          void run(() =>
                            phaseUpload("floors/" + floor, f, f.name),
                          );
                      }}
                    />
                  </label>
                )}
              {manageVenue && user.role === "admin" && (
                <form
                  className="inline-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (creatingFloor) return;
                    setCreatingFloor(true);
                    try {
                      await run(async () => {
                        await api("/admin/floors", { name: floorName });
                        setFloorName("");
                      });
                    } finally {
                      setCreatingFloor(false);
                    }
                  }}
                >
                  <input
                    required
                    value={floorName}
                    maxLength={80}
                    disabled={creatingFloor}
                    onChange={(e) => setFloorName(e.target.value)}
                    placeholder="New floor name"
                  />
                  <button
                    className="primary"
                    disabled={!ops.live || creatingFloor}
                  >
                    <Plus size={15} />
                    {creatingFloor ? "Adding floor…" : "Add floor"}
                  </button>
                </form>
              )}
              {manageVenue && user.role === "admin" && current && (
                <div className="floor-removal">
                  <button
                    className="outline danger-button"
                    disabled={removingFloor || (!current.demo && !ops.live)}
                    onClick={removeFloor}
                  >
                    {removingFloor
                      ? "Removing…"
                      : current.demo
                        ? "Remove example floor"
                        : "Remove floor"}
                  </button>
                  <small>
                    {current.demo
                      ? "Hides this example floor in this browser. View college hackathon example restores it."
                      : "Removes the floor and its zones. Issue threads are kept."}
                  </small>
                </div>
              )}
            </section>
            <section className="zone-details">
              <span className="eyebrow">
                {current?.demo ? "EXAMPLE ZONE" : "ZONE DETAILS"}
              </span>
              <h2>{activeZone?.name || "Select a zone"}</h2>
              {activeZone ? (
                <>
                  <p>
                    {activeZone.demo
                      ? activeZone.description
                      : `${activeZone.reportedPeople} people last checked in · ${activeZone.volunteers} connected, on duty · ${activeZone.openIssues} unresolved issues`}
                  </p>
                  {user.role === "admin" && !activeZone.demo && (
                    <button
                      className="outline"
                      disabled={!ops.live || savingZone || removingZone}
                      onClick={() => setZoneEdit(!zoneEdit)}
                    >
                      Edit zone
                    </button>
                  )}
                  {manageVenue && user.role === "admin" && !activeZone.demo && (
                    <button
                      className="outline danger-button"
                      disabled={!ops.live || savingZone || removingZone}
                      onClick={() => void removeZone()}
                    >
                      {removingZone ? "Removing zone…" : "Remove zone"}
                    </button>
                  )}
                  {zoneEdit && !activeZone.demo && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (savingZone) return;
                        setSavingZone(true);
                        try {
                          await run(async () => {
                            await api(
                              "/admin/zones/" + activeZone.id,
                              {
                                name: zoneName,
                                x: activeZone.x,
                                y: activeZone.y,
                              },
                              "PUT",
                            );
                            setZoneEdit(false);
                          });
                        } finally {
                          setSavingZone(false);
                        }
                      }}
                    >
                      <input
                        required
                        maxLength={80}
                        aria-label="Zone name"
                        disabled={savingZone}
                        value={zoneName}
                        onChange={(e) => setZoneName(e.target.value)}
                      />
                      <button
                        className="primary"
                        disabled={!ops.live || savingZone}
                      >
                        Save name
                      </button>
                    </form>
                  )}
                  {people
                    .filter((u: any) => u.checkin?.zone_id === activeZone.id)
                    .map((u: any) => (
                      <div className="zone-volunteer" key={u.id}>
                        <strong>{u.name}</strong>
                        <small>
                          {u.connected
                            ? u.onDuty
                              ? "Connected · on duty"
                              : "Connected · off duty"
                            : "Disconnected · last reported location"}{" "}
                          · {ago(u.checkin.reported_at)}
                        </small>
                        {u.team && (
                          <button
                            className="outline"
                            onClick={() => onConversation(u.team.channel_id)}
                          >
                            Contact {u.team.name}
                          </button>
                        )}
                      </div>
                    ))}
                  {d.issues
                    .filter(
                      (x: any) =>
                        x.zone_id === activeZone.id && x.status !== "resolved",
                    )
                    .map((x: any) => (
                      <IssueCard
                        key={x.id}
                        issue={x}
                        onClick={() => void openThread(x.id)}
                      />
                    ))}
                </>
              ) : (
                <p>
                  {current?.demo
                    ? "Select a hall, service area or access point to explore the college hackathon example."
                    : "See volunteers and unresolved threads linked to this location."}
                </p>
              )}
              {!current?.demo && <h3>Location unknown</h3>}
              {people
                .filter((u: any) => !current?.demo && !u.checkin)
                .map((u: any) => (
                  <p key={u.id}>
                    {u.name} · {u.connected ? "connected" : "disconnected"}
                  </p>
                ))}
            </section>
          </div>
          {user.role === "admin" && onManageChannels && (
            <button className="outline" onClick={onManageChannels}>
              Manage channel memberships
            </button>
          )}
        </>
      ) : (
        <>
          <div className="thread-toolbar">
            <div className="thread-filters">
              {[
                ["open", "Open"],
                [
                  "team",
                  user.role === "admin" ? "Channel issues" : "My channels",
                ],
                ["mine", "Assigned to me"],
                ["all", "All history"],
              ].map(([k, label]) => (
                <button
                  key={k}
                  className={filter === k ? "primary" : "outline"}
                  onClick={() => setFilter(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="primary" onClick={() => setCreate(true)}>
              <Plus size={16} />
              New thread
            </button>
          </div>
          <div className="issue-list">
            {issues.map((x: any) => (
              <IssueCard
                key={x.id}
                issue={x}
                onClick={() => void openThread(x.id)}
              />
            ))}
            {!issues.length && <p>No issues match this filter.</p>}
          </div>
        </>
      )}
      {ops.pending.length > 0 && (
        <section className="pending-operations">
          <h3>Local updates</h3>
          {ops.pending.map((o) => (
            <div key={o.id}>
              <span>
                {o.path.startsWith("/checkins")
                  ? "Location check-in"
                  : o.body.title || o.body.text || "Thread update"}{" "}
                · {o.state}
              </span>
              <small>{o.error || "Awaiting server confirmation"}</small>
              {o.state === "rejected" && (
                <button
                  className="outline"
                  onClick={() =>
                    void operationQueue.remove(o.id).then(ops.reloadPending)
                  }
                >
                  Dismiss rejected update
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {create && (
        <ThreadForm
          data={d}
          user={user}
          onClose={() => setCreate(false)}
          onSave={async (body, photo) => {
            await ops.enqueue("/threads", body, photo);
            setCreate(false);
          }}
        />
      )}
      {thread && (
        <div className="modal-backdrop">
          <section
            className="thread-detail"
            role="dialog"
            aria-modal="true"
            aria-label="Issue thread"
          >
            <button
              className="close-dialog"
              onClick={() => setThread(undefined)}
            >
              Close ×
            </button>
            <span className={"priority " + thread.priority}>
              {thread.priority}
            </span>
            <h2>{thread.title}</h2>
            <p className="thread-meta">
              {status(thread.status)} · {thread.owner_name || "Unassigned"} ·{" "}
              {thread.zone_name || "No zone"} ·{" "}
              {thread.audience === "team" ? "Team only" : "Everyone"}
            </p>
            <p className="thread-description">{thread.description}</p>
            {thread.photo_id && (
              <OperationImage
                id={thread.photo_id}
                owner={user.id}
                online={ops.live}
                alt="Issue photo"
              />
            )}
            <div className="thread-actions">
              {thread.status === "open" && (
                <button
                  className="primary"
                  disabled={!ops.live}
                  onClick={() =>
                    void run(async () => {
                      await api(`/threads/${thread.id}/claim`, {
                        version: thread.version,
                      });
                      await openThread(thread.id);
                    })
                  }
                >
                  I'll handle this
                </button>
              )}
              {thread.status !== "resolved" &&
                (user.role === "admin" ||
                  thread.author_id === user.id ||
                  thread.owner_id === user.id) && (
                  <button
                    className="outline"
                    disabled={!ops.live}
                    onClick={() =>
                      void run(async () => {
                        await api(`/threads/${thread.id}/resolve`, {
                          version: thread.version,
                        });
                        await openThread(thread.id);
                      })
                    }
                  >
                    <Check size={15} />
                    Resolve
                  </button>
                )}
              {user.role === "admin" && (
                <>
                  <button
                    className="outline"
                    disabled={!ops.live}
                    onClick={() =>
                      void run(async () => {
                        await api(`/threads/${thread.id}/reopen`, {
                          version: thread.version,
                        });
                        await openThread(thread.id);
                      })
                    }
                  >
                    Reopen
                  </button>
                  <select
                    value=""
                    disabled={!ops.live}
                    onChange={(e) =>
                      void run(async () => {
                        await api(`/threads/${thread.id}/reassign`, {
                          version: thread.version,
                          ownerId: e.target.value,
                        });
                        await openThread(thread.id);
                      })
                    }
                  >
                    <option value="">Reassign to…</option>
                    {d.volunteers
                      .filter(
                        (u: any) =>
                          thread.audience === "everyone" ||
                          (u.channelMemberships || []).some(
                            (t: any) => t.id === thread.team_id,
                          ),
                      )
                      .map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                </>
              )}
            </div>
            <p className="ownership-note">
              Ownership and final status require server confirmation.
            </p>
            <h3>Follow-ups</h3>
            {thread.replies.map((r: any) => (
              <article className="thread-reply" key={r.id}>
                <strong>{r.author_name}</strong>
                <small>{ago(r.created_at)}</small>
                <p>{r.text}</p>
              </article>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ops
                  .enqueue(`/threads/${thread.id}/replies`, {
                    id: crypto.randomUUID(),
                    text: reply,
                    createdAt: Date.now(),
                  })
                  .then(() => setReply(""));
              }}
            >
              <textarea
                required
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Post a progress update…"
              />
              <button className="primary">Post reply</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
function IssueCard({ issue: x, onClick }: { issue: any; onClick: () => void }) {
  return (
    <button className="issue-card" onClick={onClick}>
      <span className={"priority " + x.priority}>
        {x.priority === "urgent" && <AlertTriangle size={14} />} {x.priority}
      </span>
      <div>
        <h3>{x.title}</h3>
        <p>
          {status(x.status)} · {x.owner_name || "Unassigned"} ·{" "}
          {x.zone_name || "No zone"}
        </p>
        <small>
          {x.audience === "team" ? "Team only" : "Everyone"} · Updated{" "}
          {ago(x.updated_at)}
        </small>
      </div>
      <span>
        <MessageSquare size={16} />
        {x.reply_count}
      </span>
    </button>
  );
}
function ThreadForm({
  data,
  user,
  onClose,
  onSave,
}: {
  data: any;
  user: any;
  onClose: () => void;
  onSave: (body: any, photo?: File) => Promise<void>;
}) {
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [priority, setPriority] = useState("normal"),
    [audience, setAudience] = useState(
      data.team || user.role === "admin" ? "team" : "everyone",
    ),
    [zone, setZone] = useState(data.checkin?.zone_id || ""),
    [team, setTeam] = useState(
      data.team?.id || (user.role === "admin" ? data.teams[0]?.id : "") || "",
    ),
    [photo, setPhoto] = useState<File>(),
    [saving, setSaving] = useState(false);
  return (
    <div className="modal-backdrop">
      <form
        className="thread-detail"
        role="dialog"
        aria-modal="true"
        aria-label="New thread"
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          void onSave(
            {
              id: crypto.randomUUID(),
              title,
              description,
              priority,
              audience,
              zoneId: zone || null,
              teamId: audience === "team" ? team : undefined,
              createdAt: Date.now(),
            },
            photo,
          ).finally(() => setSaving(false));
        }}
      >
        <button type="button" className="close-dialog" onClick={onClose}>
          Close ×
        </button>
        <span className="eyebrow">NEW ISSUE</span>
        <h2>Report what needs attention.</h2>
        <label>
          Title
          <input
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            required
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="form-columns">
          <label>
            Priority
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label>
            Audience
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            >
              <option value="team" disabled={!team}>
                {"Selected channel"}
              </option>
              <option value="everyone">Everyone</option>
            </select>
          </label>
        </div>
        {audience === "team" && (
          <label>
            Channel
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              {(user.role === "admin"
                ? data.teams
                : data.channelMemberships || []
              ).map((t: any) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Floor / zone (optional)
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">No zone</option>
            {data.zones.map((z: any) => (
              <option key={z.id} value={z.id}>
                {data.floors.find((f: any) => f.id === z.floor_id)?.name} /{" "}
                {z.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Photo (optional, up to 5 MB)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setPhoto(e.target.files?.[0])}
          />
        </label>
        <button
          className="primary"
          disabled={
            saving ||
            (audience === "team" && !team) ||
            (!!photo && photo.size > 5 * 1024 * 1024)
          }
        >
          Create thread
        </button>
      </form>
    </div>
  );
}
