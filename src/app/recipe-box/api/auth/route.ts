import { recipeBox } from "@/lib/dash/auth";
import { authHandlers } from "@/lib/dash/auth-route";

/** The recipe box's door: the kitchen's maths, its own password, its own cookie, its own attempt budget. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = authHandlers(recipeBox, "recipe-box");
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
