import Link from "next/link";
import type { ReactNode } from 'react';
import { Logo } from './afterparty-navigation';
import './service-page.css';

export function ServicePage({ title, children }: { title: string; children: ReactNode }) {
  return <main className="service-page" lang="en">
    <header className="service-header"><Logo /><Link prefetch={false} target="_top" className="button subtle" href="/">Music room</Link></header>
    <article><p className="service-kicker">AFTERPARTY</p><h1>{title}</h1>{children}</article>
    <nav aria-label="Service information"><Link prefetch={false} target="_top" href="/">Music room</Link><Link prefetch={false} target="_top" href="/install">Install bot</Link><Link prefetch={false} target="_top" href="/terms">Terms of Service</Link><Link prefetch={false} target="_top" href="/privacy">Privacy Policy</Link><Link prefetch={false} target="_top" href="/support">Support</Link></nav>
  </main>;
}
