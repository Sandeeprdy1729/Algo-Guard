'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname() ?? '';
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={clsx(
        'relative px-2.5 py-1 text-[13px] rounded-md transition-colors duration-150',
        active ? 'text-text' : 'text-muted hover:text-text-2',
      )}
    >
      {label}
      {active && (
        <span
          aria-hidden
          className="absolute left-2 right-2 -bottom-[15px] h-px bg-text"
        />
      )}
    </Link>
  );
}
