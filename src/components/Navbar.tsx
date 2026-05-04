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
        <nav className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-xl">
            <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-6">
                <Link href="/" className="text-xs font-semibold tracking-[0.2em] text-[var(--text)] uppercase no-underline">
                    Kessler
                </Link>
                <div className="flex items-center gap-8">
                    {links.map((l) => (
                        <Link
                            key={l.href}
                            href={l.href}
                            className={`text-xs tracking-wide transition-colors no-underline ${
                                pathname === l.href
                                    ? "text-[var(--text)]"
                                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
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
