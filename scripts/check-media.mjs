import { RoomServiceClient } from "livekit-server-sdk";
const address =
  process.env.LIVEKIT_INTERNAL_URL ||
  process.env.LIVEKIT_URL?.replace(/^ws/, "http");
try {
  await new RoomServiceClient(
    address,
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
  ).listRooms();
  console.log("Audio service credentials verified.");
} catch {
  console.error(
    "Audio service health check failed. Check its address and matching credentials in .env.",
  );
  process.exitCode = 1;
}
