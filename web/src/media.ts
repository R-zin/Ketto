import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
} from "livekit-client";
import { api, upload, pauseUploads } from "./api";
export class Coordinator {
  rooms = new Map<string, Room>();
  selected = "";
  callRoom?: Room;
  private audio = new Map<string, HTMLMediaElement[]>();
  private speakers = new Set<string>();
  get connectedRooms() {
    return [...this.rooms]
      .filter(([, room]) => room.state === "connected")
      .map(([cid]) => cid);
  }
  get audibleConversation() {
    return this.callRoom
      ? ""
      : this.speakers.has("all-staff")
        ? "all-staff"
        : this.speakers.has(this.selected)
          ? this.selected
          : this.speakers.values().next().value || this.selected;
  }
  incoming(cid: string, active: boolean) {
    if (active) this.speakers.add(cid);
    else this.speakers.delete(cid);
    this.route();
  }
  private transmitting?: {
    cid: string;
    leaseId: string;
    message: string;
    track: LocalAudioTrack;
    recorder?: MediaRecorder;
    parts: BlobPart[];
    renew: ReturnType<typeof setInterval>;
    timeout: ReturnType<typeof setTimeout>;
  };
  private wanted = false;
  private starting = false;
  onState: (s: string) => void = () => {};
  onRooms: () => void = () => {};
  onError: (s: string) => void = () => {};
  onAudience: (audience: any[]) => void = () => {};
  async connect(cids: string[]) {
    for (const cid of [...this.rooms.keys()])
      if (!cids.includes(cid)) await this.drop(cid);
    for (const cid of cids) {
      if (this.rooms.has(cid)) continue;
      try {
        const grant = await api(`/conversations/${cid}/media-token`, {});
        const room = new Room({ adaptiveStream: true, dynacast: true });
        this.rooms.set(cid, room);
        room.on(RoomEvent.ConnectionStateChanged, () => this.onRooms());
        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Audio) {
            const element = track.attach();
            document.body.appendChild(element);
            this.audio.set(cid, [...(this.audio.get(cid) || []), element]);
            this.route();
            void element
              .play()
              .catch(() =>
                this.onError("Tap Start duty again to enable browser audio"),
              );
          }
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          const elements = track.detach();
          elements.forEach((e) => e.remove());
          this.audio.set(
            cid,
            (this.audio.get(cid) || []).filter((e) => !elements.includes(e)),
          );
        });
        room.on(RoomEvent.Disconnected, () => {
          this.rooms.delete(cid);
          this.onRooms();
        });
        await room.connect(grant.url, grant.token);
        await room.startAudio();
        this.onRooms();
      } catch (e) {
        await this.drop(cid);
        this.onError((e as Error).message);
      }
    }
  }
  route() {
    for (const [cid, elements] of this.audio)
      for (const e of elements)
        e.muted = !!this.callRoom || cid !== this.audibleConversation;
  }
  async drop(cid: string) {
    await this.rooms.get(cid)?.disconnect();
    this.rooms.delete(cid);
    this.audio.get(cid)?.forEach((e) => e.remove());
    this.audio.delete(cid);
    this.onRooms();
  }
  async off() {
    this.speakers.clear();
    this.wanted = false;
    await this.stop();
    for (const cid of [...this.rooms.keys()]) await this.drop(cid);
    await this.endCall();
  }
  async start(cid: string) {
    if (this.starting || this.transmitting || this.callRoom) return;
    this.wanted = true;
    pauseUploads();
    this.starting = true;
    this.onState("REQUESTING");
    let lease: any;
    let track: LocalAudioTrack | undefined;
    try {
      const room = this.rooms.get(cid);
      if (!room) throw new Error("Start duty and connect audio first");
      lease = await api(`/conversations/${cid}/ptt`, {});
      this.onAudience(lease.audience);
      if (!this.wanted) {
        await api(`/conversations/${cid}/ptt/release`, {
          leaseId: lease.leaseId,
        });
        return;
      }
      // Wait for the server-controlled publish permission event before microphone capture.
      const deadline = Date.now() + 3000;
      while (
        !room.localParticipant.permissions?.canPublish &&
        Date.now() < deadline
      )
        await new Promise((r) => setTimeout(r, 30));
      if (!room.localParticipant.permissions?.canPublish)
        throw new Error("Publish permission was not received");
      track = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      if (!this.wanted) {
        track.stop();
        await api(`/conversations/${cid}/ptt/release`, {
          leaseId: lease.leaseId,
        });
        return;
      }
      await room.localParticipant.publishTrack(track);
      const parts: BlobPart[] = [];
      let recorder: MediaRecorder | undefined;
      if (typeof MediaRecorder !== "undefined") {
        try {
          recorder = new MediaRecorder(
            new MediaStream([track.mediaStreamTrack]),
          );
          recorder.ondataavailable = (e) => {
            if (e.data.size) parts.push(e.data);
          };
          recorder.start(250);
        } catch {
          /* live audio remains usable without replay */
        }
      }
      const renew = setInterval(
        () =>
          void api(`/conversations/${cid}/ptt/renew`, {
            leaseId: lease.leaseId,
          }).catch(() => {
            this.onError("Control lease lost. Transmission stopped.");
            void this.stop();
          }),
        2000,
      );
      this.transmitting = {
        cid,
        leaseId: lease.leaseId,
        message: lease.message,
        track,
        recorder,
        parts,
        renew,
        timeout: setTimeout(
          () => void this.stop(),
          Math.max(1, lease.deadline - Date.now()),
        ),
      };
      this.onState("TRANSMITTING");
      if (!this.wanted) await this.stop();
    } catch (e) {
      track?.stop();
      if (lease)
        await api(`/conversations/${cid}/ptt/release`, {
          leaseId: lease.leaseId,
        }).catch(() => {});
      this.onError((e as Error).message);
      this.onState("STANDBY");
    } finally {
      this.starting = false;
      if (!this.transmitting) this.onState("STANDBY");
    }
  }
  async stop() {
    this.wanted = false;
    const t = this.transmitting;
    if (!t) return;
    this.transmitting = undefined;
    clearInterval(t.renew);
    clearTimeout(t.timeout);
    let recording: Blob | undefined;
    if (t.recorder?.state === "recording") {
      const r = t.recorder;
      await new Promise<void>((resolve) => {
        r.onstop = () => resolve();
        r.stop();
      });
      recording = new Blob(t.parts, { type: r.mimeType.split(";")[0] });
    }
    await this.rooms
      .get(t.cid)
      ?.localParticipant.unpublishTrack(t.track)
      .catch(() => {});
    t.track.stop();
    await api(`/conversations/${t.cid}/ptt/release`, {
      leaseId: t.leaseId,
    }).catch(() => {});
    this.onState("STANDBY");
    if (recording?.size && recording.size <= 1024 * 1024) {
      try {
        const f = await upload(t.cid, recording, "ptt.webm", () => {});
        await api(`/messages/${t.message}/recording`, { attachmentId: f.id });
      } catch {
        this.onError("Live burst ended; replay recording could not be saved");
      }
    }
  }
  async joinCall(call: any, container: HTMLElement) {
    pauseUploads();
    await this.stop();
    if (this.callRoom) return;
    const grant = await api(`/calls/${call.id}/token`, {});
    const room = new Room();
    this.callRoom = room;
    this.route();
    room.on(RoomEvent.TrackSubscribed, (track) => {
      const el = track.attach();
      container.appendChild(el);
      void el.play().catch(() => {});
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) =>
      track.detach().forEach((e) => e.remove()),
    );
    await room.connect(grant.url, grant.token);
    await room.localParticipant.setMicrophoneEnabled(true);
    if (call.video) {
      await room.localParticipant.setCameraEnabled(true);
      const track = room.localParticipant.getTrackPublication(
        Track.Source.Camera,
      )?.track;
      if (track) {
        const el = track.attach();
        el.muted = true;
        container.appendChild(el);
      }
    }
  }
  async endCall() {
    await this.callRoom?.disconnect();
    this.callRoom = undefined;
    this.route();
  }
}
