/**
 * Marks used by the site chrome that aren't in `@/icons` or `lucide-react`.
 *
 * These sat under the landing route until the header and footer became shared;
 * they are drawn on every page now, so they live with the chrome.
 */

type IconProps = { className?: string };

/** MALIKA brand mark — same geometry as `public/images/logo/logo-icon.svg`. */
export function MalikaMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path
        d="M0 8.42105C0 3.77023 3.77023 0 8.42105 0H23.5789C28.2298 0 32 3.77023 32 8.42105V23.5789C32 28.2298 28.2298 32 23.5789 32H8.42105C3.77023 32 0 28.2298 0 23.5789V8.42105Z"
        fill="#465FFF"
      />
      <path
        d="M8.42383 8.42152C8.42383 7.49135 9.17787 6.7373 10.108 6.7373C11.0382 6.7373 11.7922 7.49135 11.7922 8.42152V23.5794C11.7922 24.5096 11.0382 25.2636 10.108 25.2636C9.17787 25.2636 8.42383 24.5096 8.42383 23.5794V8.42152Z"
        fill="white"
      />
      <path
        d="M14.7422 15.1569C14.7422 14.2267 15.4962 13.4727 16.4264 13.4727C17.3566 13.4727 18.1106 14.2267 18.1106 15.1569V23.5779C18.1106 24.5081 17.3566 25.2621 16.4264 25.2621C15.4962 25.2621 14.7422 24.5081 14.7422 23.5779V15.1569Z"
        fill="white"
        fillOpacity="0.9"
      />
      <path
        d="M21.0547 10.9459C21.0547 10.0158 21.8087 9.26172 22.7389 9.26172C23.6691 9.26172 24.4231 10.0158 24.4231 10.9459V23.5775C24.4231 24.5077 23.6691 25.2617 22.7389 25.2617C21.8087 25.2617 21.0547 24.5077 21.0547 23.5775V10.9459Z"
        fill="white"
        fillOpacity="0.8"
      />
    </svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M16.5 12.4A7 7 0 017.6 3.5a7 7 0 108.9 8.9z" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.2 13.2L17 17" />
    </svg>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="4" />
      <path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.4 4.4l1 1M14.6 14.6l1 1M15.6 4.4l-1 1M5.4 14.6l-1 1" />
    </svg>
  );
}
