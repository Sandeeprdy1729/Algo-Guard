import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgentGuard',
  description: 'Programmable Treasury & Policy Layer for AI Agents',
};

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/agents', label: 'Agents' },
  { href: '/policies', label: 'Policies' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/audit', label: 'Audit' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="border-b border-border">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-6">
            <Link href="/" className="font-mono text-accent font-bold text-lg tracking-tight">
              ⌘ AgentGuard
            </Link>
            <nav className="flex gap-4 text-sm text-muted">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-text transition">
                  {n.label}
                </Link>
              ))}
            </nav>
            <span className="ml-auto text-xs text-muted font-mono">Algorand TestNet</span>
          </div>
        </div>
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
