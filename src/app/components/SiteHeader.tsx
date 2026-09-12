import Link from "next/link";
import { getCurrentMemberId } from "@/lib/members/auth";

/**
 * Hand-built SVG rather than a generated image: it stays crisp at any
 * size, themes with currentColor, and the striking motion is just a CSS
 * rotation on the mallet group — no sprite/video asset needed.
 */
export default async function SiteHeader() {
  const memberId = await getCurrentMemberId();

  return (
    <header className="site-header">
      <Link href="/" className="site-brand">
        <svg
          className="gavel-icon"
          viewBox="0 0 64 64"
          width="34"
          height="34"
          aria-hidden="true"
        >
          <rect
            className="gavel-block"
            x="14"
            y="46"
            width="24"
            height="7"
            rx="2.5"
          />
          <g className="gavel-mallet">
            <rect x="24" y="20" width="4" height="24" rx="2" />
            <rect x="14" y="8" width="24" height="13" rx="6" />
          </g>
        </svg>
        <span className="site-brand-name">ClassActionPayouts.com</span>
      </Link>
      <nav className="site-nav">
        {memberId ? (
          <Link href="/account">My account</Link>
        ) : (
          <>
            <Link href="/login">Log in</Link>
            <Link href="/signup">Sign up</Link>
          </>
        )}
      </nav>
    </header>
  );
}
