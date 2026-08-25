import type { ReactNode } from "react";

type SkipLinkProps = Readonly<{
  children: ReactNode;
  targetId: string;
}>;

export function SkipLink({ children, targetId }: SkipLinkProps) {
  return (
    <a className="skip-link" href={`#${targetId}`}>
      {children}
    </a>
  );
}
