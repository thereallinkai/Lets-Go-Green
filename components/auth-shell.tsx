import { BrandLink } from "@/components/brand-link";
import { AppearanceControl } from "@/components/appearance-control";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="auth-aside-top">
          <BrandLink />
          <AppearanceControl />
        </div>
        <div className="auth-quote">
          <p>A useful plan should make your day feel clearer, not smaller.</p>
          <small>
            Your data, app calculations, and AI suggestions stay visibly
            separated so you can make informed choices.
          </small>
        </div>
        <small>General wellness guidance · Not medical advice</small>
      </aside>
      <main id="main-content" className="auth-main">
        {children}
      </main>
    </div>
  );
}
