"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Navbar() {
    const pathname = usePathname();

    const links = [
        { href: "/", label: "Generate" },
        { href: "/references", label: "References" },
    ];

    return (
        <nav className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-xl">
            <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-6">
                <Link href="/" className="flex items-center gap-2 no-underline">
                    <div className="h-8 w-8 rounded-lg bg-[var(--accent)] flex items-center justify-center">
                        <span className="text-black font-bold text-sm">K</span>
                    </div>
                    <span className="text-lg font-semibold tracking-tight text-[var(--text)]">
                        Kessler
                    </span>
                </Link>
                <div className="flex items-center gap-1">
                    {links.map((l) => (
                        <Link
                            key={l.href}
                            href={l.href}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors no-underline ${pathname === l.href
                                    ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                                    : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)]"
                                }`}
                        >
                            {l.label}
                        </Link>
                    ))}
                </div>
            </div>
        </nav>
    );
}
