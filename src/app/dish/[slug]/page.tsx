import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Chat } from "@/components/Chat";
import { fileCorpus, loadCorpus } from "@/lib/corpus/load";

/**
 * The QR target. A code on an oil can lands here and gets a specific
 * restoration, not the homepage — so the slug goes straight to the record by
 * primary key and never passes through search.
 */

export async function generateStaticParams() {
  return loadCorpus()
    .records.filter((r) => r.tier === "ancient" || r.provenance_class === "MODERN_DISH")
    .map((r) => ({ slug: r.slug }));
}

export async function generateMetadata(props: PageProps<"/dish/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const record = await fileCorpus.bySlug(slug);
  if (!record) return { title: "Not in the restored corpus" };

  const title = `${record.dish_name_modern} — The Great Indian Food Restoration`;
  const description =
    record.provenance_class === "MODERN_DISH"
      ? `${record.dish_name_modern} has no ancient original. Here is what can be restored anyway.`
      : `What ${record.dish_name_modern} was before colonial-era crop policy and industrial milling rewrote it.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: `/api/share/${record.slug}`, width: 1080, height: 1350 }],
    },
  };
}

export default async function DishPage(props: PageProps<"/dish/[slug]">) {
  const { slug } = await props.params;
  const record = await fileCorpus.bySlug(slug);
  if (!record) notFound();

  return <Chat initialSlug={record.slug} />;
}
