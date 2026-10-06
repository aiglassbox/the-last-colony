import { kitchen } from "@/lib/dash/auth";
import { authHandlers } from "@/lib/dash/auth-route";

/** The kitchen door. The reasoning lives in `auth-route.ts`; this file only names the gate. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = authHandlers(kitchen, "kitchen");
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
