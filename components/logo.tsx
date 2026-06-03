/**
 * TestPilot Logo component — uses the official brand SVG artwork.
 *
 * Icon viewBox : 0 0 1103 976  (aspect ≈ 1.13 : 1)
 * Brand colour : #7107e7
 *
 * Props:
 *   height    – rendered height in px; width scales proportionally. Default 28.
 *   variant   – 'dark'  → white  "Test" + purple "Pilot"  (default, dark-bg app)
 *               'light' → dark   "Test" + purple "Pilot"  (for light backgrounds)
 *   iconOnly  – render just the mark, no wordmark
 *   className – extra CSS classes
 */

const PURPLE = '#7107e7';

interface LogoProps {
  height?:   number;
  variant?:  'dark' | 'light';
  iconOnly?: boolean;
  className?: string;
}

/** The three official brand paths (fill applied by parent <g>) */
function BrandPaths() {
  return (
    <>
      <path d="M 537 627 L 530 623 L 521 623 L 515 625 L 505 632 L 487 650 L 444 699 L 394 760 L 389 769 L 389 773 L 391 776 L 393 777 L 401 776 L 432 752 L 483 709 L 530 665 L 537 657 L 542 647 L 542 636 Z" />
      <path d="M 691 383 L 675 384 L 447 486 L 442 493 L 443 500 L 495 534 L 381 652 L 307 743 L 276 790 L 496 606 L 531 583 L 553 583 L 591 631 L 599 630 L 690 394 Z" />
      <path d="M 547 186 L 512 197 L 320 308 L 278 342 L 268 377 L 268 629 L 295 680 L 331 636 L 323 615 L 330 372 L 533 250 L 568 249 L 763 362 L 780 389 L 778 624 L 763 643 L 569 756 L 511 751 L 475 785 L 526 814 L 562 818 L 794 689 L 824 663 L 835 630 L 835 374 L 825 342 L 797 316 L 591 197 Z" />
    </>
  );
}

export function Logo({
  height    = 28,
  variant   = 'dark',
  iconOnly  = false,
  className = '',
}: LogoProps) {
  // Use currentColor so the wordmark inherits the parent's text color.
  // In dark mode that's near-white; in light mode (via CSS variable inversion)
  // it becomes near-black — no per-call variant wiring needed.
  const testColor = variant === 'light' ? '#1C1B2E' : 'currentColor';

  // Icon aspect ratio: 1103 / 976 ≈ 1.1301
  const iconW = Math.round(height * (1103 / 976));

  if (iconOnly) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1103 976"
        width={iconW}
        height={height}
        fill={PURPLE}
        aria-label="TestPilot"
        className={className}
      >
        <BrandPaths />
      </svg>
    );
  }

  // ── Full logo: icon + wordmark ──────────────────────────────────────────
  // We embed the icon by scaling from its native 1103×976 viewBox into a
  // region of 'height' pixels tall (width = iconW).  The wordmark sits to
  // the right with a small gap.
  //
  // We use a fixed-height outer viewBox of 100 units; icon occupies
  // 0..iconUnit_W × 0..100 where iconUnit_W = 100 * (1103/976).
  const iconUnitW = Math.round(100 * (1103 / 976)); // ≈ 113
  const gap       = 10;
  const fontSize  = 72;        // units inside the 100-tall viewBox
  const textX     = iconUnitW + gap;
  // "TestPilot" width estimate at 72px bold sans-serif ≈ 9 chars × 0.57 × 72 ≈ 370
  const totalW    = textX + 370;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${totalW} 100`}
      height={height}
      fill="none"
      aria-label="TestPilot"
      className={className}
      style={{ width: 'auto' }}
    >
      {/* Icon — scale the 1103×976 artwork into a 100-unit-tall square area */}
      <g transform={`scale(${100 / 976})`}>
        <g fill={PURPLE}>
          <BrandPaths />
        </g>
      </g>

      {/* Wordmark */}
      <text
        x={textX}
        y={50}
        fontFamily="'Segoe UI','Inter','SF Pro Display',system-ui,sans-serif"
        fontSize={fontSize}
        fontWeight={800}
        dominantBaseline="middle"
      >
        <tspan fill={testColor}>Test</tspan>
        <tspan fill={PURPLE}>Pilot</tspan>
      </text>
    </svg>
  );
}
