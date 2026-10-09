import { useState, useEffect, useRef, useCallback } from "react";
import {
  Radio,
  Mic,
  MessageSquare,
  Users,
  Settings,
  LogOut,
  ArrowRight,
  Lock,
  Paperclip,
  Send,
  Phone,
  Video,
  Square,
  Check,
  ShieldCheck,
  Volume2,
  RefreshCw,
  Plus,
  Activity,
} from "lucide-react";
import {
  api,
  access,
  setAccess,
  outbox,
  upload,
  fileUrl,
  type Pending,
  pauseUploads,
} from "./api";
import { Coordinator } from "./media";
import Operations, {
  useOperations,
  LocationControl,
  CommunicationPanel,
} from "./Operations";
import "./operations.css";

const time = (n: number) =>
  new Date(n).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function Mark() {
  return (
    <span className="brand">
      <Radio size={28} />
      <strong>
        KETTO<span className="badge">SECURE</span>
      </strong>
    </span>
  );
}
function Attachment({ message }: { message: any }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let url = "";
    fileUrl(message.attachment_id)
      .then((u) => {
        url = u;
        if (active) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [message.attachment_id]);
  if (error) return <p>{error}</p>;
  if (!url) return <p>Loading attachment…</p>;
  return (
    <div className="attachment">
      {message.kind === "image" ? (
        <img src={url} alt="Shared photo" />
      ) : message.kind === "video" ? (
        <video controls src={url} />
      ) : (
        <audio controls src={url} />
      )}
      <a href={url} download>
        Download
      </a>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (u: any) => void }) {
  const [register, setRegister] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [health, setHealth] = useState<any>();
  useEffect(() => {
    api("/health")
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote("");
    try {
      const key = "kettoo.device." + email.toLowerCase();
      if (register) {
        const r = await api("/register", {
          name,
          email,
          password,
          deviceName: "Web console",
        });
        localStorage.setItem(key, r.deviceId);
        setNote(
          r.status + ". Ask an admin to approve both your account and device.",
        );
        setRegister(false);
      } else {
        const r = await api("/login", {
          email,
          password,
          deviceId: localStorage.getItem(key) || undefined,
          deviceName: "Web console",
        });
        if (r.deviceId) localStorage.setItem(key, r.deviceId);
        if (r.pending) {
          setNote("This device is awaiting administrator approval.");
          return;
        }
        setAccess(r.token);
        onLogin({ ...r.user, device: r.deviceId });
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <header>
        <Mark />
        <span className="mono">ORGANISATION // DISPATCH</span>
      </header>
      <main>
        <div className="intro">
          <Radio size={35} />
          <h1>KETTO</h1>
          <span className="light-badge">CLIENT 0.3</span>
        </div>
        <p className="subtitle">
          Private staff communication. On your network.
        </p>
        <div className="connection-panel">
          <b>
            <span className={"dot " + (health?.ok ? "" : "hollow")} />
            ORGANISATION SERVER:{" "}
            {health?.ok ? "CONNECTED" : health ? "UNREACHABLE" : "CHECKING"}
          </b>
          <span className="light-badge">{health?.ok ? "ONLINE" : "WAIT"}</span>
          <p>Live audio service</p>
          <span className="mono">
            {health?.mediaConfigured ? "CONFIGURED" : "NOT CONFIGURED"}
          </span>
        </div>
        <form className="login-form" onSubmit={submit}>
          <h3>{register ? "REQUEST MEMBERSHIP" : "NODE SIGN-IN"}</h3>
          {register && (
            <label>
              OPERATOR NAME
              <input
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </label>
          )}
          <label>
            OPERATOR EMAIL <span className="mono">REQUIRED</span>
            <input
              autoComplete="username"
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@organisation.local"
            />
          </label>
          <label>
            ACCESS PASSWORD <span className="mono">12+ CHARACTERS</span>
            <input
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={12}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className="small muted">
            <Lock size={15} /> Membership and device approval are required.
          </div>
          {note && (
            <div className="notice" role="status">
              {note}
            </div>
          )}
          <button className="primary wide" disabled={busy}>
            {busy
              ? "CONNECTING…"
              : register
                ? "REQUEST ACCESS"
                : "CONNECT TO DISPATCH"}
            <ArrowRight size={18} />
          </button>
          <button
            className="link-button"
            type="button"
            onClick={() => setRegister(!register)}
          >
            {register ? "Back to sign-in" : "New operator? Request access"}
          </button>
        </form>
        <div className="footnote">
          <ShieldCheck size={18} />
          <div>
            <b>ORGANISATION CONTROLLED</b>
            <p>
              Messages stay on your organisation’s server. Nearby communication
              is available in the Android app after device enrolment.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<any>(),
    [loading, setLoading] = useState(!!access),
    [page, setPage] = useState("comms"),
    [tab, setTab] = useState("voice"),
    [conversations, setConversations] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [people, setPeople] = useState<any[]>([]),
    [messages, setMessages] = useState<any[]>([]),
    [overview, setOverview] = useState<any>(),
    [online, setOnline] = useState(false),
    [duty, setDuty] = useState(false),
    [rooms, setRooms] = useState<string[]>([]),
    [state, setState] = useState("STANDBY"),
    [error, setError] = useState(""),
    [text, setText] = useState(""),
    [pending, setPending] = useState<Pending[]>([]),
    [progress, setProgress] = useState<number>(),
    [call, setCall] = useState<any>(),
    [incoming, setIncoming] = useState<any>(),
    [recording, setRecording] = useState(false),
    [conserve, setConserve] = useState(false),
    [newName, setNewName] = useState("");
  const [audience, setAudience] = useState<any[]>([]);
  const [archived, setArchived] = useState(false);
  const isArchived = (m: any) => m.receipts?.some((r: any) => r.user_id === user?.id && r.state === "acknowledged");
  const visibleMessages = messages.filter(m => !!isArchived(m) === archived);
  const coordinator = useRef(new Coordinator()).current,
    socket = useRef<WebSocket | undefined>(undefined),
    session = useRef({ duty: false, selected: "", user: null as any }),
    flushing = useRef(false),
    video = useRef<HTMLDivElement>(null),
    recorder = useRef<MediaRecorder | undefined>(undefined),
    noteStream = useRef<MediaStream | undefined>(undefined),
    fileInput = useRef<HTMLInputElement>(null);
  session.current = { duty, selected, user };
  const current = conversations.find((c) => c.id === selected);
  const operations = useOperations(
    user,
    online &&
      state !== "TRANSMITTING" &&
      !incoming &&
      !recording &&
      call?.state !== "accepted",
  );
  const openCommunication = (cid: string) => {
    setSelected(cid);
    setPage("comms");
    void refresh();
  };
  const report = useCallback(
    (e: any) => setError(typeof e === "string" ? e : e.message),
    [],
  );
  const refresh = useCallback(async () => {
    const [cs, ps] = await Promise.all([api("/conversations"), api("/people")]);
    setConversations(cs);
    coordinator.reconcile(cs);
    setIncoming(
      cs
        .filter(
          (c: any) =>
            c.mediaAllowed !== false && c.speaker?.expires > Date.now(),
        )
        .sort((a: any, b: any) => b.priority - a.priority)[0]?.speaker || null,
    );
    setPeople(ps);
    if (!cs.some((c: any) => c.id === session.current.selected))
      setSelected(cs[0]?.id || "");
    if (session.current.user?.role === "admin")
      setOverview(await api("/admin/overview"));
  }, []);
  useEffect(() => {
    const reload = () => void refresh().catch(report);
    window.addEventListener("kettoo-permissions", reload);
    return () => window.removeEventListener("kettoo-permissions", reload);
  }, [user?.id]);
  const history = useCallback(async (cid: string) => {
    if (!cid) return;
    let all: any[] = [],
      after = 0,
      more = true;
    while (more) {
      const r = await api(
        `/conversations/${cid}/messages?after=${after}&limit=200`,
      );
      all.push(...r.messages);
      more = r.hasMore;
      after = r.messages.at(-1)?.seq || after;
    }
    if (session.current.selected === cid) setMessages(all);
  }, []);
  const heartbeat = useCallback(() => {
    if (socket.current?.readyState === 1)
      socket.current.send(
        JSON.stringify({
          type: "heartbeat",
          onDuty: session.current.duty,
          rooms: coordinator.connectedRooms,
        }),
      );
  }, []);
  useEffect(() => {
    coordinator.onState = setState;
    coordinator.onError = report;
    coordinator.onAudience = setAudience;
    coordinator.onRecording = async (cid, id, blob) => {
      const owner = session.current.user?.id;
      if (!owner) return;
      await outbox.put({ id, cid, owner, kind: "ptt-recording", blob, name: "ptt.webm", createdAt: Date.now() });
    };
    coordinator.onRooms = () => {
      setRooms(coordinator.connectedRooms);
      heartbeat();
    };
    if (access)
      api("/me")
        .then(setUser)
        .catch(() => setAccess(""))
        .finally(() => setLoading(false));
    return () => {
      void coordinator.off();
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const connect = async () => {
      try {
        const r = await api("/ws-ticket", {});
        if (cancelled) return;
        const ws = new WebSocket(
          location.origin.replace(/^http/, "ws") +
            "/api/events?ticket=" +
            r.ticket,
        );
        socket.current = ws;
        ws.onopen = () => {
          setOnline(true);
          heartbeat();
          void refresh()
            .then(() => history(session.current.selected))
            .catch(report);
          void api("/calls/active").then(setCall);
        };
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data);
          if (
            m.type === "message" &&
            m.payload.conversation_id === session.current.selected
          ) {
            setMessages((old) =>
              [...old.filter((x) => x.id !== m.payload.id), m.payload].sort(
                (a, b) => a.seq - b.seq,
              ),
            );
            if (
              m.payload.sender_id !== user.id &&
              !m.payload.receipts.some((r: any) => r.user_id === user.id)
            )
              void api(`/messages/${m.payload.id}/receipt`, {
                state: "received",
              }).catch(() => {});
          }
          if (m.type === "permissions") void refresh().catch(report);
          if (m.type === "operations.changed")
            window.dispatchEvent(new Event("kettoo-operations"));
          if (
            m.type === "call" &&
            [m.payload.caller_device, m.payload.callee_device].includes(
              session.current.user.device,
            )
          )
            setCall(m.payload);
          if (m.type === "ptt.started") {
            pauseUploads();
            setIncoming(m.payload);
            coordinator.incoming(
              m.payload.conversation,
              true,
              m.payload.priority || 0,
            );
            void refresh();
          }
          if (m.type === "ptt.ended") {
            if (m.payload.device === session.current.user.device)
              void coordinator.stop();
            setIncoming((old: any) =>
              old?.message === m.payload.message ? null : old,
            );
            coordinator.incoming(m.payload.conversation, false);
            void refresh();
          }
        };
        ws.onclose = () => {
          setOnline(false);
          setIncoming(null);
          void coordinator.stop();
          if (!cancelled) timer = setTimeout(connect, 2500);
        };
        ws.onerror = () => ws.close();
      } catch (e) {
        setOnline(false);
        if (!cancelled) timer = setTimeout(connect, 5000);
      }
    };
    void connect();
    const beat = setInterval(heartbeat, 10000),
      snap = setInterval(() => void refresh().catch(() => {}), 15000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(beat);
      clearInterval(snap);
      socket.current?.close();
    };
  }, [user?.id]);
  useEffect(() => {
    if (selected && user) {
      setArchived(false);
      setMessages([]);
      void history(selected).catch(report);
      coordinator.selected = selected;
      coordinator.route();
    }
  }, [selected, user?.id]);
  useEffect(() => {
    if (!user) return;
    const cids = conversations.map((c) => c.id);
    if (duty && online) {
      heartbeat();
      void coordinator.sync(conversations).catch(report);
    } else void coordinator.off();
  }, [
    duty,
    online,
    conversations
      .map((c) => c.id + ":" + c.mediaAllowed + ":" + c.mediaEpoch)
      .join(","),
  ]);
  useEffect(() => {
    if (!call) return;
    if (call.state === "accepted" && video.current) {
      void coordinator.joinCall(call, video.current).catch(async (e) => {
        report(e);
        await api(`/calls/${call.id}/end`, {}).catch(() => {});
      });
    } else if (!["ringing", "accepted"].includes(call.state)) {
      void coordinator.endCall();
    }
  }, [call?.id, call?.state]);
  useEffect(() => {
    const stop = () => void coordinator.stop();
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", stop);
    return () => {
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", stop);
    };
  }, []);
  const flush = useCallback(async () => {
    if (flushing.current || !session.current.user || coordinator.callRoom)
      return;
    flushing.current = true;
    try {
      const queued = (await outbox.all()).filter(
        (p) => p.owner === session.current.user.id,
      );
      setPending(queued);
      for (const p of queued) {
        if (coordinator.callRoom || state === "TRANSMITTING" || incoming) break;
        try {
          let attachmentId = p.attachmentId;
          if (p.blob && !attachmentId) {
            const f = await upload(
              p.cid,
              p.blob,
              p.name || "attachment",
              setProgress,
            );
            attachmentId = f.id;
            await outbox.put({ ...p, attachmentId });
          }
          if (p.kind === "ptt-recording") await api(`/messages/${p.id}/recording`, { attachmentId });
          else await api(`/conversations/${p.cid}/messages`, {
            id: p.id,
            text: p.text,
            kind: p.kind,
            attachmentId,
            createdAt: p.createdAt,
            delayed: Date.now() - p.createdAt > 30000,
          });
          await outbox.remove(p.id);
        } catch (e) {
          report(e);
          break;
        } finally {
          setProgress(undefined);
        }
      }
      setPending(
        (await outbox.all()).filter((p) => p.owner === session.current.user.id),
      );
    } finally {
      flushing.current = false;
    }
  }, [state, incoming]);
  useEffect(() => {
    if (!user) return;
    void flush();
    const interval = setInterval(() => void flush(), 7000);
    return () => clearInterval(interval);
  }, [user?.id, online, flush]);
  async function send(blob?: Blob, name?: string, kind = "text") {
    if (!selected || (!blob && !text.trim())) return;
    if (blob && kind === "video" && conserve) {
      report("Disable Conserve data to send video");
      return;
    }
    await outbox.put({
      id: crypto.randomUUID(),
      owner: user.id,
      cid: selected,
      text: blob ? undefined : text.trim(),
      kind,
      blob,
      name,
      createdAt: Date.now(),
    });
    setText("");
    void flush();
  }
  async function voiceNote() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    if (state !== "STANDBY" || ["ringing", "accepted"].includes(call?.state)) {
      report("Finish live communication before recording");
      return;
    }
    try {
      const cid = selected,
        owner = user.id,
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      noteStream.current = stream;
      const r = new MediaRecorder(stream),
        parts: BlobPart[] = [];
      recorder.current = r;
      r.ondataavailable = (e) => parts.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(parts, { type: r.mimeType.split(";")[0] });
        void outbox
          .put({
            id: crypto.randomUUID(),
            owner,
            cid,
            kind: "voice",
            blob,
            name: "voice-note.webm",
            createdAt: Date.now(),
          })
          .then(flush);
      };
      r.start();
      setRecording(true);
      setTimeout(() => {
        if (r.state === "recording") r.stop();
      }, 30000);
    } catch (e) {
      report(e);
    }
  }
  async function action(path: string, body: any = {}, method?: string) {
    try {
      await api(path, body, method);
      await refresh();
    } catch (e) {
      report(e);
    }
  }
  async function acknowledge(m: any) {
    try {
      await api(`/messages/${m.id}/receipt`, { state: "acknowledged" });
      setMessages(old => old.map(row => row.id === m.id ? { ...row, receipts: [...row.receipts.filter((r: any) => r.user_id !== user.id), { user_id: user.id, state: "acknowledged", at: Date.now() }] } : row));
    } catch (e) { report(e); }
  }
  async function privateChat(uid: string) {
    try {
      const c = await api("/private", { userId: uid });
      await refresh();
      setSelected(c.id);
      setPage("comms");
    } catch (e) {
      report(e);
    }
  }
  async function logout() {
    try {
      await api("/logout", {});
    } catch {}
    await coordinator.off();
    noteStream.current?.getTracks().forEach((t) => t.stop());
    setAccess("");
    setUser(undefined);
    setDuty(false);
    setCall(undefined);
    setMessages([]);
    setPending([]);
  }
  if (loading) return <div className="loading">CONNECTING TO KETTO…</div>;
  if (!user) return <Login onLogin={setUser} />;
  return (
    <div className="app">
      <header className="topbar">
        <Mark />
        <div className="top-status mono">
          <span className={"dot " + (!online ? "hollow" : "")} />
          {online ? "SERVER CONNECTED" : "SERVER UNREACHABLE"} //{" "}
          {duty ? "ON DUTY" : "OFF DUTY"}
          <LocationControl ops={operations} />
        </div>
        <button
          className="avatar"
          title="Settings"
          onClick={() => setPage("settings")}
        >
          {user.name.slice(0, 2).toUpperCase()}
        </button>
      </header>
      <div className="shell">
        <aside>
          <div className="eyebrow">PRIMARY DISPATCH</div>
          <h2>
            Communication
            <br />
            without the noise.
          </h2>
          <nav>
            {user.role === "admin" && (
              <button
                className={page === "map" ? "active" : ""}
                onClick={() => setPage("map")}
              >
                <Activity />
                Operations
              </button>
            )}
            <button
              className={page === "threads" ? "active" : ""}
              onClick={() => setPage("threads")}
            >
              <MessageSquare />
              Threads
            </button>
            <button
              className={page === "comms" ? "active" : ""}
              onClick={() => setPage("comms")}
            >
              <Radio />
              Communications
            </button>
            <button
              className={page === "people" ? "active" : ""}
              onClick={() => setPage("people")}
            >
              <Users />
              People
            </button>
            {user.role === "admin" && (
              <button
                className={page === "admin" ? "active" : ""}
                onClick={() => setPage("admin")}
              >
                <Activity />
                Organisation
              </button>
            )}
            <button
              className={page === "settings" ? "active" : ""}
              onClick={() => setPage("settings")}
            >
              <Settings />
              Settings
            </button>
          </nav>
          <div className="side-footer">
            <span className="eyebrow">OPERATOR</span>
            <strong>{user.name}</strong>
            <span className="mono">
              {user.role.toUpperCase()} // {rooms.length} AUDIO ROOMS
            </span>
            <button
              className={duty ? "outline" : "primary"}
              onClick={() => setDuty(!duty)}
            >
              {duty ? <Square size={14} /> : <Radio size={16} />}{" "}
              {duty ? "END DUTY" : "START DUTY"}
            </button>
          </div>
        </aside>
        <main className="workspace">
          <CommunicationPanel
            ops={operations}
            user={user}
            onConversation={openCommunication}
          />
          {(page === "map" || page === "threads") && (
            <Operations
              ops={operations}
              user={user}
              page={page}
              onConversation={openCommunication}
            />
          )}
          {error && (
            <div className="notice error" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {incoming && (
            <div className="live-banner">
              <Volume2 size={18} />
              <b>{incoming.speakerName} IS LIVE</b>
              <span>
                {conversations.find((c) => c.id === incoming.conversation)
                  ?.name || "Channel"}{" "}
                {call?.state === "accepted"
                  ? "// MISSED LIVE — IN CALL"
                  : incoming.conversation !== coordinator.audibleConversation
                    ? "// OVERLAPPING CHANNEL — MISSED LIVE"
                    : ""}
              </span>
            </div>
          )}
          {page === "comms" && (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">OPERATIONS / COMMUNICATIONS</span>
                  <h1>Stay connected.</h1>
                </div>
                <span className="outline-badge">
                  {conversations.length} CONVERSATIONS
                </span>
              </div>
              <div className="comms-grid">
                <section className="conversation-list">
                  <div className="section-title">
                    YOUR CHANNELS{" "}
                    <span>
                      {conversations.length.toString().padStart(2, "0")}
                    </span>
                  </div>
                  {conversations.map((c) => (
                    <button
                      key={c.id}
                      className={
                        "conversation " + (c.id === selected ? "selected" : "")
                      }
                      onClick={() => setSelected(c.id)}
                    >
                      <span className="channel-icon">
                        {c.kind === "private" ? (
                          <Lock size={18} />
                        ) : (
                          <Radio size={18} />
                        )}
                      </span>
                      <span>
                        <b>{c.name}</b>
                        <small>
                          {c.kind === "broadcast"
                            ? "ADMIN BROADCAST"
                            : c.kind === "private"
                              ? "PRIVATE / TWO PEOPLE"
                              : `${c.members.length} MEMBERS`}{" "}
                          · {c.listeners} READY
                        </small>
                      </span>
                      {c.speaker && <span className="dot" />}
                    </button>
                  ))}
                  {!conversations.length && (
                    <p className="empty">
                      Ask your administrator to assign a channel.
                    </p>
                  )}
                  <button
                    className="link-button"
                    onClick={() => setPage("people")}
                  >
                    <Plus size={16} />
                    Open private conversation
                  </button>
                  <div className="network-note">
                    <b>LOCAL NETWORK FIRST</b>
                    <p>
                      Internet is optional when your organisation’s server and
                      media service are reachable.
                    </p>
                  </div>
                </section>
                <section className="communication">
                  {current && (
                    <>
                      <div className="person-panel">
                        <span className="initials">
                          {current.kind === "private" ? (
                            <Lock size={27} />
                          ) : (
                            <Radio size={27} />
                          )}
                        </span>
                        <div>
                          <h2>{current.name}</h2>
                          <span className="eyebrow">
                            {current.kind === "private"
                              ? "DIRECT / PRIVATE COMMS"
                              : current.kind === "broadcast"
                                ? current.id === "all-staff"
                                  ? "ORGANISATION / ALL STAFF"
                                  : "BROADCAST / SELECTED AUDIENCE"
                                : "TEAM / CHANNEL COMMS"}
                          </span>
                        </div>
                        <div className="call-actions">
                          {current.kind === "private" && (
                            <>
                              <button
                                aria-label="Voice call"
                                disabled={!duty || !online || recording}
                                onClick={() =>
                                  void action("/calls", {
                                    conversationId: selected,
                                    video: false,
                                  })
                                }
                              >
                                <Phone size={18} />
                              </button>
                              <button
                                aria-label="Video call"
                                disabled={
                                  !duty || !online || conserve || recording
                                }
                                onClick={() =>
                                  void action("/calls", {
                                    conversationId: selected,
                                    video: true,
                                  })
                                }
                              >
                                <Video size={18} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="meta-row">
                        <span>
                          <Lock size={13} />{" "}
                          {current.kind === "private"
                            ? "PERMITTED PAIR"
                            : "MEMBERS ONLY"}
                        </span>
                        <span>
                          {rooms.includes(selected)
                            ? "AUDIO CONNECTED"
                            : "AUDIO DISCONNECTED"}
                        </span>
                      </div>
                      <div className="tabs">
                        <button
                          className={tab === "voice" ? "active" : ""}
                          onClick={() => setTab("voice")}
                        >
                          <Mic size={17} />
                          LIVE VOICE (PTT)
                        </button>
                        <button
                          className={tab === "chat" ? "active" : ""}
                          onClick={() => setTab("chat")}
                        >
                          <MessageSquare size={17} />
                          MESSAGE LOG
                        </button>
                      </div>
                      {tab === "voice" && (
                        <div className="voice-view">
                          <div className="session-panel">
                            {audience.length > 0 && (
                              <p className="mono">
                                At burst start:{" "}
                                {
                                  audience.filter(
                                    (a) => a.state === "media-connected",
                                  ).length
                                }{" "}
                                audio connected ·{" "}
                                {
                                  audience.filter((a) => a.state === "busy")
                                    .length
                                }{" "}
                                busy ·{" "}
                                {
                                  audience.filter((a) =>
                                    ["offline", "unavailable"].includes(
                                      a.state,
                                    ),
                                  ).length
                                }{" "}
                                unavailable. This does not confirm anyone heard
                                it.
                              </p>
                            )}
                            <div className="section-title">
                              <span>
                                <span className="dot" />
                                {current.kind === "private"
                                  ? "PRIVATE"
                                  : "CHANNEL"}{" "}
                                VOICE SESSION
                              </span>
                              <span className="badge">
                                {current.kind === "private"
                                  ? "ISOLATED 1-ON-1"
                                  : "ONE SPEAKER"}
                              </span>
                            </div>
                            <div className="wave-panel">
                              <div className="mono">
                                {!online
                                  ? "DISCONNECTED"
                                  : state === "STANDBY" &&
                                      incoming?.conversation === selected
                                    ? "LISTENING"
                                    : state}{" "}
                                //{" "}
                                {rooms.includes(selected)
                                  ? "READY"
                                  : "NOT READY"}
                              </div>
                              <div
                                className={
                                  "wave " +
                                  (state === "TRANSMITTING" ? "moving" : "")
                                }
                              >
                                {Array.from({ length: 32 }, (_, i) => (
                                  <i
                                    key={i}
                                    style={{
                                      height: 5 + ((i * 17) % 26),
                                      animationDelay: `${i * 0.06}s`,
                                    }}
                                  />
                                ))}
                              </div>
                              <p>
                                {current.kind === "private"
                                  ? "Live audio is restricted to the two members of this conversation."
                                  : "Hold to request the channel. Speak only after TRANSMITTING appears."}
                              </p>
                            </div>
                          </div>
                          <button
                            className={
                              "talk " +
                              (state === "TRANSMITTING" ? "talking" : "")
                            }
                            disabled={
                              !online ||
                              current.pttAllowed === false ||
                              !duty ||
                              !rooms.includes(selected) ||
                              recording ||
                              call?.state === "accepted" ||
                              (current.kind === "broadcast" &&
                                user.role !== "admin")
                            }
                            onPointerDown={(e) => {
                              e.currentTarget.setPointerCapture(e.pointerId);
                              void coordinator.start(selected);
                            }}
                            onPointerUp={() => void coordinator.stop()}
                            onPointerCancel={() => void coordinator.stop()}
                            onKeyDown={(e) => {
                              if (
                                (e.key === " " || e.key === "Enter") &&
                                !e.repeat
                              ) {
                                e.preventDefault();
                                void coordinator.start(selected);
                              }
                            }}
                            onKeyUp={(e) => {
                              if (e.key === " " || e.key === "Enter") {
                                e.preventDefault();
                                void coordinator.stop();
                              }
                            }}
                          >
                            <Mic size={46} />
                            <strong>
                              {state === "TRANSMITTING" ? "LIVE" : "TALK"}
                            </strong>
                            <span>
                              {state === "REQUESTING"
                                ? "REQUESTING SLOT"
                                : "HOLD TO TRANSMIT"}
                            </span>
                          </button>
                          <div className="voice-caption">
                            <Lock size={15} /> 30-SECOND LIMIT · RELEASE TO
                            FINISH
                          </div>
                          {!duty && (
                            <button
                              className="primary wide"
                              onClick={() => setDuty(true)}
                            >
                              START ON-DUTY SESSION <ArrowRight size={17} />
                            </button>
                          )}
                        </div>
                      )}
                      <div className="message-log">
                        <div className="log-folders">
                          <button className={!archived ? "primary" : ""} onClick={() => setArchived(false)}>Log</button>
                          <button className={archived ? "primary" : ""} onClick={() => setArchived(true)}>Archived ({messages.filter(isArchived).length})</button>
                        </div>
                        <div className="section-title">
                          {current.kind === "private" ? "DIRECT" : "CHANNEL"}{" "}
                          {archived ? "ARCHIVED" : "COMM LOG"} <span>{archived ? "ONLY FOR YOU" : "SERVER HISTORY"}</span>
                        </div>
                        {!visibleMessages.length && (
                          <p className="empty">
                            {archived ? "Acknowledged messages appear here." : "No unacknowledged messages."}
                          </p>
                        )}
                        {visibleMessages.slice(tab === "voice" && !archived ? -4 : 0).map((m) => (
                          <article
                            className={
                              "message " +
                              (m.sender_id === user.id ? "mine" : "")
                            }
                            key={m.id}
                          >
                            <div className="message-meta">
                              <b>
                                {m.sender_id === user.id
                                  ? "YOU"
                                  : m.sender_name}
                              </b>
                              <time>{time(m.received_at)}</time>
                            </div>
                            {m.text && <p>{m.text}</p>}
                            {m.kind === "ptt" && (
                              <p>
                                <Mic size={14} />{" "}
                                {m.status === "live"
                                  ? "Live voice transmission"
                                  : m.status.includes("interrupted")
                                    ? "Interrupted live transmission"
                                    : "Push-to-talk burst"}
                                {!m.attachment_id && m.status !== "live"
                                  ? " · Recording unavailable"
                                  : ""}
                              </p>
                            )}
                            {m.attachment_id && <Attachment message={m} />}
                            {["ptt", "voice"].includes(m.kind) && (
                              <div className="transcript">
                                <span className="mono">TRANSCRIPT / AUTOMATIC</span>
                                <p>{m.transcript?.text || (m.status === "live" ? "Transcript appears after the live burst." : ["pending", "processing"].includes(m.transcript?.state) ? "Transcribing…" : m.transcript?.error || "Transcript unavailable. Listen to the audio.")}</p>
                                {online && m.attachment_id && (!m.transcript || ["failed", "unavailable"].includes(m.transcript.state)) && <button onClick={() => void action(`/messages/${m.id}/transcript/retry`)}>Retry transcript</button>}
                              </div>
                            )}
                            <div className="message-status">
                              {m.delayed ? "DELAYED · " : ""}
                              {m.receipts.some(
                                (r: any) => r.state === "acknowledged",
                              )
                                ? "ACKNOWLEDGED"
                                : m.receipts.some(
                                      (r: any) => r.user_id !== m.sender_id,
                                    )
                                  ? "RECIPIENT RECEIVED"
                                  : "SERVER RECEIVED"}
                              {!archived && (
                                <button
                                  disabled={!online}
                                  onClick={() => void acknowledge(m)}
                                >
                                  <Check size={12} />
                                  Acknowledge & archive
                                </button>
                              )}
                            </div>
                          </article>
                        ))}
                        {pending
                          .filter((p) => p.cid === selected && !archived && p.kind !== "ptt-recording")
                          .map((p) => (
                            <article className="message queued" key={p.id}>
                              <p>{p.text || p.name}</p>
                              <span className="mono">
                                QUEUED · NOT DELIVERED
                              </span>
                            </article>
                          ))}
                      </div>
                      {!archived && !(
                        current.kind === "broadcast" && user.role !== "admin"
                      ) && (
                        <form
                          className="composer"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void send();
                          }}
                        >
                          <input
                            ref={fileInput}
                            type="file"
                            hidden
                            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/*"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f)
                                void send(
                                  f,
                                  f.name,
                                  f.type.startsWith("image/")
                                    ? "image"
                                    : f.type.startsWith("video/")
                                      ? "video"
                                      : "voice",
                                );
                              e.target.value = "";
                            }}
                          />
                          <button
                            type="button"
                            aria-label="Attach photo or video"
                            onClick={() => fileInput.current?.click()}
                            disabled={recording}
                          >
                            <Paperclip size={19} />
                          </button>
                          <input
                            aria-label="Message"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Write to your team…"
                            maxLength={4000}
                          />
                          <button
                            type="button"
                            aria-label={
                              recording
                                ? "Stop voice note"
                                : "Record voice note"
                            }
                            className={recording ? "recording" : ""}
                            onClick={() => void voiceNote()}
                          >
                            {recording ? (
                              <Square size={17} />
                            ) : (
                              <Mic size={19} />
                            )}
                          </button>
                          <button className="primary" aria-label="Send message">
                            <Send size={17} />
                          </button>
                          {progress !== undefined && (
                            <progress value={progress} max={100} />
                          )}
                        </form>
                      )}
                    </>
                  )}
                </section>
              </div>
            </>
          )}
          {page === "people" && (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">DIRECTORY / APPROVED MEMBERS</span>
                  <h1>Your people.</h1>
                </div>
                <Users size={30} />
              </div>
              <div className="people-grid">
                {people
                  .filter((p) => p.id !== user.id)
                  .map((p) => (
                    <button
                      className="person-card"
                      key={p.id}
                      onClick={() => void privateChat(p.id)}
                    >
                      <span className="initials">
                        {p.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <h3>{p.name}</h3>
                        <span className="mono">{p.role.toUpperCase()}</span>
                      </div>
                      <ArrowRight />
                    </button>
                  ))}
              </div>
              {people.length < 2 && (
                <div className="empty">Approved staff will appear here.</div>
              )}
            </>
          )}
          {page === "admin" && overview && (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">ORGANISATION / CONTROL ROOM</span>
                  <h1>Dispatch overview.</h1>
                </div>
                <button className="outline" onClick={() => void refresh()}>
                  <RefreshCw size={15} />
                  Refresh
                </button>
              </div>
              <div className="stats">
                {[
                  [
                    "APPROVED MEMBERS",
                    overview.users.filter((u: any) => u.approved).length,
                  ],
                  [
                    "CONNECTED DEVICES",
                    overview.users
                      .flatMap((u: any) => u.devices)
                      .filter((d: any) => d.online).length,
                  ],
                  [
                    "ON DUTY",
                    overview.users
                      .flatMap((u: any) => u.devices)
                      .filter((d: any) => d.online && d.onDuty).length,
                  ],
                  [
                    "ACTIVE SPEAKERS",
                    overview.channels.filter((c: any) => c.speaker).length,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span className="eyebrow">{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <div className="broadcast-card">
                <Radio />
                <div>
                  <h3>ALL STAFF BROADCAST</h3>
                  <p>Text and live voice for every approved member.</p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setSelected("all-staff");
                    setPage("comms");
                  }}
                >
                  OPEN CHANNEL <ArrowRight size={16} />
                </button>
              </div>
              <section className="admin-panel">
                <div className="section-title">MEMBER & DEVICE APPROVAL</div>
                {overview.users.map((u: any) => (
                  <div className="member-row" key={u.id}>
                    <div>
                      <strong>{u.name}</strong>
                      <small>
                        {u.email} · {u.role}
                      </small>
                    </div>
                    <span className={u.approved ? "light-badge" : "badge"}>
                      {u.approved ? "APPROVED" : "PENDING"}
                    </span>
                    {u.id !== user.id && (
                      <button
                        className="outline"
                        onClick={() =>
                          void action(`/admin/users/${u.id}/approval`, {
                            approved: !u.approved,
                          })
                        }
                      >
                        {u.approved ? "Revoke" : "Approve member"}
                      </button>
                    )}
                    <div className="devices">
                      {u.devices.map((d: any) => (
                        <div key={d.id}>
                          <span
                            className={"dot " + (!d.online ? "hollow" : "")}
                          />
                          <span>
                            {d.name}{" "}
                            <small>
                              {d.online ? "ONLINE" : "OFFLINE"} ·{" "}
                              {d.onDuty ? "ON DUTY" : "OFF DUTY"} ·{" "}
                              {d.rooms.length} AUDIO ROOMS{" "}
                              {d.busy ? "· IN CALL" : ""}
                              {!d.online && d.lastSeen
                                ? ` · LAST SEEN ${new Date(d.lastSeen).toLocaleString()}`
                                : ""}
                            </small>
                          </span>
                          {d.id !== user.device && (
                            <button
                              onClick={() =>
                                void action(`/admin/devices/${d.id}/approval`, {
                                  approved: !d.approved,
                                })
                              }
                            >
                              {d.approved ? "Revoke device" : "Approve device"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
              <section className="admin-panel">
                <div className="section-title">CHANNELS & MEMBERSHIPS</div>
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action("/admin/channels", { name: newName });
                    setNewName("");
                  }}
                >
                  <input
                    required
                    minLength={2}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="New channel name"
                  />
                  <button className="primary">
                    <Plus size={15} />
                    CREATE CHANNEL
                  </button>
                </form>
                {overview.channels.map((c: any) => (
                  <div className="channel-admin" key={c.id}>
                    <div>
                      <h3>{c.name}</h3>
                      <span className="mono">
                        {c.listeners} MEDIA CONNECTED ·{" "}
                        {c.speaker ? "SPEAKER ACTIVE" : "STANDBY"}
                      </span>
                    </div>
                    {c.kind === "channel" && (
                      <div className="member-checks">
                        {overview.users
                          .filter((u: any) => u.approved)
                          .map((u: any) => (
                            <label key={u.id}>
                              <input
                                type="checkbox"
                                checked={c.memberIds.includes(u.id)}
                                onChange={(e) =>
                                  void action(
                                    `/admin/channels/${c.id}/members`,
                                    {
                                      memberIds: e.target.checked
                                        ? [...c.memberIds, u.id]
                                        : c.memberIds.filter(
                                            (id: string) => id !== u.id,
                                          ),
                                    },
                                    "PUT",
                                  )
                                }
                              />
                              {u.name}
                            </label>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </section>
              <TeamPanel overview={overview} action={action} />
            </>
          )}
          {page === "settings" && (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">OPERATOR / SETTINGS</span>
                  <h1>Your session.</h1>
                </div>
              </div>
              <section className="admin-panel settings">
                <h3>{user.name}</h3>
                <p className="mono">
                  {user.role.toUpperCase()} · APPROVED DEVICE
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={duty}
                    onChange={(e) => setDuty(e.target.checked)}
                  />
                  On duty — connect permitted live-audio channels
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={conserve}
                    onChange={(e) => setConserve(e.target.checked)}
                  />
                  Conserve data — disable video calls and video uploads
                </label>
                <p>
                  Live reception in a locked phone is supported through the
                  Android foreground session. A browser tab may be suspended by
                  your operating system.
                </p>
                <div className="connection-panel">
                  <b>SERVER</b>
                  <span>{online ? "CONNECTED" : "UNREACHABLE"}</span>
                  <b>AUDIO ROOMS</b>
                  <span>{rooms.length} CONNECTED</span>
                  <b>OUTBOX</b>
                  <span>{pending.length} QUEUED</span>
                </div>
                <button className="outline" onClick={() => void flush()}>
                  <RefreshCw size={15} />
                  Retry queued messages
                </button>
                <button className="primary" onClick={() => void logout()}>
                  <LogOut size={15} />
                  SIGN OUT
                </button>
              </section>
            </>
          )}
          {call && ["ringing", "accepted"].includes(call.state) && (
            <div className="call-overlay">
              <div className="call-window">
                <span className="eyebrow">
                  PRIVATE {call.video ? "VIDEO" : "VOICE"} CALL
                </span>
                <h2>{call.state.toUpperCase()}</h2>
                <p>
                  {
                    people.find(
                      (p) =>
                        p.id ===
                        (call.caller_id === user.id
                          ? call.callee_id
                          : call.caller_id),
                    )?.name
                  }
                </p>
                <div ref={video} className="call-video" />
                {call.state === "ringing" &&
                  call.callee_device === user.device && (
                    <button
                      className="primary"
                      disabled={recording}
                      onClick={() => void action(`/calls/${call.id}/accept`)}
                    >
                      ACCEPT
                    </button>
                  )}
                <button
                  className="outline"
                  onClick={() =>
                    void action(
                      `/calls/${call.id}/${call.state === "ringing" && call.callee_device === user.device ? "decline" : "end"}`,
                    )
                  }
                >
                  {call.state === "ringing" ? "DECLINE / CANCEL" : "END CALL"}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
      <nav className="bottom-nav">
        <button
          className={page === "threads" ? "active" : ""}
          onClick={() => setPage("threads")}
        >
          <MessageSquare />
          <span>THREADS</span>
        </button>
        {user.role === "admin" && (
          <button
            className={page === "map" ? "active" : ""}
            onClick={() => setPage("map")}
          >
            <Activity />
            <span>MAP</span>
          </button>
        )}
        <button
          className={page === "comms" ? "active" : ""}
          onClick={() => setPage("comms")}
        >
          <Radio />
          <span>PTT COMMS</span>
        </button>
        <button
          className={page === "people" ? "active" : ""}
          onClick={() => setPage("people")}
        >
          <Users />
          <span>PEOPLE</span>
        </button>
        {user.role === "admin" && (
          <button
            className={page === "admin" ? "active" : ""}
            onClick={() => setPage("admin")}
          >
            <Activity />
            <span>DISPATCH</span>
          </button>
        )}
        <button
          className={page === "settings" ? "active" : ""}
          onClick={() => setPage("settings")}
        >
          <Settings />
          <span>SESSION</span>
        </button>
      </nav>
    </div>
  );
}
function TeamPanel({
  overview,
  action,
}: {
  overview: any;
  action: (p: string, b?: any, m?: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  return (
    <section className="admin-panel">
      <div className="section-title">TEAMS</div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action("/admin/teams", { name });
          setName("");
        }}
      >
        <input
          required
          minLength={2}
          placeholder="New team name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary">CREATE TEAM</button>
      </form>
      {overview.teams.map((t: any) => (
        <div className="channel-admin" key={t.id}>
          <h3>{t.name}</h3>
          <div className="member-checks">
            {overview.users
              .filter((u: any) => u.approved)
              .map((u: any) => (
                <label key={u.id}>
                  <input
                    type="checkbox"
                    checked={t.memberIds.includes(u.id)}
                    onChange={(e) =>
                      void action(
                        `/admin/teams/${t.id}/members`,
                        {
                          memberIds: e.target.checked
                            ? [...t.memberIds, u.id]
                            : t.memberIds.filter((id: string) => id !== u.id),
                        },
                        "PUT",
                      )
                    }
                  />
                  {u.name}
                </label>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}
