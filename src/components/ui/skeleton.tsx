import clsx from "clsx";

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animar-skeleton rounded-md bg-paper-muted", className)} />;
}
