import type { Metadata } from 'next';
import Link from 'next/link';
import Script from 'next/script';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { SystemStatus } from '@/components/system-status';
import { NavLink } from '@/components/nav-link';
import { ThemeToggle } from '@/components/theme-toggle';
import { THEME_HYDRATION_SCRIPT } from '@/lib/theme-script';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgentGuard — Autonomous Payment Governance',
  description:
    'On-chain policy engine, AI risk scoring, and human-in-the-loop controls for autonomous AI-agent spending on Algorand.',
};

const NAV = [
  { href: '/',          label: 'Overview' },
  { href: '/agents',    label: 'Agents' },
  { href: '/policies',  label: 'Policies' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/audit',     label: 'Audit' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_HYDRATION_SCRIPT }} />
        <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
          <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center gap-6">
            <Link href="/" className="group flex items-center gap-2.5 select-none">
              <BrandMark />
              <div className="leading-tight">
                <div className="text-[13px] font-semibold tracking-tightest text-text">AgentGuard</div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted">
                  Payment Governance
                </div>
              </div>
            </Link>

            <nav className="flex items-center gap-1 ml-4">
              {NAV.map((n) => (
                <NavLink key={n.href} href={n.href} label={n.label} />
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-3">
              <SystemStatus />
              <span className="hidden md:inline-flex items-center gap-1.5 pill border-border text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Algorand TestNet
              </span>
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="max-w-[1400px] mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}

function BrandMark() {
  // Compact glyph — evokes a shield + terminal caret without being cute.
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className="text-text group-hover:text-accent transition-colors duration-200"
      aria-hidden="true"
    >
      <path
        d="M10 1.5 3 4v6c0 3.8 2.9 7.3 7 8.5 4.1-1.2 7-4.7 7-8.5V4l-7-2.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="m7 9 2.2 2.4L13 7.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
