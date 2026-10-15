import type { ReactNode } from 'react';
import './service-page.css';

export function ServicePage({ title, children }: { title: string; children: ReactNode }) {
  return <main className="service-page" lang="en">
    <a className="service-brand" href="/">AFTERPARTY<span>.</span></a>
    <article><p className="service-kicker">AFTERPARTY</p><h1>{title}</h1>{children}</article>
    <nav aria-label="Service information"><a href="/">Music room</a><a href="/install">Install bot</a><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/support">Support</a></nav>
  </main>;
}
