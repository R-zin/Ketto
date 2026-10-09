import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
export interface Media {
  configured: boolean;
  url: string;
  token(
    room: string,
    identity: string,
    name: string,
    call?: boolean,
  ): Promise<string>;
  publishing(room: string, identity: string, enabled: boolean): Promise<void>;
  remove(room: string, identity: string): Promise<void>;
  close(room: string): Promise<void>;
}
export function liveMedia(): Media {
  const url = process.env.LIVEKIT_URL ?? "";
  const key = process.env.LIVEKIT_API_KEY ?? "";
  const secret = process.env.LIVEKIT_API_SECRET ?? "";
  const configured = !!(url && key && secret);
  const service = configured
    ? new RoomServiceClient(
        process.env.LIVEKIT_INTERNAL_URL || url.replace(/^ws/, "http"),
        key,
        secret,
      )
    : null;
  return {
    configured,
    url,
    async token(room, identity, name, call = false) {
      if (!configured)
        throw Object.assign(new Error("Media server is not configured"), {
          statusCode: 503,
        });
      const access = new AccessToken(key, secret, {
        identity,
        name,
        ttl: "2m",
      });
      access.addGrant({
        roomJoin: true,
        room,
        canPublish: call,
        canSubscribe: true,
        canPublishData: false,
        canUpdateOwnMetadata: false,
      });
      return access.toJwt();
    },
    async publishing(room, identity, enabled) {
      if (!service)
        throw Object.assign(new Error("Media server is not configured"), {
          statusCode: 503,
        });
      await service.updateParticipant(room, identity, {
        permission: {
          canPublish: enabled,
          canSubscribe: true,
          canPublishData: false,
          canPublishSources: enabled ? [2] : [],
        },
      });
    },
    async remove(room, identity) {
      if (service) await service.removeParticipant(room, identity);
    },
    async close(room) {
      if (service) {
        try {
          await service.deleteRoom(room);
        } catch (error) {
          if ((error as { status?: number }).status !== 404) throw error;
        }
      }
    },
  };
}
