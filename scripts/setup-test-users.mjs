import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../server/dist/db.js";
import {
  prepareTestAccounts,
  saveTestAccounts,
} from "../server/dist/testing.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const countIndex = args.indexOf("--count");
const count = countIndex < 0 ? 3 : Number(args[countIndex + 1]);
const validArgs = args.filter(
  (_, index) => index !== countIndex && index !== countIndex + 1,
);
if ((countIndex < 0 ? args : validArgs).some((a) => a !== "--approve-devices"))
  throw new Error(
    "Usage: setup-test-users.bat [--count 3] [--approve-devices]",
  );
const data = resolve(root, process.env.DATA_DIR || "./data");
mkdirSync(data, { recursive: true });
const credentialsFile = join(data, "test-users.json");
const db = new Store(join(data, "kettoo.sqlite"));
try {
  const saved = existsSync(credentialsFile)
    ? JSON.parse(readFileSync(credentialsFile, "utf8"))
    : [];
  if (
    !Array.isArray(saved) ||
    saved.some(
      (a) =>
        !a.id ||
        !a.email ||
        (a.password !== null &&
          (typeof a.password !== "string" || a.password.length < 12)) ||
        (a.number !== undefined &&
          (!Number.isInteger(a.number) || a.number < 1 || a.number > 50)),
    )
  )
    throw new Error(
      "Invalid test-users.json; existing accounts were left unchanged.",
    );
  const accounts = prepareTestAccounts(db, count, saved);
  const merged = [
    ...saved.filter((a) => !accounts.some((n) => n.id === a.id)),
    ...accounts,
  ];
  // Save recoverable credentials before inserting users; a retry can finish interrupted setup.
  writeFileSync(
    credentialsFile + ".tmp",
    JSON.stringify(merged, null, 2) + "\n",
    { mode: 0o600 },
  );
  renameSync(credentialsFile + ".tmp", credentialsFile);
  saveTestAccounts(db, accounts, args.includes("--approve-devices"));
  console.log("\nVolunteer test sign-ins (use the full email as username):");
  console.table(
    accounts.map(({ name, email, password }) => ({
      name,
      username: email,
      password: password ?? "Changed by admin; use the current password",
    })),
  );
  console.log(`Credentials saved locally in ${credentialsFile}`);
  console.log(
    args.includes("--approve-devices")
      ? "Existing pending devices for these test accounts were approved."
      : "New volunteer devices still need approval in Organisation. Re-run with --approve-devices after their first sign-in to approve only these test accounts.",
  );
  console.log(
    "Assign test volunteers to the desired channels in Organisation > Channels & memberships.",
  );
} finally {
  db.db.close();
}
