import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-24 text-[var(--ink)]">
      <div className="mono text-[var(--orange)]">Not in the restored corpus</div>
      <h1 className="display mt-3 mb-4 text-2xl">We do not have this one yet.</h1>
      <p className="max-w-[56ch] text-[var(--ink-soft)]">
        Rather than improvise a history for a dish we have not restored, we would rather
        say nothing. Name a dish on the main screen and we will tell you what we actually
        know.
      </p>
      <Link href="/" className="mono mt-6 inline-block text-[var(--orange)]">
        ← Start again
      </Link>
    </main>
  );
}
