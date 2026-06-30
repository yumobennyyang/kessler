import Link from "next/link";

export function Navbar() {
    return (
        <nav className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-xl">
            <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-6">
                <Link href="/home" className="text-xs font-semibold tracking-[0.2em] text-[var(--text)] uppercase no-underline">
                    Kessler
                </Link>
                <a
                    href="https://replicate.com/account/billing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors no-underline"
                >
                    Balance & Billing ↗
                </a>
            </div>
        </nav>
    );
}
