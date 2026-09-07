/**
 * Mirror and redirect checks.
 *
 * The conversation mirror used to store whatever arrived under any device id,
 * and `/r?c=constructor` used to throw. Every assertion here is pure: no
 * database, no model key, no network. Run by `npm run check`.
 */
import { MAX_CONVERSATIONS, pruneConversations } from "../src/lib/chat/shape";
import { destinationFor } from "../src/lib/email/destinations";

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`  ✗ ${label}\n      expected ${e}\n      got      ${a}`);
  }
}

const thread = (over: Record<string, unknown> = {}) => ({
  id: "abc123",
  title: "Dal",
  createdAt: 1,
  updatedAt: 2,
  messages: [{ id: "m1", role: "user", text: "dal" }],
  activeRecordIds: ["supa-dal-001"],
  ...over,
});

console.log("\nMirror shape");

check("well-formed thread kept", pruneConversations([thread()]).length, 1);
check("not an array", pruneConversations({ conversations: [] }), []);
check("no messages field dropped", pruneConversations([thread({ messages: undefined })]), []);
check("non-string id dropped", pruneConversations([thread({ id: 42 })]), []);
check("non-numeric updatedAt dropped", pruneConversations([thread({ updatedAt: "now" })]), []);
check(
  "malformed message dropped, thread kept",
  pruneConversations([thread({ messages: [{ role: "assistant" }, { id: "m", role: "user", text: "x" }] })])[0]
    .messages.length,
  1,
);
check(
  "unknown role dropped",
  pruneConversations([thread({ messages: [{ id: "m", role: "system", text: "x" }] })])[0].messages,
  [],
);
check(
  "count capped",
  pruneConversations(Array.from({ length: MAX_CONVERSATIONS + 5 }, (_, i) => thread({ id: `t${i}` }))).length,
  MAX_CONVERSATIONS,
);
check("oversized thread dropped", pruneConversations([thread({ title: "x".repeat(201) })]), []);
check(
  "megabyte message dropped",
  pruneConversations([thread({ messages: [{ id: "m", role: "user", text: "x".repeat(500_000) }] })]),
  [],
);
check(
  "non-string activeRecordIds filtered",
  pruneConversations([thread({ activeRecordIds: ["a", 1, null] })])[0].activeRecordIds,
  ["a"],
);

const community = (photo_url: unknown) =>
  pruneConversations([
    thread({ messages: [{ id: "m", role: "assistant", text: "", community: { recipe_name: "x", photo_url } }] }),
  ])[0].messages[0].community?.photo_url;

check("photo route URL kept", community("/api/community/photo/0123456789abcdef01234567"), "/api/community/photo/0123456789abcdef01234567");
check("external photo URL nulled", community("https://example.com/track.png"), null);
check("protocol-relative photo URL nulled", community("//example.com/x.png"), null);
check("null photo kept", community(null), null);

console.log("\nRedirect destinations");

const home = destinationFor(null);
check("known code", destinationFor("film").startsWith("https://www.youtube.com/"), true);
check("unknown code falls back", destinationFor("nope"), home);
check("constructor falls back", destinationFor("constructor"), home);
check("__proto__ falls back", destinationFor("__proto__"), home);
check("toString falls back", destinationFor("toString"), home);

console.log(`\n${checks - failures}/${checks} passed`);
if (failures) process.exit(1);
