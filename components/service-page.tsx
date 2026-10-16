import Link from "next/link";
import type { ReactNode } from 'react';
import { Logo } from './afterparty-navigation';
import './service-page.css';

export function ServicePage({ title, children }: { title: string; children: ReactNode }) {
  return <main className="service-page" lang="en">
    <Logo />
    <article><p className="service-kicker">AFTERPARTY</p><h1>{title}</h1>{children}</article>
    <nav aria-label="Service information"><Link href="/">Music room</Link><Link href="/install">Install bot</Link><Link href="/terms">Terms of Service</Link><Link href="/privacy">Privacy Policy</Link><Link href="/support">Support</Link></nav>
  </main>;
}
