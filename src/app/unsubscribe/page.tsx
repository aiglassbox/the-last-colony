import type { Metadata } from "next";
import Link from "next/link";

import { suppress } from "@/lib/email/track";

/**
 * GET /unsubscribe?t=<tid>
 *
 * A legal and deliverability requirement, not a feature, so it is deliberately
 * the plainest page on the site: no confirmation step, no preference centre, no
 * "are you sure". One request, recorded, said back to the reader in one line.
 *
 * Recording on a plain GET means a mail scanner that follows every link will
 * suppress a contact who never asked. That is the right way round to be wrong:
 * an over-suppressed contact costs one send, and a missed unsubscribe costs a
 * complaint and a domain reputation. Nothing here is reversible from the
 * reader's side by accident — there is no link back that re-subscribes them.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unsubscribed — The Kranti Cookbook",
  robots: { index: false, follow: false },
};

export default async function Unsubscribe(props: PageProps<"/unsubscribe">) {
  const params = await props.searchParams;
  const raw = params.t;
  const tid = typeof raw === "string" ? raw : null;

  const recorded = await suppress(tid);

  return (
    <main className="mx-auto max-w-2xl px-5 py-24 text-[var(--ink)]">
      <div className="mono text-[var(--orange)]">The Kranti Cookbook</div>

      {recorded ? (
        <>
          <h1 className="display mt-3 mb-4 text-2xl">You are unsubscribed.</h1>
          <p className="max-w-[56ch] text-[var(--ink-soft)]">
            We have taken you off the list for this campaign. You will not get another
            email from us about it. Nothing else needs doing.
          </p>
        </>
      ) : (
        <>
          <h1 className="display mt-3 mb-4 text-2xl">We could not complete that.</h1>
          <p className="max-w-[56ch] text-[var(--ink-soft)]">
            {tid
              ? "Something went wrong on our side and we would rather tell you than let you think it worked."
              : "This link is missing the token that identifies your subscription — it may have been truncated by your mail client."}{" "}
            Reply to the email you received and we will remove you by hand.
          </p>
        </>
      )}

      <Link href="/" className="mono mt-6 inline-block text-[var(--orange)]">
        ← The Kranti Cookbook
      </Link>
    </main>
  );
}
