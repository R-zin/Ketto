import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";

// Five-second, explicitly approved physical-phone test. No recording or test media client.
if (!process.env.KETTOO_DEVICE_CONTEXT || !process.env.KETTOO_TEST_PASSWORD) {
  throw new Error("Set KETTOO_DEVICE_CONTEXT and KETTOO_TEST_PASSWORD for the isolated phone test organisation.");
}
const context = JSON.parse(
  await readFile(process.env.KETTOO_DEVICE_CONTEXT!, "utf8"),
);
const base = "http://127.0.0.1:8791/api";
const invoke = async (path: string, token: string, body?: unknown) => {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as any;
  if (!response.ok) throw new Error(result.error);
  return result;
};
const sender = context.phones.find(
  (p: any) => p.email === "samsung-test@kettoo.local",
);
const recipient = context.phones.find(
  (p: any) => p.email === "oneplus-test@kettoo.local",
);
const login = await invoke("/login", "", {
  email: sender.email,
  password: process.env.KETTOO_TEST_PASSWORD,
  deviceId: sender.devices[0].id,
});
const conversation = await invoke("/private", login.token, {
  userId: recipient.id,
});
const until = Date.now() + 60000;
while (true) {
  const overview = await invoke("/admin/overview", context.admin.token);
  const ready = [sender, recipient].every((p) =>
    overview.users
      .find((u: any) => u.id === p.id)
      ?.devices.some((d: any) => d.onDuty && d.rooms.includes(conversation.id)),
  );
  if (ready) break;
  if (Date.now() > until)
    throw new Error("Both phones did not become call-ready");
  await pause(250);
}
await pause(8000); // Audible-test notice window.
let call: any;
try {
  call = await invoke("/calls", login.token, {
    conversationId: conversation.id,
    video: process.env.KETTOO_TEST_VIDEO === "true",
  });
  const deadline = Date.now() + 10000;
  while (true) {
    const current = await invoke("/calls/active", login.token);
    if (current?.id === call.id && current.state === "accepted") break;
    if (Date.now() > deadline)
      throw new Error("Phone did not accept the test call");
    await pause(50);
  }
  console.log("Test call accepted; ending after five seconds.");
  await pause(5000);
} finally {
  if (call)
    await invoke(`/calls/${call.id}/end`, login.token, {}).catch(() => {});
}
console.log(
  JSON.stringify({
    callTest: "five seconds",
    video: process.env.KETTOO_TEST_VIDEO === "true",
    ended: true,
  }),
);
