import { Arena } from "@/components/arena";

export const instant = false;

export default async function ArenaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <Arena id={id} />;
}
